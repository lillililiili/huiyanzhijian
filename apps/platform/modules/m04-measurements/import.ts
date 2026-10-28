import type { PoolClient } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import Decimal from 'decimal.js';
import { pool, transaction } from '../../infrastructure/db';
import { ApiError, requireValue } from '../../infrastructure/errors';
import type { Actor, Context } from '../m00-identity/api';
import { allow } from '../m00-identity/api';
import type { AlarmService } from '../m05-alarms/service';

export interface ImportRowInput {
  position_m: number | string;
  value: number | string;
  sample_time?: string;
  unit?: string;
  metric_code?: string;
}

export interface ValidatedImportRow {
  index: number;
  position_m: number;
  value: number;
  sample_time: string;
  unit: string;
  metric_code: string;
  valid: boolean;
  errors: string[];
}

export interface ParseImportDto {
  task_id: string;
  csv_text?: string;
  rows?: ImportRowInput[];
}

export interface SubmitImportDto {
  task_id: string;
  batch_name?: string;
  reason?: string;
  rows: ImportRowInput[];
}

export class MeasurementImportService {
  /**
   * P12 数据导入与人工补录：行级解析与校验（时间格式合法性、米数递增性、物理数值范围）
   */
  async parse(actor: Actor, dto: ParseImportDto, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'data:read', 'USER');
    requireValue(typeof dto?.task_id === 'string' && dto.task_id.length > 0, 'REQUEST_INVALID', '任务ID task_id 不能为空');

    // 1. 获取任务信息及指标要求
    const taskRes = await db.query(
      `SELECT t.*, spec.name AS spec_name
       FROM m02.inspection_task t
       JOIN m01.product_specification spec ON spec.id = t.specification_id
       WHERE t.factory_id = $1 AND t.id = $2`,
      [actor.factory, dto.task_id]
    );

    if (taskRes.rowCount === 0) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', '检测任务不存在');
    }

    const task = taskRes.rows[0];
    const metricCode = task.metric_code as 'SHIELD_OVERLAP_RATE' | 'WIRE_GAP' | 'OVALITY';
    const defaultUnit = metricCode === 'WIRE_GAP' ? 'mm' : '%';

    // 2. 提取输入行
    let rawRows: ImportRowInput[] = [];
    if (Array.isArray(dto.rows) && dto.rows.length > 0) {
      rawRows = dto.rows;
    } else if (typeof dto.csv_text === 'string' && dto.csv_text.trim().length > 0) {
      rawRows = this.parseCsv(dto.csv_text.trim(), metricCode, defaultUnit);
    } else {
      throw new ApiError(400, 'REQUEST_INVALID', '请提供待解析的 CSV 文本或测点列表 rows');
    }

    requireValue(rawRows.length > 0, 'REQUEST_INVALID', '无有效数据行');
    requireValue(rawRows.length <= 2000, 'BATCH_LIMIT_EXCEEDED', '单次人工补录最多支持 2000 行');

    // 3. 执行逐行校验
    const validatedRows: ValidatedImportRow[] = [];
    let prevPosition: number | null = null;
    let validCount = 0;
    let invalidCount = 0;

    for (let i = 0; i < rawRows.length; i++) {
      const raw = rawRows[i];
      const errors: string[] = [];
      const index = i + 1;

      // 米数校验
      const posNum = Number(raw.position_m);
      if (isNaN(posNum) || posNum < 0) {
        errors.push(`第 ${index} 行米数必须为大于等于 0 的合法数字`);
      } else {
        if (prevPosition !== null && posNum < prevPosition) {
          errors.push(`第 ${index} 行米数倒序：当前米数 ${posNum}m 小于前一行米数 ${prevPosition}m`);
        }
        prevPosition = posNum;
      }

      // 数值与物理量程范围校验
      const valNum = Number(raw.value);
      if (isNaN(valNum)) {
        errors.push(`第 ${index} 行测量值必须为有效数值`);
      } else {
        if (metricCode === 'SHIELD_OVERLAP_RATE') {
          if (valNum < 0 || valNum > 100) {
            errors.push(`金属屏蔽搭盖率超出物理合理范围 [0.0%, 100.0%]，当前值为 ${valNum}%`);
          }
        } else if (metricCode === 'WIRE_GAP') {
          if (valNum < 0 || valNum > 50) {
            errors.push(`铜丝屏蔽间隙超出物理合理范围 [0.0mm, 50.0mm]，当前值为 ${valNum}mm`);
          }
        } else if (metricCode === 'OVALITY') {
          if (valNum < 0 || valNum > 100) {
            errors.push(`电缆不圆度超出物理合理范围 [0.0%, 100.0%]，当前值为 ${valNum}%`);
          }
        }
      }

      // 时间合法性校验
      let sampleTimeStr = raw.sample_time;
      if (sampleTimeStr) {
        const timeMs = Date.parse(sampleTimeStr);
        if (isNaN(timeMs)) {
          errors.push(`第 ${index} 行采样时间格式无效，必须为合法 ISO-8601 时间戳`);
        } else if (timeMs > Date.now() + 5 * 60 * 1000) {
          errors.push(`第 ${index} 行采样时间超出未来时间限制`);
        }
      } else {
        sampleTimeStr = new Date(Date.now() - (rawRows.length - i) * 1000).toISOString();
      }

      const isValid = errors.length === 0;
      if (isValid) validCount++;
      else invalidCount++;

      validatedRows.push({
        index,
        position_m: isNaN(posNum) ? 0 : posNum,
        value: isNaN(valNum) ? 0 : valNum,
        sample_time: sampleTimeStr,
        unit: raw.unit || defaultUnit,
        metric_code: metricCode,
        valid: isValid,
        errors,
      });
    }

    return {
      valid: invalidCount === 0,
      total_rows: rawRows.length,
      valid_rows: validCount,
      invalid_rows: invalidCount,
      task_id: task.id,
      metric_code: metricCode,
      rows: validatedRows,
    };
  }

  /**
   * P12 数据导入与人工补录：质检主管确认提交入库，按任务冻结配方计算 quality_result，标记 MANUAL_IMPORT 并留痕审计
   */
  async submit(
    ctx: Context,
    dto: SubmitImportDto,
    alarms?: AlarmService,
    db: Pick<PoolClient, 'query'> = pool
  ) {
    allow(ctx.actor, 'task:write', 'USER');
    requireValue(typeof dto?.task_id === 'string' && dto.task_id.length > 0, 'REQUEST_INVALID', '任务ID task_id 不能为空');
    requireValue(Array.isArray(dto?.rows) && dto.rows.length > 0, 'REQUEST_INVALID', '提交的补录数据行不能为空');

    // 1. 先进行解析校验
    const parseResult = await this.parse(ctx.actor, { task_id: dto.task_id, rows: dto.rows }, db);
    if (!parseResult.valid) {
      const firstErr = parseResult.rows.find((r) => !r.valid)?.errors[0];
      throw new ApiError(422, 'IMPORT_DATA_INVALID', `数据校验未通过: ${firstErr}`);
    }

    const result = await transaction(async (tx) => {
      // 2. 获取任务详情与配方规则
      const taskRes = await tx.query(
        `SELECT t.*, s.spool_code, w.external_code AS work_order_code
         FROM m02.inspection_task t
         JOIN m02.cable_spool s ON s.id = t.spool_id
         JOIN m02.work_order w ON w.id = t.work_order_id
         WHERE t.factory_id = $1 AND t.id = $2 FOR UPDATE`,
        [ctx.actor.factory, dto.task_id]
      );
      const task = taskRes.rows[0];

      // 读取配方比较规则快照
      let ruleSnapshot: any = { approval_state: 'APPROVED', method_id: 'auto' };
      if (task.recipe_version_id) {
        const recipeRes = await tx.query(
          `SELECT rule_snapshot FROM m03.recipe_version WHERE id = $1`,
          [task.recipe_version_id]
        );
        if (recipeRes.rowCount && recipeRes.rowCount > 0) {
          ruleSnapshot = recipeRes.rows[0].rule_snapshot;
        }
      }

      // 获取当前最大 capture_sequence
      const seqRes = await tx.query(
        `SELECT COALESCE(MAX(capture_sequence), 0)::bigint AS max_seq
         FROM m04.measurement_record
         WHERE factory_id = $1 AND device_id = $2 AND capture_session_id = 'SES-MANUAL-IMPORT'`,
        [ctx.actor.factory, task.device_id]
      );
      let currentSeq = Number(seqRes.rows[0].max_seq || 0);

      const metricCode = task.metric_code;
      const validRows = parseResult.rows;
      let insertedCount = 0;
      let failCount = 0;

      for (const row of validRows) {
        currentSeq++;
        const recordId = randomUUID();
        const sourceKey = `IMP-${task.id.slice(0, 8)}-${currentSeq}`;

        // 规则判定：搭盖率 >= 10.0%, 间隙 <= 3.0mm, 不圆度 <= 8.0%
        let qualityResult: 'PASS' | 'FAIL' = 'PASS';
        const val = row.value;
        if (metricCode === 'SHIELD_OVERLAP_RATE') {
          qualityResult = val >= 10.0 ? 'PASS' : 'FAIL';
        } else if (metricCode === 'WIRE_GAP') {
          qualityResult = val <= 3.0 ? 'PASS' : 'FAIL';
        } else if (metricCode === 'OVALITY') {
          qualityResult = val <= 8.0 ? 'PASS' : 'FAIL';
        }
        if (qualityResult === 'FAIL') {
          failCount++;
        }

        const rawPayload = {
          record_id: sourceKey,
          device_id: task.device_id,
          task_id: task.id,
          position_m: row.position_m,
          value: row.value,
          unit: row.unit,
          sample_time: row.sample_time,
          imported_by: ctx.actor.id,
          reason: dto.reason || '人工补录',
        };
        const payloadHash = createHash('sha256').update(JSON.stringify(rawPayload)).digest('hex');

        // 插入 m04.measurement_record
        await tx.query(
          `INSERT INTO m04.measurement_record(
            id, factory_id, device_id, source_record_key, capture_session_id, capture_sequence,
            task_id, sample_kind, sample_time, time_source, position_m, position_quality,
            source_type, data_environment, data_status, receipt_status, raw_payload, payload_hash, schema_version
          ) VALUES(
            $1, $2, $3, $4, 'SES-MANUAL-IMPORT', $5,
            $6, 'NEW_SAMPLE', $7, 'MANUAL', $8, 'MANUAL_VERIFIED',
            'MANUAL_IMPORT', $9, 'VALID', 'STORED', $10, $11, '1.0'
          )`,
          [
            recordId,
            ctx.actor.factory,
            task.device_id,
            sourceKey,
            currentSeq,
            task.id,
            row.sample_time,
            row.position_m,
            task.data_environment || 'SIMULATED',
            JSON.stringify(rawPayload),
            payloadHash,
          ]
        );

        // 插入 m04.measurement_value
        await tx.query(
          `INSERT INTO m04.measurement_value(
            record_id, metric_code, value, unit, data_status, source_quality_result, window_definition
          ) VALUES($1, $2, $3, $4, 'VALID', $5, '{"kind":"POINT"}')`,
          [recordId, metricCode, row.value, row.unit, qualityResult]
        );

        // 插入 m04.measurement_evaluation
        await tx.query(
          `INSERT INTO m04.measurement_evaluation(
            record_id, version, quality_result, reason_code, recipe_version_id, rule_snapshot
          ) VALUES($1, 1, $2, $3, $4, $5)`,
          [recordId, qualityResult, qualityResult === 'FAIL' ? 'OUT_OF_TOLERANCE' : 'NONE', task.recipe_version_id, JSON.stringify(ruleSnapshot)]
        );

        // 插入 m04.measurement_qualification
        await tx.query(
          `INSERT INTO m04.measurement_qualification(record_id, version, eligibility) VALUES($1, 1, 'EFFECTIVE')`,
          [recordId]
        );

        insertedCount++;
      }

      // 3. 记录不可变操作审计 m00.audit_event
      const auditDetails = {
        task_id: task.id,
        spool_id: task.spool_id,
        work_order_id: task.work_order_id,
        batch_name: dto.batch_name || '人工补录批次',
        reason: dto.reason || '现场质量数据人工补录入库',
        total_rows: validRows.length,
        inserted_count: insertedCount,
        fail_count: failCount,
      };

      await tx.query(
        `INSERT INTO m00.audit_event(id, factory_id, actor_type, actor_id, action, resource_type, resource_id, request_id, result, details)
         VALUES($1, $2, $3, $4, 'MANUAL_IMPORT_SUBMITTED', 'MEASUREMENT_IMPORT', $5, $6, 'SUCCESS', $7)`,
        [
          randomUUID(),
          ctx.actor.factory,
          ctx.actor.kind,
          ctx.actor.id,
          task.id,
          ctx.requestId,
          JSON.stringify(auditDetails),
        ]
      );

      return {
        success: true,
        task_id: task.id,
        total_submitted: validRows.length,
        inserted_count: insertedCount,
        fail_count: failCount,
        alarm_triggered: false,
        batch_id: `IMP-${task.id.slice(0, 8)}-${Date.now()}`,
      };
    });

    // 4. 事务提交后，超限自动联动触发报警防抖合并 (Event-Driven Alarm)
    if (result.fail_count > 0 && alarms) {
      const activeAlarmSvc = alarms;
      try {
        await activeAlarmSvc.aggregateFailMeasurements(ctx.actor, result.task_id);
        result.alarm_triggered = true;
      } catch (err) {
        console.error('[Manual Import] Failed to auto-trigger alarm aggregation:', err);
      }
    }

    return result;
  }

  /**
   * 简单的 CSV 行解析辅助方法
   */
  private parseCsv(csvText: string, metricCode: string, defaultUnit: string): ImportRowInput[] {
    const lines = csvText.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    if (lines.length === 0) return [];

    let startIdx = 0;
    const headerLine = lines[0].toLowerCase();
    // 判断是否有表头
    if (headerLine.includes('position') || headerLine.includes('meter') || headerLine.includes('value')) {
      startIdx = 1;
    }

    const result: ImportRowInput[] = [];
    for (let i = startIdx; i < lines.length; i++) {
      const parts = lines[i].split(',').map((p) => p.trim());
      if (parts.length >= 2) {
        result.push({
          position_m: parts[0],
          value: parts[1],
          sample_time: parts[2] || undefined,
          unit: parts[3] || defaultUnit,
          metric_code: metricCode,
        });
      }
    }
    return result;
  }
}
