import type { PoolClient } from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { pool, transaction } from '../../infrastructure/db';
import { ApiError, requireValue } from '../../infrastructure/errors';
import type { Actor } from '../m00-identity/api';
import { allow } from '../m00-identity/api';
import { MesClient, type MesInspectionPayload } from './client';

export type MesDeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'ACKNOWLEDGED' | 'REJECTED' | 'RETRYING' | 'FAILED';

export interface MesDeliveryFilter {
  status?: string;
  state?: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
  task_id?: string;
  spool_id?: string;
  limit?: number;
  after_id?: string;
}

export function computeDeliveryStatus(row: any): MesDeliveryStatus {
  if (row.business_ack) return 'ACKNOWLEDGED';
  if (row.state === 'SENT') return 'SENT';
  if (row.state === 'SENDING') return 'SENDING';
  if (row.state === 'PENDING') return 'PENDING';
  if (row.state === 'FAILED') {
    const err = String(row.last_error || '');
    if (err.includes('INVALID_') || err.includes('REJECTED') || err.includes('400') || err.includes('BAD_REQUEST')) {
      return 'REJECTED';
    }
    if (Number(row.attempt_count) < Number(row.max_attempts) && row.next_attempt_at) {
      return 'RETRYING';
    }
    return 'FAILED';
  }
  return row.state as MesDeliveryStatus;
}

export class MesService {
  private workerTimer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  /**
   * 启动出站 Worker 轮询机制
   */
  startOutboxWorker(intervalMs = 3000) {
    if (this.workerTimer) return;
    this.workerTimer = setInterval(async () => {
      try {
        await this.processOutboxBatch(10);
      } catch (err) {
        console.error('[MES Outbox Worker Error]', err);
      }
    }, intervalMs);
    // 不阻止 Node 进程退出
    if (this.workerTimer.unref) {
      this.workerTimer.unref();
    }
  }

  /**
   * 停止出站 Worker
   */
  stopOutboxWorker() {
    if (this.workerTimer) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  /**
   * 确保兼容视图 m07.measurement_outbox 存在
   */
  async ensureViews(db: Pick<PoolClient, 'query'> = pool) {
    try {
      await db.query(`
        CREATE OR REPLACE VIEW m07.measurement_outbox AS
        SELECT id, factory_id, endpoint_id, task_id, spool_id, work_order_id,
               business_key, message_type, state, attempt_count, max_attempts,
               next_attempt_at, business_ack, acked_at, last_error, payload,
               payload_hash, created_at, updated_at
        FROM m07.mes_delivery;
      `);
    } catch {
      // 容错已存在的只读连接或隔离
    }
  }

  /**
   * 查询 MES 出站队列记录（支持管理员控制与对账筛选，兼容 outbox 与 deliveries）
   */
  async list(actor: Actor, filter: MesDeliveryFilter, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'data:read', 'USER');

    const conditions: string[] = ['factory_id = $1'];
    const values: any[] = [actor.factory];
    let idx = 2;

    if (filter.state) {
      conditions.push(`state = $${idx++}`);
      values.push(filter.state);
    }
    if (filter.task_id) {
      conditions.push(`task_id = $${idx++}`);
      values.push(filter.task_id);
    }
    if (filter.spool_id) {
      conditions.push(`spool_id = $${idx++}`);
      values.push(filter.spool_id);
    }
    if (filter.after_id) {
      conditions.push(`id::text > $${idx++}`);
      values.push(filter.after_id);
    }

    const limit = Math.min(Math.max(Number(filter.limit) || 50, 1), 100);
    values.push(limit + 1);

    const sql = `
      SELECT id, factory_id, endpoint_id, task_id, spool_id, work_order_id,
             business_key, message_type, state, attempt_count, max_attempts,
             business_ack,
             to_char(next_attempt_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS next_attempt_at,
             to_char(acked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS acked_at,
             last_error, payload,
             to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
      FROM m07.mes_delivery
      WHERE ${conditions.join(' AND ')}
      ORDER BY created_at DESC, id DESC
      LIMIT $${idx}
    `;

    const rawRows = (await db.query(sql, values)).rows;
    let items = rawRows.map((r) => ({
      ...r,
      status: computeDeliveryStatus(r),
    }));

    if (filter.status) {
      const want = filter.status.toUpperCase();
      items = items.filter((it) => it.status === want);
    }

    const more = items.length > limit;
    const paged = items.slice(0, limit);

    return {
      items: paged,
      total: paged.length,
      has_more: more,
      next_cursor: more ? paged.at(-1)?.id : null,
    };
  }

  /**
   * 将任务完工报告打包推入出站队列（Outbox）
   */
  async enqueueTask(actor: Actor, taskId: string, db: Pick<PoolClient, 'query'> = pool) {
    allow(actor, 'task:write', 'USER');

    return transaction(async (tx) => {
      // 获取任务、工单、盘号及规格信息
      const taskRes = await tx.query(
        `SELECT t.*, s.spool_code, w.external_code AS work_order_code, spec.code AS spec_code, spec.name AS spec_name
         FROM m02.inspection_task t
         JOIN m02.cable_spool s ON s.id = t.spool_id
         JOIN m02.work_order w ON w.id = t.work_order_id
         JOIN m01.product_specification spec ON spec.id = t.specification_id
         WHERE t.factory_id = $1 AND t.id = $2`,
        [actor.factory, taskId]
      );

      if (taskRes.rowCount === 0) {
        throw new ApiError(404, 'RESOURCE_NOT_FOUND', '检测任务不存在');
      }

      const task = taskRes.rows[0];

      // 统计该任务的测点和质量结论
      const statRes = await tx.query(
        `SELECT v.metric_code,
                count(*)::int AS sample_count,
                count(*) FILTER(WHERE e.quality_result = 'FAIL')::int AS failed_count,
                avg(v.value)::numeric(10,2)::float AS mean_value,
                min(v.value)::numeric(10,2)::float AS min_value,
                max(v.value)::numeric(10,2)::float AS max_value,
                min(v.unit) AS unit
         FROM m04.measurement_record r
         JOIN m04.measurement_value v ON v.record_id = r.id
         JOIN m04.measurement_evaluation e ON e.record_id = r.id AND e.version = 1
         WHERE r.factory_id = $1 AND r.task_id = $2
         GROUP BY v.metric_code`,
        [actor.factory, taskId]
      );

      const metricResults = statRes.rows.map((row: any) => ({
        metric_code: row.metric_code as 'SHIELD_OVERLAP_RATE' | 'WIRE_GAP' | 'OVALITY',
        metric_name: row.metric_code === 'SHIELD_OVERLAP_RATE' ? '金属屏蔽铜带搭盖率' : row.metric_code === 'WIRE_GAP' ? '铜丝屏蔽相邻间隙' : '电缆不圆度',
        unit: row.unit || '%',
        sample_count: row.sample_count,
        failed_count: row.failed_count,
        rule_expression: row.metric_code === 'SHIELD_OVERLAP_RATE' ? '>= 10.0%' : row.metric_code === 'WIRE_GAP' ? '<= 3.0mm' : '<= 8.0%',
        mean_value: row.mean_value,
        min_value: row.min_value,
        max_value: row.max_value,
        verdict: (row.failed_count === 0 ? 'PASS' : 'FAIL') as 'PASS' | 'FAIL',
      }));

      const overallVerdict = metricResults.some((m: any) => m.verdict === 'FAIL') ? 'FAIL' : 'PASS';
      const deliveryId = randomUUID();
      const now = new Date().toISOString();

      const payload: MesInspectionPayload = {
        delivery_id: deliveryId,
        send_time: now,
        factory_code: actor.factory,
        work_order_code: task.work_order_code,
        spool_code: task.spool_code,
        specification_code: task.spec_code,
        product_name: task.spec_name,
        inspection_scope: {
          total_length_m: Number(task.planned_length_m || 1000),
          effective_coverage_m: Number(task.planned_length_m || 1000),
          start_time: task.started_at,
          end_time: task.ended_at || now,
        },
        overall_verdict: overallVerdict as 'PASS' | 'FAIL',
        metric_results: metricResults,
        inspector: {
          operator_id: actor.id,
          operator_name: (actor as any).name || actor.id,
        },
      };

      const businessKey = `TASK-QC:${task.id}`;
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');

      // 获取端点配置
      const epRes = await tx.query(
        'SELECT * FROM m07.mes_endpoint WHERE factory_id = $1 AND enabled = true LIMIT 1',
        [actor.factory]
      );
      const endpoint = epRes.rows[0];
      const endpointId = endpoint?.id || null;

      const insRes = await tx.query(
        `INSERT INTO m07.mes_delivery(
          id, factory_id, endpoint_id, task_id, spool_id, work_order_id,
          business_key, message_type, state, attempt_count, max_attempts,
          payload, payload_hash, next_attempt_at
        ) VALUES(
          $1, $2, $3, $4, $5, $6,
          $7, 'INSPECTION_REPORT', 'PENDING', 0, 5,
          $8, $9, now()
        ) ON CONFLICT(factory_id, business_key) DO UPDATE
          SET payload = EXCLUDED.payload,
              payload_hash = EXCLUDED.payload_hash,
              state = 'PENDING',
              attempt_count = 0,
              next_attempt_at = now(),
              updated_at = now()
        RETURNING id`,
        [
          deliveryId,
          actor.factory,
          endpointId,
          task.id,
          task.spool_id,
          task.work_order_id,
          businessKey,
          JSON.stringify(payload),
          payloadHash,
        ]
      );

      const actualId = insRes.rows[0].id;
      return { delivery_id: actualId, state: 'PENDING', status: 'PENDING', verdict: overallVerdict };
    });
  }

  /**
   * 将任务打包入队并立即执行一次投递
   */
  async enqueueAndDeliver(actor: Actor, taskId: string, db: Pick<PoolClient, 'query'> = pool) {
    const enq = await this.enqueueTask(actor, taskId, db);
    const retryRes = await this.retry(actor, enq.delivery_id);
    return {
      delivery_id: enq.delivery_id,
      state: retryRes.state,
      status: retryRes.status,
      ack_code: retryRes.ack_code,
      verdict: enq.verdict,
      error: (retryRes as any).error,
    };
  }

  /**
   * 出站 Worker 批量处理轮询队列：消费 PENDING / FAILED (待重试) 记录，执行 HMAC 签名推送与业务 ACK 闭环
   */
  async processOutboxBatch(batchSize = 10, db: Pick<PoolClient, 'query'> = pool) {
    if (this.isProcessing) return { processed: 0, success: 0, failed: 0 };
    this.isProcessing = true;

    try {
      const candidates = await db.query(
        `SELECT d.*, ep.base_url, ep.api_token, ep.secret_key, ep.timeout_ms
         FROM m07.mes_delivery d
         LEFT JOIN m07.mes_endpoint ep ON ep.id = d.endpoint_id
         WHERE d.state IN ('PENDING', 'FAILED')
           AND d.attempt_count < d.max_attempts
           AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
         ORDER BY d.created_at ASC
         LIMIT $1`,
        [batchSize]
      );

      let successCount = 0;
      let failedCount = 0;

      for (const row of candidates.rows) {
        if (!row.base_url) {
          await db.query(
            `UPDATE m07.mes_delivery
             SET state = 'FAILED', last_error = 'ENDPOINT_NOT_CONFIGURED', updated_at = now()
             WHERE id = $1`,
            [row.id]
          );
          failedCount++;
          continue;
        }

        // 标记为 SENDING
        await db.query("UPDATE m07.mes_delivery SET state = 'SENDING', updated_at = now() WHERE id = $1", [row.id]);

        const client = new MesClient({
          endpointUrl: row.base_url,
          apiToken: row.api_token,
          secretKey: row.secret_key,
          timeoutMs: row.timeout_ms || 5000,
        });

        const res = await client.deliverReport(row.payload, row.id);
        const attempt = row.attempt_count + 1;

        if (res.success && res.httpStatus === 200) {
          // 成功收到 ACK
          await db.query(
            `UPDATE m07.mes_delivery
             SET state = 'SENT',
                 business_ack = $1,
                 acked_at = now(),
                 attempt_count = $2,
                 last_error = NULL,
                 next_attempt_at = NULL,
                 updated_at = now()
             WHERE id = $3`,
            [res.ackCode, attempt, row.id]
          );
          successCount++;
        } else {
          // 失败分支：区分业务拒绝与退避重试
          const isBusinessReject = res.httpStatus === 400 || res.errorCode?.startsWith('INVALID_');
          if (isBusinessReject || attempt >= row.max_attempts) {
            // 不再重试，标记为 FAILED (REJECTED)
            await db.query(
              `UPDATE m07.mes_delivery
               SET state = 'FAILED',
                   last_error = $1,
                   attempt_count = $2,
                   next_attempt_at = NULL,
                   updated_at = now()
               WHERE id = $3`,
              [res.errorMessage || res.errorCode || 'REJECTED_BY_MES', attempt, row.id]
            );
          } else {
            // 指数退避重试：间隔 10s * 2^(attempt - 1)
            const backoffSec = Math.min(600, 10 * Math.pow(2, attempt - 1));
            await db.query(
              `UPDATE m07.mes_delivery
               SET state = 'FAILED',
                   last_error = $1,
                   attempt_count = $2,
                   next_attempt_at = now() + ($3 || ' seconds')::interval,
                   updated_at = now()
               WHERE id = $4`,
              [res.errorMessage || res.errorCode || 'NETWORK_RETRYABLE_ERROR', attempt, backoffSec, row.id]
            );
          }
          failedCount++;
        }
      }

      return {
        processed: candidates.rowCount || 0,
        success: successCount,
        failed: failedCount,
      };
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * 手动触发单条出站记录重试（管理员控制通道）
   */
  async retry(actor: Actor, deliveryId: string) {
    allow(actor, 'task:write', 'USER');

    const dRes = await pool.query(
      `SELECT d.*, ep.base_url, ep.api_token, ep.secret_key, ep.timeout_ms
       FROM m07.mes_delivery d
       LEFT JOIN m07.mes_endpoint ep ON ep.id = d.endpoint_id
       WHERE d.factory_id = $1 AND d.id = $2`,
      [actor.factory, deliveryId]
    );

    if (dRes.rowCount === 0) {
      throw new ApiError(404, 'RESOURCE_NOT_FOUND', '投递记录不存在');
    }

    const d = dRes.rows[0];
    if (!d.base_url) {
      throw new ApiError(400, 'ENDPOINT_NOT_CONFIGURED', '未配置有效的 MES 目标端点');
    }

    const client = new MesClient({
      endpointUrl: d.base_url,
      apiToken: d.api_token,
      secretKey: d.secret_key,
      timeoutMs: d.timeout_ms || 5000,
    });

    const res = await client.deliverReport(d.payload, d.id);
    const newAttempt = (d.attempt_count || 0) + 1;

    if (res.success && res.httpStatus === 200) {
      await pool.query(
        `UPDATE m07.mes_delivery
         SET state = 'SENT',
             business_ack = $1,
             acked_at = now(),
             attempt_count = $2,
             last_error = NULL,
             next_attempt_at = NULL,
             updated_at = now()
         WHERE id = $3`,
        [res.ackCode, newAttempt, d.id]
      );
      return { id: d.id, state: 'SENT', status: 'ACKNOWLEDGED', ack_code: res.ackCode };
    } else {
      const isBusinessReject = res.httpStatus === 400 || res.errorCode?.startsWith('INVALID_');
      const backoffSec = Math.min(600, 10 * Math.pow(2, newAttempt - 1));

      await pool.query(
        `UPDATE m07.mes_delivery
         SET state = 'FAILED',
             last_error = $1,
             attempt_count = $2,
             next_attempt_at = CASE WHEN $3 = true THEN NULL ELSE now() + ($4 || ' seconds')::interval END,
             updated_at = now()
         WHERE id = $5`,
        [res.errorMessage || res.errorCode || 'RETRY_FAILED', newAttempt, isBusinessReject, backoffSec, d.id]
      );

      const status = isBusinessReject ? 'REJECTED' : 'RETRYING';
      return { id: d.id, state: 'FAILED', status, error: res.errorMessage || res.errorCode };
    }
  }

  /**
   * 平台内置的 MES 模拟接收桩（用于本地端到端自闭环与契约验证）
   */
  mockReceiver(body: any, headers: Record<string, any>) {
    const idempKey = headers['x-idempotency-key'] || randomUUID();
    const sig = headers['x-signature'];

    if (!sig) {
      return {
        code: 4001,
        error_code: 'MISSING_SIGNATURE',
        message: '缺少 X-Signature 签名报文头',
      };
    }

    if (!body?.spool_code) {
      return {
        code: 4002,
        error_code: 'INVALID_SPOOL_CODE',
        message: '线缆盘号缺失，MES拒绝入库',
      };
    }

    return {
      code: 0,
      message: 'SUCCESS',
      data: {
        ack_code: `MES-ACK-${idempKey.slice(0, 8).toUpperCase()}`,
        received_at: new Date().toISOString(),
        spool_code: body?.spool_code,
        verdict: body?.overall_verdict,
        status: 'ACCEPTED',
      },
    };
  }
}
