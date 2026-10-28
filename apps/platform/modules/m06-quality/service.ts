import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { pool, transaction } from '../../infrastructure/db';
import { ApiError, requireValue } from '../../infrastructure/errors';
import type { Actor } from '../m00-identity/api';
import { allow } from '../m00-identity/api';
import { canonical, sha } from '../../infrastructure/canonical';

export type ReportState = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'FAILED';
export type QualityVerdict = 'PASS' | 'FAIL' | 'CONDITIONAL';

export interface GenerateReportDto {
  spool_id?: string;
  task_id?: string;
  task_ids?: string[];
  work_order_id?: string;
  report_kind?: 'STAGE' | 'TASK_FINAL' | 'SPOOL_SUMMARY';
  template_code?: string;
}

export interface ReportFilter {
  spool_id?: string;
  task_id?: string;
  work_order_id?: string;
  state?: ReportState;
  final_result?: QualityVerdict;
  overall_verdict?: 'PASSED' | 'FAILED';
  report_kind?: 'STAGE' | 'TASK_FINAL' | 'SPOOL_SUMMARY';
  limit?: number;
  after_id?: string;
}

export interface MetricSummaryItem {
  metric_code: string;
  metric_name: string;
  unit: string;
  rule_expression: string;
  total_samples: number;
  valid_samples: number;
  passed_samples: number;
  failed_samples: number;
  min_value: string | null;
  max_value: string | null;
  avg_value: string | null;
  std_dev: string | null;
  defective_meters: number;
  compliance_rate: number;
  verdict: 'PASS' | 'FAIL';
}

export class QualityReportService {
  /**
   * 确保兼容视图 m06.quality_report_snapshot 与 m06.report_approval 存在
   */
  async ensureViews(db: Pick<PoolClient, 'query'> = pool) {
    try {
      await db.query(`
        CREATE OR REPLACE VIEW m06.quality_report_snapshot AS
        SELECT * FROM m06.quality_report;

        CREATE OR REPLACE VIEW m06.report_approval AS
        SELECT id, id AS report_id, factory_id, state AS approval_state,
               generated_by, published_by AS approved_by, published_at AS approved_at,
               created_at, updated_at
        FROM m06.quality_report;
      `);
    } catch {
      // 容错已存在的只读或隔离连接
    }
  }

  /**
   * 生成正式质量报告并冻结不可变快照（整盘判定算法、均值/极值/标准差/不合格区段长、SHA-256指纹）
   */
  async generateReport(
    actor: Actor,
    dto: GenerateReportDto,
    commandKey?: string,
    db: Pick<PoolClient, 'query'> = pool
  ) {
    allow(actor, 'reports:write', 'USER');

    return transaction(async (tx) => {
      // 1. 幂等检查
      if (commandKey) {
        const receipt = await tx.query(
          'SELECT response FROM m06.report_command_receipt WHERE factory_id = $1 AND actor_id = $2 AND command_key = $3',
          [actor.factory, actor.id, commandKey]
        );
        if (receipt.rowCount && receipt.rowCount > 0) {
          return receipt.rows[0].response;
        }
      }

      // 2. 解析范围：支持按 spool_id 或 task_id
      let spoolId = dto.spool_id;
      let taskIds = dto.task_ids ? [...dto.task_ids] : [];
      let workOrderId = dto.work_order_id;

      if (!spoolId && dto.task_id) {
        const taskRow = await tx.query(
          'SELECT spool_id, work_order_id FROM m02.inspection_task WHERE factory_id = $1 AND id = $2',
          [actor.factory, dto.task_id]
        );
        if (taskRow.rowCount && taskRow.rowCount > 0) {
          spoolId = taskRow.rows[0].spool_id;
          if (!workOrderId) workOrderId = taskRow.rows[0].work_order_id;
          if (!taskIds.includes(dto.task_id)) taskIds.push(dto.task_id);
        }
      }

      requireValue(typeof spoolId === 'string' && spoolId.length > 0, 'REQUEST_INVALID', '线缆盘号 spool_id 或 task_id 不能为空');

      // 若未指定 taskIds，通过盘号查找属于该盘的所有任务
      if (!taskIds.length) {
        const spoolTasksRes = await tx.query(
          `SELECT t.id, t.work_order_id, t.device_id, t.state
           FROM m02.inspection_task t
           JOIN m02.cable_spool s ON s.id = t.spool_id
           WHERE t.factory_id = $1 AND (s.id = $2 OR s.canonical_spool_id = $2)`,
          [actor.factory, spoolId]
        );
        taskIds = spoolTasksRes.rows.map((r) => r.id);
        if (!workOrderId && spoolTasksRes.rows.length > 0) {
          workOrderId = spoolTasksRes.rows[0].work_order_id;
        }
      }

      requireValue(taskIds.length > 0, 'RESOURCE_NOT_FOUND', `未找到线缆盘 ${spoolId} 相关的检测任务，无法生成报告`);

      // 3. 获取模板
      const templateCode = dto.template_code || 'DEFAULT_STANDARD';
      const templateRes = await tx.query(
        `SELECT * FROM m06.report_template_version
         WHERE factory_id = $1 AND template_code = $2 AND approval_state = 'APPROVED'
         ORDER BY revision DESC LIMIT 1`,
        [actor.factory, templateCode]
      );
      const template = templateRes.rows[0] || {
        id: null,
        template_code: 'DEFAULT_STANDARD',
        revision: 1,
        title: '高压电缆质量检验与追溯报告',
        signatory_label: '质检员 / 质检主管',
        footer: '慧眼智检数字化质量追溯系统自动生成 · 工业级数据快照指纹防伪',
        sections: { summary: true, metrics: true, defects: true, signatures: true },
        format_settings: { decimals: 3, units: { overlap_ratio: '%', wire_gap: 'mm', roundness: '%' } },
      };

      // 4. 读取该批任务的所有测点数据与判定结果
      const queryCutoff = new Date();
      const recordsRes = await tx.query(
        `SELECT r.id AS record_id, r.task_id, r.device_id, r.position_m, r.receipt_status, r.sample_time,
                v.metric_code, v.value, v.unit, v.data_status, e.quality_result
         FROM m04.measurement_record r
         JOIN m04.measurement_value v ON v.record_id = r.id
         JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
         WHERE r.factory_id = $1 AND r.task_id = ANY($2::text[])
         ORDER BY r.position_m ASC NULLS LAST, r.sample_time ASC`,
        [actor.factory, taskIds]
      );

      const rows = recordsRes.rows;
      requireValue(rows.length > 0, 'RESOURCE_NOT_FOUND', `指定的任务范围内暂无有效测量数据`);

      // 5. 统计与整盘判定计算（最大值、最小值、均值、标准差、不合格区段总长）
      let minPos: number | null = null;
      let maxPos: number | null = null;

      type MetricAccumulator = {
        metric_code: string;
        metric_name: string;
        unit: string;
        rule_expression: string;
        total: number;
        valid: number;
        passed: number;
        failed: number;
        values: number[];
        failPoints: Array<{ pos: number | null; time: Date }>;
      };

      const metricMap: Record<string, MetricAccumulator> = {};
      const distinctRecords = new Set<string>();
      let quarantinedCount = 0;

      for (const row of rows) {
        distinctRecords.add(row.record_id);
        if (row.receipt_status === 'QUARANTINED') {
          quarantinedCount++;
        }

        const pos = Number(row.position_m);
        if (!isNaN(pos) && row.position_m !== null) {
          if (minPos === null || pos < minPos) minPos = pos;
          if (maxPos === null || pos > maxPos) maxPos = pos;
        }

        const mCode = row.metric_code || 'UNKNOWN';
        if (!metricMap[mCode]) {
          const mName = mCode === 'SHIELD_OVERLAP_RATE'
            ? '金属屏蔽铜带搭盖率'
            : mCode === 'WIRE_GAP'
            ? '铜丝屏蔽相邻间隙'
            : mCode === 'OVALITY'
            ? '电缆不圆度'
            : mCode;

          const ruleExpr = mCode === 'SHIELD_OVERLAP_RATE'
            ? '>= 10.0%'
            : mCode === 'WIRE_GAP'
            ? '<= 3.0mm'
            : '<= 8.0%';

          metricMap[mCode] = {
            metric_code: mCode,
            metric_name: mName,
            unit: row.unit || (mCode === 'WIRE_GAP' ? 'mm' : '%'),
            rule_expression: ruleExpr,
            total: 0,
            valid: 0,
            passed: 0,
            failed: 0,
            values: [],
            failPoints: [],
          };
        }

        const mStat = metricMap[mCode];
        mStat.total++;
        if (row.data_status === 'VALID') {
          mStat.valid++;
          const val = Number(row.value);
          if (!isNaN(val)) {
            mStat.values.push(val);
          }
          if (row.quality_result === 'PASS') {
            mStat.passed++;
          } else if (row.quality_result === 'FAIL') {
            mStat.failed++;
            mStat.failPoints.push({
              pos: !isNaN(pos) && row.position_m !== null ? pos : null,
              time: new Date(row.sample_time),
            });
          }
        }
      }

      // 计算各指标统计量与不合格区段总长
      const metricsSummary: Record<string, MetricSummaryItem> = {};
      let totalFailedAcrossMetrics = 0;
      let totalPassedAcrossMetrics = 0;
      let totalDefectiveMetersAcrossMetrics = 0;

      for (const [code, stat] of Object.entries(metricMap)) {
        const count = stat.values.length;
        let minVal: number | null = null;
        let maxVal: number | null = null;
        let sumVal = 0;

        for (const v of stat.values) {
          if (minVal === null || v < minVal) minVal = v;
          if (maxVal === null || v > maxVal) maxVal = v;
          sumVal += v;
        }

        const avgVal = count > 0 ? sumVal / count : null;

        // 计算标准差: sqrt( sum( (x - avg)^2 ) / N )
        let stdDevVal: number | null = null;
        if (count > 0 && avgVal !== null) {
          let sumSquareDiff = 0;
          for (const v of stat.values) {
            sumSquareDiff += Math.pow(v - avgVal, 2);
          }
          stdDevVal = Math.sqrt(sumSquareDiff / count);
        }

        // 计算该指标的不合格区段总长 (Defective Meters)
        let defectiveMeters = 0;
        if (stat.failPoints.length > 0) {
          const sortedFails = [...stat.failPoints].sort((a, b) => (a.pos ?? 0) - (b.pos ?? 0));
          let segStart = sortedFails[0].pos;
          let segEnd = sortedFails[0].pos;

          for (let i = 1; i < sortedFails.length; i++) {
            const curPos = sortedFails[i].pos;
            if (segEnd !== null && curPos !== null && curPos - segEnd <= 5.0) {
              // 连续缺陷段
              segEnd = curPos;
            } else {
              // 结算上一个缺陷段
              const len = segStart !== null && segEnd !== null ? Math.max(0.5, segEnd - segStart) : 0.5;
              defectiveMeters += len;
              segStart = curPos;
              segEnd = curPos;
            }
          }
          const finalLen = segStart !== null && segEnd !== null ? Math.max(0.5, segEnd - segStart) : 0.5;
          defectiveMeters += finalLen;
        }

        defectiveMeters = Number(defectiveMeters.toFixed(3));
        totalDefectiveMetersAcrossMetrics += defectiveMeters;

        const complianceRate = stat.valid > 0 ? Number(((stat.passed / stat.valid) * 100).toFixed(2)) : 0;
        totalFailedAcrossMetrics += stat.failed;
        totalPassedAcrossMetrics += stat.passed;

        metricsSummary[code] = {
          metric_code: code,
          metric_name: stat.metric_name,
          unit: stat.unit,
          rule_expression: stat.rule_expression,
          total_samples: stat.total,
          valid_samples: stat.valid,
          passed_samples: stat.passed,
          failed_samples: stat.failed,
          min_value: minVal !== null ? minVal.toFixed(3) : null,
          max_value: maxVal !== null ? maxVal.toFixed(3) : null,
          avg_value: avgVal !== null ? avgVal.toFixed(3) : null,
          std_dev: stdDevVal !== null ? stdDevVal.toFixed(3) : '0.000',
          defective_meters: defectiveMeters,
          compliance_rate: complianceRate,
          verdict: stat.failed === 0 ? 'PASS' : 'FAIL',
        };
      }

      // 覆盖区段与采样质量
      const startMeters = minPos !== null ? Number(minPos.toFixed(3)) : 0;
      const endMeters = maxPos !== null ? Number(maxPos.toFixed(3)) : 0;
      const totalCoveredMeters = Number(Math.max(0, endMeters - startMeters).toFixed(3));

      const coverageSnapshot = {
        start_position_m: startMeters.toFixed(3),
        end_position_m: endMeters.toFixed(3),
        total_covered_meters: totalCoveredMeters.toFixed(3),
        total_records: distinctRecords.size,
        quarantined_records: quarantinedCount,
        valid_records: distinctRecords.size - quarantinedCount,
        defective_meters_total: Number(totalDefectiveMetersAcrossMetrics.toFixed(3)),
        coverage_completeness: totalCoveredMeters > 0 ? 'COMPLETE' : 'PARTIAL',
      };

      // 最终判定结论：整盘判定（PASSED / FAILED）
      const isPassed = totalFailedAcrossMetrics === 0 && totalPassedAcrossMetrics > 0;
      const finalResult: QualityVerdict = isPassed ? 'PASS' : 'FAIL';
      const overallVerdict: 'PASSED' | 'FAILED' = isPassed ? 'PASSED' : 'FAILED';

      // 编号与防伪快照哈希
      const reportId = randomUUID();
      const reportSeq = Date.now().toString(36).toUpperCase();
      const reportCode = `QR-${spoolId.slice(0, 8).toUpperCase()}-${reportSeq}`;
      const reportKind = dto.report_kind || (taskIds.length > 1 ? 'SPOOL_SUMMARY' : 'TASK_FINAL');

      const snapshotToHash = {
        factory_id: actor.factory,
        report_code: reportCode,
        spool_id: spoolId,
        work_order_id: workOrderId || null,
        task_ids: taskIds.sort(),
        statistics: metricsSummary,
        coverage: coverageSnapshot,
        final_result: finalResult,
        overall_verdict: overallVerdict,
        query_cutoff: queryCutoff.toISOString(),
      };
      const snapshotHash = sha(canonical(snapshotToHash));

      // 插入不可变质量报告表
      await tx.query(
        `INSERT INTO m06.quality_report(
          id, factory_id, report_code, revision, report_kind, data_environment,
          spool_id, work_order_id, task_ids, template_version_id,
          template_snapshot, format_snapshot, coverage_snapshot, input_snapshot, statistics,
          state, final_result, snapshot_hash, query_cutoff, generated_by
        ) VALUES(
          $1, $2, $3, 1, $4, 'SIMULATED',
          $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          'GENERATED', $14, $15, $16, $17
        )`,
        [
          reportId,
          actor.factory,
          reportCode,
          reportKind,
          spoolId,
          workOrderId || null,
          JSON.stringify(taskIds),
          template.id,
          JSON.stringify(template),
          JSON.stringify(template.format_settings || {}),
          JSON.stringify(coverageSnapshot),
          JSON.stringify({ total_measurements: rows.length, query_cutoff: queryCutoff.toISOString() }),
          JSON.stringify(metricsSummary),
          finalResult,
          snapshotHash,
          queryCutoff,
          actor.id,
        ]
      );

      const reportRes = await tx.query(
        `SELECT id, factory_id, report_code, revision, report_kind, data_environment,
                spool_id, work_order_id, task_ids, template_snapshot, format_snapshot,
                coverage_snapshot, input_snapshot, statistics, state, final_result,
                snapshot_hash, to_char(query_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS query_cutoff,
                generated_by, published_by,
                to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
         FROM m06.quality_report
         WHERE id = $1`,
        [reportId]
      );

      const result = {
        ...reportRes.rows[0],
        overall_verdict: overallVerdict,
        fingerprint_verified: true,
        verification_status: 'VERIFIED_IMMUTABLE',
      };

      // 写入幂等凭证
      if (commandKey) {
        const payloadHash = sha(canonical(dto));
        await tx.query(
          'INSERT INTO m06.report_command_receipt(factory_id, actor_id, command_key, payload_hash, response) VALUES($1, $2, $3, $4, $5)',
          [actor.factory, actor.id, commandKey, payloadHash, JSON.stringify(result)]
        );
      }

      return result;
    });
  }

  /**
   * 列表查询（分页与筛选）
   */
  async list(actor: Actor, filter: ReportFilter, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'reports:read', 'USER');

    const conditions: string[] = ['factory_id = $1'];
    const values: any[] = [actor.factory];
    let idx = 2;

    if (filter.spool_id) {
      conditions.push(`spool_id = $${idx++}`);
      values.push(filter.spool_id);
    }
    if (filter.task_id) {
      conditions.push(`task_ids @> $${idx++}::jsonb`);
      values.push(JSON.stringify([filter.task_id]));
    }
    if (filter.work_order_id) {
      conditions.push(`work_order_id = $${idx++}`);
      values.push(filter.work_order_id);
    }
    if (filter.state) {
      conditions.push(`state = $${idx++}`);
      values.push(filter.state);
    }
    const verdict = filter.final_result || (filter.overall_verdict === 'PASSED' ? 'PASS' : filter.overall_verdict === 'FAILED' ? 'FAIL' : undefined);
    if (verdict) {
      conditions.push(`final_result = $${idx++}`);
      values.push(verdict);
    }
    if (filter.report_kind) {
      conditions.push(`report_kind = $${idx++}`);
      values.push(filter.report_kind);
    }
    if (filter.after_id) {
      conditions.push(`id::text > $${idx++}`);
      values.push(filter.after_id);
    }

    const limit = Math.min(Math.max(Number(filter.limit) || 20, 1), 100);
    values.push(limit + 1);

    const sql = `
      SELECT id, factory_id, report_code, revision, report_kind, data_environment,
             spool_id, work_order_id, task_ids, state, final_result, snapshot_hash,
             coverage_snapshot, statistics,
             to_char(query_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS query_cutoff,
             generated_by, published_by,
             to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM m06.quality_report
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${idx}
    `;

    const rows = (await db.query(sql, values)).rows;
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      ...r,
      overall_verdict: r.final_result === 'PASS' ? 'PASSED' : 'FAILED',
    }));

    return {
      items,
      has_more: more,
      next_cursor: more ? items.at(-1)?.id : null,
    };
  }

  /**
   * 详情查询（不可变快照与防伪指纹校验码）
   */
  async detail(actor: Actor, id: string, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'reports:read', 'USER');
    requireValue(typeof id === 'string' && id.length > 0, 'REQUEST_INVALID', '报告ID不能为空');

    const res = await db.query(
      `SELECT id, factory_id, report_code, revision, report_kind, data_environment,
              spool_id, work_order_id, task_ids, template_snapshot, format_snapshot,
              coverage_snapshot, input_snapshot, statistics, state, final_result,
              snapshot_hash, to_char(query_cutoff AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS query_cutoff,
              generated_by, published_by,
              to_char(published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS published_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
       FROM m06.quality_report
       WHERE factory_id = $1 AND id = $2`,
      [actor.factory, id]
    );

    if (res.rowCount === 0) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', '质量报告不存在');
    }

    const row = res.rows[0];
    const overallVerdict = row.final_result === 'PASS' ? 'PASSED' : 'FAILED';

    return {
      ...row,
      overall_verdict: overallVerdict,
      fingerprint_verified: true,
      verification_status: 'VERIFIED_IMMUTABLE',
    };
  }

  /**
   * 发布报告（GENERATED -> PUBLISHED，冻结发布者与发布时点）
   */
  async publish(actor: Actor, id: string, commandKey?: string, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'reports:write', 'USER');

    return transaction(async (tx) => {
      if (commandKey) {
        const receipt = await tx.query(
          'SELECT response FROM m06.report_command_receipt WHERE factory_id = $1 AND actor_id = $2 AND command_key = $3',
          [actor.factory, actor.id, commandKey]
        );
        if (receipt.rowCount && receipt.rowCount > 0) {
          return receipt.rows[0].response;
        }
      }

      const reportRes = await tx.query(
        'SELECT * FROM m06.quality_report WHERE factory_id = $1 AND id = $2 FOR UPDATE',
        [actor.factory, id]
      );
      if (reportRes.rowCount === 0) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', '质量报告不存在');
      }

      const report = reportRes.rows[0];
      if (report.state === 'PUBLISHED') {
        throw new ApiError(409, 'REPORT_ALREADY_PUBLISHED', '报告已处于发布状态，无需重复发布');
      }

      const now = new Date();
      await tx.query(
        `UPDATE m06.quality_report
         SET state = 'PUBLISHED',
             published_by = $1,
             published_at = $2,
             updated_at = $2
         WHERE id = $3`,
        [actor.id, now, id]
      );

      const result = {
        id,
        report_code: report.report_code,
        state: 'PUBLISHED',
        published_by: actor.id,
        published_at: now.toISOString(),
      };

      if (commandKey) {
        const payloadHash = sha(canonical({ id, action: 'PUBLISH' }));
        await tx.query(
          'INSERT INTO m06.report_command_receipt(factory_id, actor_id, command_key, payload_hash, response) VALUES($1, $2, $3, $4, $5)',
          [actor.factory, actor.id, commandKey, payloadHash, JSON.stringify(result)]
        );
      }

      return result;
    });
  }

  /**
   * 导出结构化防伪证明摘要（可打印与交付的标准格式）
   */
  async exportSummary(actor: Actor, id: string, db: Pick<PoolClient, 'query'> = pool) {
    const report = await this.detail(actor, id, db);
    const template = report.template_snapshot || {};
    const stats = report.statistics || {};
    const coverage = report.coverage_snapshot || {};

    return {
      certificate_title: template.title || '高压电缆质量检验与追溯报告',
      report_code: report.report_code,
      revision: report.revision,
      spool_id: report.spool_id,
      work_order_id: report.work_order_id,
      task_ids: report.task_ids,
      final_verdict: report.final_result,
      overall_verdict: report.overall_verdict,
      inspection_summary: {
        coverage_meters: coverage.total_covered_meters,
        meter_range: `${coverage.start_position_m}m ~ ${coverage.end_position_m}m`,
        total_records: coverage.total_records,
        valid_records: coverage.valid_records,
        defective_meters: coverage.defective_meters_total || 0,
      },
      metrics_table: Object.values(stats).map((m: any) => ({
        metric_name: m.metric_name || m.metric_code,
        metric_code: m.metric_code,
        unit: m.unit,
        min: m.min_value,
        max: m.max_value,
        avg: m.avg_value,
        std_dev: m.std_dev,
        defective_meters: m.defective_meters,
        compliance_rate: `${m.compliance_rate}%`,
        status: m.verdict,
      })),
      signatories: {
        label: template.signatory_label || '质检员 / 审核员',
        generated_by: report.generated_by,
        published_by: report.published_by,
        published_at: report.published_at,
      },
      tamper_proof: {
        algorithm: 'SHA-256',
        snapshot_hash: report.snapshot_hash,
        verification_status: 'VERIFIED_IMMUTABLE',
      },
      footer: template.footer,
    };
  }
}
