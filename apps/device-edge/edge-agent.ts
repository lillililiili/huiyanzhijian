/**
 * 现场边缘采集守护进程（Edge Agent Daemon）
 * - 独立后台服务入口，常驻现场采集工控机运行
 * - 本地 SQLite 离线缓冲持久化
 * - 浪潮 (M08) 与共久/Opmac (M09) 驱动报文接收与解析
 * - 断网自动退避与自愈 FIFO 补传引擎
 */

import { EdgeBuffer } from './edge-buffer';
import { SyncEngine, type SyncEngineConfig } from './sync-engine';
import {
  parseOverlapRateRTUFrame,
  parseOverlapRateTCPFrame,
  parseWireGapRTUFrame,
  parseWireGapTCPFrame,
  type DeviceMetadata,
  type StandardIngestionPayload,
} from '../../adapters/inspur/inspur-driver';
import {
  parseOpmacRTUFrame,
  calculatePositionFromPulses,
  type EdgeMetadata,
  type EdgeIngestionPayload,
} from './opmac-driver';

export interface EdgeAgentConfig {
  sqlitePath?: string;
  syncConfig?: SyncEngineConfig;
  syncIntervalMs?: number;
  pulseCoefficient?: number; // 默认 0.0005 m/pulse
}

export class EdgeAgent {
  readonly buffer: EdgeBuffer;
  readonly syncEngine: SyncEngine;
  readonly pulseCoefficient: number;
  readonly syncIntervalMs: number;

  private pulseCounter: number = 0;
  private isRunning: boolean = false;
  private currentSequence: number = 0;

  constructor(config: EdgeAgentConfig = {}) {
    const dbPath = config.sqlitePath || 'apps/device-edge/db/edge_buffer.sqlite';
    this.buffer = new EdgeBuffer(dbPath);
    this.syncEngine = new SyncEngine(this.buffer, config.syncConfig);
    this.pulseCoefficient = config.pulseCoefficient !== undefined ? config.pulseCoefficient : 0.0005;
    this.syncIntervalMs = config.syncIntervalMs || 2000;
  }

  /**
   * 启动边缘采集守护进程
   */
  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.syncEngine.startSyncLoop(this.syncIntervalMs);
  }

  /**
   * 停止边缘采集守护进程并释放资源
   */
  async stop(): Promise<void> {
    if (!this.isRunning) return;
    this.isRunning = false;
    this.syncEngine.stopSyncLoop();
    this.buffer.close();
  }

  /**
   * 计米脉冲累加中断接口
   */
  addPulses(count: number = 1): number {
    this.pulseCounter += Math.max(0, count);
    return this.pulseCounter;
  }

  /**
   * 获取当前脉冲数
   */
  getPulseCount(): number {
    return this.pulseCounter;
  }

  /**
   * 获取当前脉冲换算出的位置（米）
   */
  getCurrentPositionM(): string {
    return calculatePositionFromPulses(this.pulseCounter, this.pulseCoefficient);
  }

  /**
   * 收到切盘/换盘信号时触发：重置计米脉冲
   */
  cutSpool(): void {
    this.pulseCounter = 0;
  }

  /**
   * 写入已解析的平台标准测点记录到本地缓冲区
   */
  recordMeasurement(payload: any, sequence?: number): void {
    const seq = sequence !== undefined ? sequence : ++this.currentSequence;
    this.buffer.enqueue({
      id: payload.record_id,
      sequence: seq,
      payload,
    });
  }

  /**
   * 接入并解析浪潮搭盖率（ISA-TD-3120）RTU 原始帧
   */
  ingestOverlapRateRTU(
    frame: Uint8Array | Buffer,
    meta: DeviceMetadata,
    sampleTime?: string
  ): StandardIngestionPayload {
    const seq = ++this.currentSequence;
    const payload = parseOverlapRateRTUFrame(frame, seq, meta, sampleTime);
    this.recordMeasurement(payload, seq);
    return payload;
  }

  /**
   * 接入并解析浪潮搭盖率（ISA-TD-3120）TCP 原始帧
   */
  ingestOverlapRateTCP(
    frame: Uint8Array | Buffer,
    meta: DeviceMetadata,
    sampleTime?: string
  ): StandardIngestionPayload {
    const seq = ++this.currentSequence;
    const payload = parseOverlapRateTCPFrame(frame, seq, meta, sampleTime);
    this.recordMeasurement(payload, seq);
    return payload;
  }

  /**
   * 接入并解析浪潮铜丝间隙（ISA-LJ-2420）RTU 原始帧
   */
  ingestWireGapRTU(
    frame: Uint8Array | Buffer,
    meta: DeviceMetadata,
    sampleTime?: string
  ): StandardIngestionPayload {
    const seq = ++this.currentSequence;
    const payload = parseWireGapRTUFrame(frame, seq, meta, sampleTime);
    this.recordMeasurement(payload, seq);
    return payload;
  }

  /**
   * 接入并解析浪潮铜丝间隙（ISA-LJ-2420）TCP 原始帧
   */
  ingestWireGapTCP(
    frame: Uint8Array | Buffer,
    meta: DeviceMetadata,
    sampleTime?: string
  ): StandardIngestionPayload {
    const seq = ++this.currentSequence;
    const payload = parseWireGapTCPFrame(frame, seq, meta, sampleTime);
    this.recordMeasurement(payload, seq);
    return payload;
  }

  /**
   * 接入并解析共久/Opmac 测径仪 Modbus RTU 原始帧与计米脉冲
   */
  ingestOpmacRTU(
    frame: Uint8Array | Buffer,
    meta: EdgeMetadata,
    sampleTime?: string
  ): EdgeIngestionPayload {
    const seq = ++this.currentSequence;
    const payload = parseOpmacRTUFrame(frame, seq, this.pulseCounter, {
      ...meta,
      pulseCoefficient: this.pulseCoefficient,
    }, sampleTime);
    this.recordMeasurement(payload, seq);
    return payload;
  }

  /**
   * 获取边缘采集端实时运行与缓冲诊断状态
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      isOnline: this.syncEngine.isOnline,
      pulseCounter: this.pulseCounter,
      currentPositionM: this.getCurrentPositionM(),
      bufferStats: this.buffer.getStats(),
      consecutiveFailures: this.syncEngine.consecutiveFailures,
      currentBackoffDelayMs: this.syncEngine.currentBackoffDelayMs,
      lastSyncAt: this.syncEngine.lastSyncAt,
      lastError: this.syncEngine.lastError,
    };
  }
}
