import type { PoolClient } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { pool, transaction } from '../../infrastructure/db';
import { ApiError, requireValue } from '../../infrastructure/errors';
import type { Actor, IdentityApi } from '../m00-identity/api';
import { allow } from '../m00-identity/api';

export type AlarmBusinessStatus = 'TRIGGERED' | 'ACKNOWLEDGED' | 'HANDLED' | 'VERIFIED_CLOSED';
export type AlarmDbHandlingState = 'PENDING' | 'PROCESSING' | 'HANDLED' | 'REVIEWED';

export function mapDbToBusinessStatus(dbState: AlarmDbHandlingState): AlarmBusinessStatus {
  switch (dbState) {
    case 'PENDING':
      return 'TRIGGERED';
    case 'PROCESSING':
      return 'ACKNOWLEDGED';
    case 'HANDLED':
      return 'HANDLED';
    case 'REVIEWED':
      return 'VERIFIED_CLOSED';
    default:
      return 'TRIGGERED';
  }
}

export function mapBusinessToDbStatus(status?: string): AlarmDbHandlingState | undefined {
  if (!status) return undefined;
  const s = status.toUpperCase();
  if (s === 'TRIGGERED' || s === 'PENDING') return 'PENDING';
  if (s === 'ACKNOWLEDGED' || s === 'PROCESSING') return 'PROCESSING';
  if (s === 'HANDLED') return 'HANDLED';
  if (s === 'VERIFIED_CLOSED' || s === 'REVIEWED' || s === 'CLOSED') return 'REVIEWED';
  return undefined;
}

export interface AlarmFilter {
  status?: string;
  handling_state?: AlarmDbHandlingState;
  lifecycle?: 'ACTIVE' | 'RECOVERED';
  metric?: string;
  metric_code?: string;
  device_id?: string;
  task_id?: string;
  severity?: string;
  limit?: number;
  after_id?: string;
}

export interface HandleAlarmDto {
  opinion: string;
  action_plan?: string;
  evidence_refs?: Array<{ name: string; url: string }>;
}

export interface CloseAlarmDto {
  approved?: boolean;
  opinion: string;
  evidence_refs?: Array<{ name: string; url: string }>;
}

export interface ReviewAlarmDto {
  approved: boolean;
  opinion: string;
}

export class AlarmService {
  constructor(private readonly identity?: IdentityApi) {}

  /**
   * 列表查询（分页与筛选），同时支持 status 与 handling_state，metric 与 metric_code
   */
  async list(actor: Actor, filter: AlarmFilter, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'alarms:read', 'USER');

    const conditions: string[] = ['factory_id = $1'];
    const values: any[] = [actor.factory];
    let idx = 2;

    const targetDbState = mapBusinessToDbStatus(filter.status || filter.handling_state);
    if (targetDbState) {
      conditions.push(`handling_state = $${idx++}`);
      values.push(targetDbState);
    }
    if (filter.lifecycle) {
      conditions.push(`lifecycle = $${idx++}`);
      values.push(filter.lifecycle);
    }
    const metric = filter.metric_code || filter.metric;
    if (metric) {
      conditions.push(`metric_code = $${idx++}`);
      values.push(metric);
    }
    if (filter.device_id) {
      conditions.push(`device_id = $${idx++}`);
      values.push(filter.device_id);
    }
    if (filter.task_id) {
      conditions.push(`task_id = $${idx++}`);
      values.push(filter.task_id);
    }
    if (filter.severity) {
      conditions.push(`severity = $${idx++}`);
      values.push(filter.severity);
    }
    if (filter.after_id) {
      conditions.push(`id > $${idx++}`);
      values.push(filter.after_id);
    }

    const limit = Math.min(Math.max(filter.limit || 50, 1), 100);
    values.push(limit + 1);

    const sql = `
      SELECT id, factory_id, device_id, task_id, spool_id, work_order_id,
             source_alarm_key, alarm_type, metric_code, severity, lifecycle, handling_state,
             sample_count, start_position_m::text, end_position_m::text, peak_value::text, unit,
             to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at,
             acknowledged_by,
             to_char(triggered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS triggered_at,
             to_char(recovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recovered_at,
             version, created_at
      FROM m05.alarm_event
      WHERE ${conditions.join(' AND ')}
      ORDER BY triggered_at DESC, id DESC
      LIMIT $${idx}
    `;

    const rows = (await db.query(sql, values)).rows;
    const more = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({
      ...r,
      status: mapDbToBusinessStatus(r.handling_state),
    }));

    return {
      items,
      has_more: more,
      next_cursor: more ? items.at(-1)?.id : null,
    };
  }

  /**
   * 报警详情查询（含关联行动审计历史与业务状态）
   */
  async detail(actor: Actor, id: string, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'alarms:read', 'USER');
    requireValue(typeof id === 'string' && id.length > 0, 'REQUEST_INVALID', '报警ID不能为空');

    const eventRes = await db.query(
      `SELECT *,
              start_position_m::text, end_position_m::text, peak_value::text,
              to_char(acknowledged_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acknowledged_at,
              to_char(triggered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS triggered_at,
              to_char(recovered_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS recovered_at
       FROM m05.alarm_event
       WHERE factory_id = $1 AND id = $2`,
      [actor.factory, id]
    );

    if (eventRes.rowCount === 0) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', '报警事件不存在');
    }

    const alarm = eventRes.rows[0];
    const actionsRes = await db.query(
      `SELECT id, action, actor_id, actor_name, from_state, to_state, opinion, evidence_refs,
              to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS occurred_at
       FROM m05.alarm_action
       WHERE alarm_id = $1
       ORDER BY occurred_at ASC`,
      [id]
    );

    return {
      ...alarm,
      status: mapDbToBusinessStatus(alarm.handling_state),
      actions: actionsRes.rows,
    };
  }

  /**
   * 确认报警（Acknowledge）：TRIGGERED (PENDING) -> ACKNOWLEDGED (PROCESSING)
   */
  async acknowledge(
    actor: Actor,
    id: string,
    commandKey: string,
    db: Pick<PoolClient, 'query'> = pool
  ) {
    allow(actor, 'alarms:write', 'USER');

    return transaction(async (tx) => {
      // 幂等检查
      if (commandKey) {
        const receipt = await tx.query(
          'SELECT response FROM m05.alarm_command_receipt WHERE factory_id = $1 AND actor_id = $2 AND command_key = $3',
          [actor.factory, actor.id, commandKey]
        );
        if (receipt.rowCount && receipt.rowCount > 0) {
          return receipt.rows[0].response;
        }
      }

      const alarmRes = await tx.query(
        'SELECT * FROM m05.alarm_event WHERE factory_id = $1 AND id = $2 FOR UPDATE',
        [actor.factory, id]
      );
      if (alarmRes.rowCount === 0) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', '报警事件不存在');
      }

      const alarm = alarmRes.rows[0];
      if (alarm.handling_state !== 'PENDING') {
        throw new ApiError(409, 'ALARM_STATE_INVALID', `当前报警状态为 ${alarm.handling_state}，无需重复确认`);
      }

      const now = new Date();
      await tx.query(
        `UPDATE m05.alarm_event
         SET handling_state = 'PROCESSING',
             acknowledged_at = $1,
             acknowledged_by = $2,
             version = version + 1,
             updated_at = $1
         WHERE id = $3`,
        [now, actor.id, id]
      );

      await tx.query(
        `INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at, command_key)
         VALUES($1, $2, 'ACKNOWLEDGE', $3, $4, 'PENDING', 'PROCESSING', '操作员已确认看到报警', $5, $6)`,
        [randomUUID(), id, actor.id, (actor as any).name || actor.id, now, commandKey]
      );

      const result = {
        id,
        status: 'ACKNOWLEDGED',
        handling_state: 'PROCESSING',
        acknowledged_at: now.toISOString(),
        acknowledged_by: actor.id,
      };

      if (commandKey) {
        const hash = createHash('sha256').update(JSON.stringify({ id, action: 'ACK' })).digest('hex');
        await tx.query(
          'INSERT INTO m05.alarm_command_receipt(factory_id, actor_id, command_key, payload_hash, response) VALUES($1, $2, $3, $4, $5)',
          [actor.factory, actor.id, commandKey, hash, JSON.stringify(result)]
        );
      }

      return result;
    });
  }

  /**
   * 登记处置措施与原因（Handle）：PROCESSING / PENDING -> HANDLED
   */
  async handle(
    actor: Actor,
    id: string,
    dto: HandleAlarmDto,
    commandKey: string,
    db: Pick<PoolClient, 'query'> = pool
  ) {
    allow(actor, 'alarms:write', 'USER');
    requireValue(typeof dto?.opinion === 'string' && dto.opinion.trim().length > 0, 'REQUEST_INVALID', '处置意见不能为空');

    return transaction(async (tx) => {
      if (commandKey) {
        const receipt = await tx.query(
          'SELECT response FROM m05.alarm_command_receipt WHERE factory_id = $1 AND actor_id = $2 AND command_key = $3',
          [actor.factory, actor.id, commandKey]
        );
        if (receipt.rowCount && receipt.rowCount > 0) {
          return receipt.rows[0].response;
        }
      }

      const alarmRes = await tx.query(
        'SELECT * FROM m05.alarm_event WHERE factory_id = $1 AND id = $2 FOR UPDATE',
        [actor.factory, id]
      );
      if (alarmRes.rowCount === 0) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', '报警事件不存在');
      }

      const alarm = alarmRes.rows[0];
      if (alarm.handling_state === 'HANDLED' || alarm.handling_state === 'REVIEWED') {
        throw new ApiError(409, 'ALARM_STATE_INVALID', `报警当前处于 ${alarm.handling_state}，已完成处置`);
      }

      const fromState = alarm.handling_state;
      const now = new Date();

      await tx.query(
        `UPDATE m05.alarm_event
         SET handling_state = 'HANDLED',
             acknowledged_at = COALESCE(acknowledged_at, $1),
             acknowledged_by = COALESCE(acknowledged_by, $2),
             version = version + 1,
             updated_at = $1
         WHERE id = $3`,
        [now, actor.id, id]
      );

      await tx.query(
        `INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, evidence_refs, occurred_at, command_key)
         VALUES($1, $2, 'HANDLE', $3, $4, $5, 'HANDLED', $6, $7, $8, $9)`,
        [
          randomUUID(),
          id,
          actor.id,
          (actor as any).name || actor.id,
          fromState,
          dto.opinion.trim(),
          JSON.stringify(dto.evidence_refs || []),
          now,
          commandKey,
        ]
      );

      const result = {
        id,
        status: 'HANDLED',
        handling_state: 'HANDLED',
        handled_by: actor.id,
        handled_at: now.toISOString(),
      };

      if (commandKey) {
        const hash = createHash('sha256').update(JSON.stringify({ id, dto })).digest('hex');
        await tx.query(
          'INSERT INTO m05.alarm_command_receipt(factory_id, actor_id, command_key, payload_hash, response) VALUES($1, $2, $3, $4, $5)',
          [actor.factory, actor.id, commandKey, hash, JSON.stringify(result)]
        );
      }

      return result;
    });
  }

  /**
   * 主管复核关闭报警（Close）：HANDLED -> VERIFIED_CLOSED (REVIEWED)，并写入 audit 记录
   */
  async close(
    actor: Actor,
    id: string,
    dto: CloseAlarmDto,
    commandKey: string,
    requestId: string = randomUUID(),
    db: Pick<PoolClient, 'query'> = pool
  ) {
    allow(actor, 'alarms:write', 'USER');
    const opinion = typeof dto?.opinion === 'string' && dto.opinion.trim().length > 0
      ? dto.opinion.trim()
      : '主管复核通过并确认结案归档';

    return transaction(async (tx) => {
      if (commandKey) {
        const receipt = await tx.query(
          'SELECT response FROM m05.alarm_command_receipt WHERE factory_id = $1 AND actor_id = $2 AND command_key = $3',
          [actor.factory, actor.id, commandKey]
        );
        if (receipt.rowCount && receipt.rowCount > 0) {
          return receipt.rows[0].response;
        }
      }

      const alarmRes = await tx.query(
        'SELECT * FROM m05.alarm_event WHERE factory_id = $1 AND id = $2 FOR UPDATE',
        [actor.factory, id]
      );
      if (alarmRes.rowCount === 0) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', '报警事件不存在');
      }

      const alarm = alarmRes.rows[0];
      if (alarm.handling_state !== 'HANDLED') {
        throw new ApiError(409, 'ALARM_STATE_INVALID', `只有已处置(HANDLED)的报警才可进行复核关闭，当前状态为 ${alarm.handling_state}`);
      }

      const isApproved = dto.approved !== false;
      const targetState = isApproved ? 'REVIEWED' : 'PROCESSING';
      const lifecycle = isApproved ? 'RECOVERED' : alarm.lifecycle;
      const now = new Date();

      await tx.query(
        `UPDATE m05.alarm_event
         SET handling_state = $1,
             lifecycle = $2,
             recovered_at = CASE WHEN $2 = 'RECOVERED' THEN $3 ELSE recovered_at END,
             version = version + 1,
             updated_at = $3
         WHERE id = $4`,
        [targetState, lifecycle, now, id]
      );

      await tx.query(
        `INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, evidence_refs, occurred_at, command_key)
         VALUES($1, $2, 'REVIEW', $3, $4, 'HANDLED', $5, $6, $7, $8, $9)`,
        [
          randomUUID(),
          id,
          actor.id,
          (actor as any).name || actor.id,
          targetState,
          `【主管复核${isApproved ? '结案关闭' : '驳回重办'}】${opinion}`,
          JSON.stringify(dto.evidence_refs || []),
          now,
          commandKey,
        ]
      );

      // 写入审计轨迹 (Audit Event)
      if (this.identity) {
        await this.identity.audit(
          { actor, requestId },
          isApproved ? 'ALARM_VERIFIED_CLOSED' : 'ALARM_REVIEW_REJECTED',
          'ALARM',
          id,
          {
            previous_state: 'HANDLED',
            target_state: targetState,
            opinion,
            approved: isApproved,
          },
          tx as any
        );
      } else {
        await tx.query(
          `INSERT INTO m00.audit_event(id, factory_id, actor_type, actor_id, action, resource_type, resource_id, request_id, result, details)
           VALUES($1, $2, $3, $4, $5, 'ALARM', $6, $7, 'SUCCESS', $8)`,
          [
            randomUUID(),
            actor.factory,
            actor.kind,
            actor.id,
            isApproved ? 'ALARM_VERIFIED_CLOSED' : 'ALARM_REVIEW_REJECTED',
            id,
            requestId,
            JSON.stringify({ previous_state: 'HANDLED', target_state: targetState, opinion, approved: isApproved }),
          ]
        );
      }

      const result = {
        id,
        status: isApproved ? 'VERIFIED_CLOSED' : 'ACKNOWLEDGED',
        handling_state: targetState,
        lifecycle,
        reviewed_by: actor.id,
        reviewed_at: now.toISOString(),
        approved: isApproved,
      };

      if (commandKey) {
        const hash = createHash('sha256').update(JSON.stringify({ id, dto })).digest('hex');
        await tx.query(
          'INSERT INTO m05.alarm_command_receipt(factory_id, actor_id, command_key, payload_hash, response) VALUES($1, $2, $3, $4, $5)',
          [actor.factory, actor.id, commandKey, hash, JSON.stringify(result)]
        );
      }

      return result;
    });
  }

  /**
   * 复核审批（兼容原 review 接口）：HANDLED -> REVIEWED (通过) 或回退至 PROCESSING
   */
  async review(
    actor: Actor,
    id: string,
    dto: ReviewAlarmDto,
    commandKey: string,
    requestId: string = randomUUID(),
    db: Pick<PoolClient, 'query'> = pool
  ) {
    return this.close(actor, id, dto, commandKey, requestId, db);
  }

  /**
   * 工业级报警生命周期引擎：基于滑动窗口（Sliding Window Debounce）聚合超限测点
   * 采样毛刺连续超限时，在时间窗口（如30秒）或连续米数（如5.0米）内合并为一个报警事件，
   * 动态更新 end_position_m、peak_value 与 sample_count，不得为每个超限点产生独立事件。
   */
  async aggregateFailMeasurements(
    actor: Actor,
    taskId?: string,
    options?: { windowSeconds?: number; windowMeters?: number }
  ) {
    allow(actor, 'alarms:write', 'USER');

    const windowSeconds = options?.windowSeconds ?? 30;
    const windowMeters = options?.windowMeters ?? 5.0;

    return transaction(async (tx) => {
      const sql = `
        SELECT r.id, r.factory_id, r.device_id, r.task_id, r.position_m, r.sample_time,
               v.metric_code, v.value, v.unit, t.spool_id, t.work_order_id
        FROM m04.measurement_record r
        JOIN m04.measurement_value v ON v.record_id = r.id
        JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
        LEFT JOIN m02.inspection_task t ON t.id = r.task_id
        WHERE r.factory_id = $1
          AND e.quality_result = 'FAIL'
          ${taskId ? 'AND r.task_id = $2' : ''}
        ORDER BY r.device_id, r.task_id, v.metric_code, r.position_m ASC NULLS LAST, r.sample_time ASC
      `;

      const values = taskId ? [actor.factory, taskId] : [actor.factory];
      const failPoints = (await tx.query(sql, values)).rows;

      let createdCount = 0;
      let updatedCount = 0;

      // 按分组进行滑动窗口防抖归纳
      type Cluster = {
        deviceId: string;
        taskId: string;
        spoolId: string;
        workOrderId: string;
        metricCode: string;
        unit: string;
        startPos: number | null;
        endPos: number | null;
        peakValue: number;
        firstSampleTime: Date;
        lastSampleTime: Date;
        sampleCount: number;
        records: string[];
      };

      const clusters: Cluster[] = [];

      for (const pt of failPoints) {
        const valNum = Number(pt.value);
        const posNum = pt.position_m !== null && pt.position_m !== undefined ? Number(pt.position_m) : null;
        const ptTime = new Date(pt.sample_time);

        // 尝试并入已存在的最后一个符合条件的 cluster
        let targetCluster: Cluster | null = null;
        for (let i = clusters.length - 1; i >= 0; i--) {
          const c = clusters[i];
          if (c.deviceId === pt.device_id && c.taskId === pt.task_id && c.metricCode === pt.metric_code) {
            // 判定米数或时间窗口防抖
            const posDiff = (posNum !== null && c.endPos !== null) ? Math.abs(posNum - c.endPos) : 0;
            const timeDiffSec = Math.abs(ptTime.getTime() - c.lastSampleTime.getTime()) / 1000;

            if (posDiff <= windowMeters || timeDiffSec <= windowSeconds) {
              targetCluster = c;
              break;
            }
          }
        }

        if (targetCluster) {
          // 防抖累加并入当前连续毛刺段
          targetCluster.sampleCount += 1;
          targetCluster.records.push(pt.id);
          targetCluster.lastSampleTime = ptTime;
          if (posNum !== null) {
            if (targetCluster.startPos === null || posNum < targetCluster.startPos) {
              targetCluster.startPos = posNum;
            }
            if (targetCluster.endPos === null || posNum > targetCluster.endPos) {
              targetCluster.endPos = posNum;
            }
          }
          // 峰值更新
          if (pt.metric_code === 'SHIELD_OVERLAP_RATE') {
            targetCluster.peakValue = Math.min(targetCluster.peakValue, valNum);
          } else {
            targetCluster.peakValue = Math.max(targetCluster.peakValue, valNum);
          }
        } else {
          // 超出窗口，开启新超限段
          clusters.push({
            deviceId: pt.device_id,
            taskId: pt.task_id || 'UNKNOWN',
            spoolId: pt.spool_id,
            workOrderId: pt.work_order_id,
            metricCode: pt.metric_code,
            unit: pt.unit,
            startPos: posNum,
            endPos: posNum,
            peakValue: valNum,
            firstSampleTime: ptTime,
            lastSampleTime: ptTime,
            sampleCount: 1,
            records: [pt.id],
          });
        }
      }

      // 写入或更新数据库
      for (const cl of clusters) {
        const baseKey = `ALARM:${cl.deviceId}:${cl.taskId}:${cl.metricCode}`;
        const existing = await tx.query(
          `SELECT * FROM m05.alarm_event
           WHERE factory_id = $1 AND device_id = $2 AND source_alarm_key = $3`,
          [actor.factory, cl.deviceId, baseKey]
        );

        if (existing.rowCount === 0) {
          const alarmId = `ALR-${randomUUID().slice(0, 8)}`;
          await tx.query(
            `INSERT INTO m05.alarm_event(
              id, factory_id, device_id, task_id, spool_id, work_order_id,
              source_alarm_key, alarm_type, metric_code, severity, lifecycle, handling_state,
              sample_count, start_position_m, end_position_m, peak_value, unit,
              triggered_at, trigger_snapshot
            ) VALUES(
              $1, $2, $3, $4, $5, $6,
              $7, 'QUALITY', $8, 'CRITICAL', 'ACTIVE', 'PENDING',
              $9, $10, $11, $12, $13,
              $14, $15
            )`,
            [
              alarmId,
              actor.factory,
              cl.deviceId,
              cl.taskId,
              cl.spoolId,
              cl.workOrderId,
              baseKey,
              cl.metricCode,
              cl.sampleCount,
              cl.startPos,
              cl.endPos,
              cl.peakValue,
              cl.unit,
              cl.firstSampleTime,
              JSON.stringify({ records: cl.records, initial_count: cl.sampleCount }),
            ]
          );

          await tx.query(
            `INSERT INTO m05.alarm_action(id, alarm_id, action, actor_id, actor_name, from_state, to_state, opinion, occurred_at)
             VALUES($1, $2, 'TRIGGER', 'SYSTEM', '质量检测引擎', NULL, 'PENDING', '连续超限采样毛刺防抖聚合，触发质量报警', $3)`,
            [randomUUID(), alarmId, cl.firstSampleTime]
          );

          createdCount++;
        } else {
          const cur = existing.rows[0];
          // 如果现有报警仍处于活跃未完全归档，更新防抖范围
          const newCount = Number(cur.sample_count) + cl.sampleCount;
          const newEndPos = cl.endPos !== null
            ? Math.max(Number(cur.end_position_m || 0), cl.endPos)
            : cur.end_position_m;
          const newPeakVal = cl.metricCode === 'SHIELD_OVERLAP_RATE'
            ? Math.min(Number(cur.peak_value), cl.peakValue)
            : Math.max(Number(cur.peak_value), cl.peakValue);

          await tx.query(
            `UPDATE m05.alarm_event
             SET sample_count = $1,
                 end_position_m = $2,
                 peak_value = $3,
                 updated_at = now()
             WHERE id = $4`,
            [newCount, newEndPos, newPeakVal, cur.id]
          );
          updatedCount++;
        }
      }

      return {
        total_fail_points: failPoints.length,
        created_alarms: createdCount,
        updated_alarms: updatedCount,
        clusters_formed: clusters.length,
      };
    });
  }
}
