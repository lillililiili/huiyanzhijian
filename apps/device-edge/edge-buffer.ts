/**
 * 现场边缘采集端 SQLite 离线持久化缓冲引擎
 * 表名：raw_edge_buffer
 * 字段：id, sequence, payload, send_status, retry_count, created_at
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface EdgeBufferRecord {
  id: string;
  sequence: number;
  payload: string; // JSON 序列化字符串
  send_status: 'PENDING' | 'SENT' | 'FAILED';
  retry_count: number;
  created_at: string;
}

export class EdgeBuffer {
  readonly db: DatabaseSync;

  constructor(dbPath: string = 'apps/device-edge/db/edge_buffer.sqlite') {
    if (dbPath !== ':memory:') {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS raw_edge_buffer (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL,
        payload TEXT NOT NULL,
        send_status TEXT NOT NULL DEFAULT 'PENDING',
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_edge_buffer_fifo ON raw_edge_buffer(send_status, sequence ASC);
      CREATE INDEX IF NOT EXISTS idx_edge_buffer_created ON raw_edge_buffer(created_at);
    `);
  }

  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /**
   * 将一条现场采集记录写入 SQLite 离线缓冲区（先进先出 sequence 索引）
   */
  enqueue(item: {
    id: string;
    sequence: number;
    payload: any;
    createdAt?: string;
  }): void {
    const payloadStr = typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);
    const createdAt = item.createdAt || new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO raw_edge_buffer (id, sequence, payload, send_status, retry_count, created_at)
      VALUES (?, ?, ?, 'PENDING', 0, ?)
      ON CONFLICT(id) DO UPDATE SET
        payload = excluded.payload,
        created_at = excluded.created_at
    `);
    stmt.run(item.id, item.sequence, payloadStr, createdAt);
  }

  /**
   * 按先进先出（FIFO，sequence 递增）取出待上传批次
   */
  dequeueBatch(limit: number = 50): EdgeBufferRecord[] {
    const stmt = this.db.prepare(`
      SELECT id, sequence, payload, send_status, retry_count, created_at
      FROM raw_edge_buffer
      WHERE send_status = 'PENDING'
      ORDER BY sequence ASC
      LIMIT ?
    `);
    return stmt.all(limit) as unknown as EdgeBufferRecord[];
  }

  /**
   * 标记记录已成功上传至平台
   */
  markSent(ids: string[]): void {
    if (!ids || ids.length === 0) return;
    this.transaction(() => {
      const stmt = this.db.prepare(`
        UPDATE raw_edge_buffer
        SET send_status = 'SENT'
        WHERE id = ?
      `);
      for (const id of ids) {
        stmt.run(id);
      }
    });
  }

  /**
   * 标记记录重试，递增 retry_count，超过最大重试次数则标记为 FAILED
   */
  markRetry(ids: string[], maxRetries: number = 10): void {
    if (!ids || ids.length === 0) return;
    this.transaction(() => {
      const stmt = this.db.prepare(`
        UPDATE raw_edge_buffer
        SET retry_count = retry_count + 1,
            send_status = CASE WHEN retry_count + 1 >= ? THEN 'FAILED' ELSE 'PENDING' END
        WHERE id = ?
      `);
      for (const id of ids) {
        stmt.run(maxRetries, id);
      }
    });
  }

  /**
   * 重置失败的记录为 PENDING，重新进入补发队列
   */
  requeueFailed(): number {
    const stmt = this.db.prepare(`
      UPDATE raw_edge_buffer
      SET send_status = 'PENDING', retry_count = 0
      WHERE send_status = 'FAILED'
    `);
    const res = stmt.run();
    return Number(res.changes);
  }

  /**
   * 获取待发送记录总数
   */
  getPendingCount(): number {
    const row = this.db.prepare(`
      SELECT count(*) as count FROM raw_edge_buffer WHERE send_status = 'PENDING'
    `).get() as { count: number };
    return Number(row?.count || 0);
  }

  /**
   * 获取单条记录
   */
  getItem(id: string): EdgeBufferRecord | null {
    const row = this.db.prepare(`
      SELECT id, sequence, payload, send_status, retry_count, created_at
      FROM raw_edge_buffer WHERE id = ?
    `).get(id);
    return (row as unknown as EdgeBufferRecord) || null;
  }

  /**
   * 获取离线队列统计指标
   */
  getStats(): { pending: number; sent: number; failed: number; total: number } {
    const rows = this.db.prepare(`
      SELECT send_status, count(*) as count
      FROM raw_edge_buffer
      GROUP BY send_status
    `).all() as Array<{ send_status: string; count: number }>;

    let pending = 0;
    let sent = 0;
    let failed = 0;

    for (const r of rows) {
      if (r.send_status === 'PENDING') pending = Number(r.count);
      else if (r.send_status === 'SENT') sent = Number(r.count);
      else if (r.send_status === 'FAILED') failed = Number(r.count);
    }

    return {
      pending,
      sent,
      failed,
      total: pending + sent + failed,
    };
  }

  /**
   * 清空缓冲区（用于测试初始化）
   */
  clear(): void {
    this.db.exec('DELETE FROM raw_edge_buffer');
  }

  /**
   * 安全关闭数据库
   */
  close(): void {
    this.db.close();
  }
}
