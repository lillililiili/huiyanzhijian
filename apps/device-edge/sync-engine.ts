/**
 * 现场边缘采集端断网自愈与补传引擎（Sync Engine）
 * - 实时监测向 4192 平台的 HTTP 上传连接
 * - 断网或连接超时自动进入退避保护，采集数据无损暂存本地 SQLite
 * - 网络恢复后按先进先出（FIFO）顺序自动清空队列补传至平台
 * - 指数退避重试算法（Exponential Backoff）：base * (factor ^ failures) 且不超过 maxDelay
 */

import { randomUUID } from 'node:crypto';
import type { EdgeBuffer, EdgeBufferRecord } from './edge-buffer';

export interface SyncEngineConfig {
  platformUrl?: string; // 默认 http://localhost:4192
  deviceToken?: string; // 现场边缘凭据 Bearer Token
  batchSize?: number; // 默认 50 条/批次（契约上限 500）
  initialDelayMs?: number; // 初始退避延迟（默认 500ms）
  backoffFactor?: number; // 退避倍率（默认 2）
  maxDelayMs?: number; // 最大退避延迟（默认 30000ms）
  maxRetries?: number; // 最大重试次数（默认 10）
  customFetch?: typeof fetch; // 自定义或 Mock fetch 函数
}

export interface SyncDrainResult {
  drained: number;
  status: 'IDLE' | 'SUCCESS' | 'FAILED';
  error?: string;
  nextRetryDelayMs?: number;
}

export class SyncEngine {
  readonly platformUrl: string;
  readonly deviceToken?: string;
  readonly batchSize: number;
  readonly initialDelayMs: number;
  readonly backoffFactor: number;
  readonly maxDelayMs: number;
  readonly maxRetries: number;
  readonly fetchFn: typeof fetch;

  isOnline: boolean = true;
  consecutiveFailures: number = 0;
  currentBackoffDelayMs: number;
  lastSyncAt: string | null = null;
  lastError: string | null = null;

  private timer: NodeJS.Timeout | null = null;
  private isDraining: boolean = false;

  constructor(readonly buffer: EdgeBuffer, config: SyncEngineConfig = {}) {
    this.platformUrl = config.platformUrl || 'http://localhost:4192';
    this.deviceToken = config.deviceToken;
    this.batchSize = Math.min(config.batchSize || 50, 500);
    this.initialDelayMs = config.initialDelayMs || 500;
    this.backoffFactor = config.backoffFactor || 2;
    this.maxDelayMs = config.maxDelayMs || 30000;
    this.maxRetries = config.maxRetries || 10;
    this.fetchFn = config.customFetch || globalThis.fetch;
    this.currentBackoffDelayMs = this.initialDelayMs;
  }

  /**
   * 计算下一次指数退避重试时间
   */
  calculateNextBackoff(): number {
    if (this.consecutiveFailures <= 0) {
      return this.initialDelayMs;
    }
    const delay = this.initialDelayMs * Math.pow(this.backoffFactor, this.consecutiveFailures - 1);
    return Math.min(Math.round(delay), this.maxDelayMs);
  }

  /**
   * 执行单批次上传操作（先进先出 FIFO 顺序）
   */
  async drainOnce(): Promise<SyncDrainResult> {
    const items = this.buffer.dequeueBatch(this.batchSize);
    if (!items || items.length === 0) {
      return { drained: 0, status: 'IDLE' };
    }

    const records = items.map((item) => {
      try {
        return JSON.parse(item.payload);
      } catch {
        return item.payload;
      }
    });

    const batchId = `BATCH-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const batchBody = {
      schema_version: '1.0',
      batch_id: batchId,
      sent_at: new Date().toISOString(),
      records,
    };

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.deviceToken) {
      headers['Authorization'] = `Bearer ${this.deviceToken}`;
    }

    try {
      const url = `${this.platformUrl.replace(/\/+$/, '')}/measurements:ingest`;
      const response = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(batchBody),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errorText || response.statusText}`);
      }

      // 成功发送：更新状态为 SENT
      const ids = items.map((i) => i.id);
      this.buffer.markSent(ids);

      this.isOnline = true;
      this.consecutiveFailures = 0;
      this.currentBackoffDelayMs = this.initialDelayMs;
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;

      return { drained: items.length, status: 'SUCCESS' };
    } catch (err: any) {
      this.isOnline = false;
      this.consecutiveFailures++;
      this.currentBackoffDelayMs = this.calculateNextBackoff();
      this.lastError = err?.message || 'Network sync error';

      // 递增重试计数，达到上限后转为 FAILED
      const ids = items.map((i) => i.id);
      this.buffer.markRetry(ids, this.maxRetries);

      return {
        drained: 0,
        status: 'FAILED',
        error: this.lastError,
        nextRetryDelayMs: this.currentBackoffDelayMs,
      };
    }
  }

  /**
   * 循环清空队列中所有待补发数据（直到队列为空或发生异常中断）
   */
  async drainAll(): Promise<{ totalDrained: number; isCompleted: boolean; lastResult: SyncDrainResult }> {
    if (this.isDraining) {
      return { totalDrained: 0, isCompleted: false, lastResult: { drained: 0, status: 'IDLE' } };
    }

    this.isDraining = true;
    let totalDrained = 0;
    let lastResult: SyncDrainResult = { drained: 0, status: 'IDLE' };

    try {
      while (true) {
        lastResult = await this.drainOnce();
        if (lastResult.status === 'SUCCESS') {
          totalDrained += lastResult.drained;
        } else {
          // IDLE (队列空) 或 FAILED (断网或服务端异常)
          break;
        }
      }
    } finally {
      this.isDraining = false;
    }

    return {
      totalDrained,
      isCompleted: lastResult.status === 'IDLE',
      lastResult,
    };
  }

  /**
   * 启动后台自愈补传定时轮询任务
   */
  startSyncLoop(normalIntervalMs: number = 2000): void {
    this.stopSyncLoop();

    const loop = async () => {
      const res = await this.drainAll();
      let nextDelay = normalIntervalMs;

      if (!res.isCompleted && res.lastResult.status === 'FAILED') {
        // 断网或异常时按指数退避时间等待重试
        nextDelay = this.currentBackoffDelayMs;
      }

      this.timer = setTimeout(loop, nextDelay);
    };

    this.timer = setTimeout(loop, 100);
  }

  /**
   * 停止后台定时任务
   */
  stopSyncLoop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
