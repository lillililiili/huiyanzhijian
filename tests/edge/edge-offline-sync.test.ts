import test from 'node:test';
import assert from 'node:assert/strict';

import { EdgeBuffer } from '../../apps/device-edge/edge-buffer';
import { SyncEngine } from '../../apps/device-edge/sync-engine';
import { EdgeAgent } from '../../apps/device-edge/edge-agent';
import { buildModbusRTUResponse, buildModbusTCPResponse } from '../../adapters/inspur/inspur-driver';
import { buildOpmacRTUResponse } from '../../apps/device-edge/opmac-driver';
import { validateMeasurement, validateMeasurementBatch } from './schema-validator';

test('EdgeBuffer: SQLite raw_edge_buffer schema and FIFO ordering', () => {
  const buffer = new EdgeBuffer(':memory:');

  // 1. 验证表结构与字段存取
  buffer.enqueue({
    id: 'REC-001',
    sequence: 1,
    payload: { record_id: 'REC-001', val: 10 },
    createdAt: '2026-10-28T10:00:00Z',
  });
  buffer.enqueue({
    id: 'REC-002',
    sequence: 2,
    payload: { record_id: 'REC-002', val: 20 },
    createdAt: '2026-10-28T10:00:01Z',
  });
  buffer.enqueue({
    id: 'REC-003',
    sequence: 3,
    payload: { record_id: 'REC-003', val: 30 },
    createdAt: '2026-10-28T10:00:02Z',
  });

  const stats1 = buffer.getStats();
  assert.equal(stats1.pending, 3);
  assert.equal(stats1.sent, 0);
  assert.equal(stats1.total, 3);

  // 2. 验证 FIFO 出队顺序（必须按 sequence 升序）
  const batch1 = buffer.dequeueBatch(2);
  assert.equal(batch1.length, 2);
  assert.equal(batch1[0].id, 'REC-001');
  assert.equal(batch1[0].sequence, 1);
  assert.equal(batch1[1].id, 'REC-002');
  assert.equal(batch1[1].sequence, 2);

  // 3. 标记部分记录成功发送
  buffer.markSent(['REC-001', 'REC-002']);
  const stats2 = buffer.getStats();
  assert.equal(stats2.pending, 1);
  assert.equal(stats2.sent, 2);

  // 4. 重试机制与最大重试次数转 FAILED
  buffer.markRetry(['REC-003'], 2); // retry_count = 1 < 2 -> PENDING
  let r3 = buffer.getItem('REC-003');
  assert.equal(r3?.retry_count, 1);
  assert.equal(r3?.send_status, 'PENDING');

  buffer.markRetry(['REC-003'], 2); // retry_count = 2 >= 2 -> FAILED
  r3 = buffer.getItem('REC-003');
  assert.equal(r3?.retry_count, 2);
  assert.equal(r3?.send_status, 'FAILED');

  const stats3 = buffer.getStats();
  assert.equal(stats3.pending, 0);
  assert.equal(stats3.failed, 1);

  // 5. 重新入队失败记录
  const requeued = buffer.requeueFailed();
  assert.equal(requeued, 1);
  assert.equal(buffer.getStats().pending, 1);

  buffer.close();
});

test('SyncEngine: Exponential backoff calculation and cap', () => {
  const buffer = new EdgeBuffer(':memory:');
  const engine = new SyncEngine(buffer, {
    initialDelayMs: 200,
    backoffFactor: 2,
    maxDelayMs: 2000,
  });

  assert.equal(engine.calculateNextBackoff(), 200); // 0 failure

  engine.consecutiveFailures = 1;
  assert.equal(engine.calculateNextBackoff(), 200); // 200 * (2^0) = 200

  engine.consecutiveFailures = 2;
  assert.equal(engine.calculateNextBackoff(), 400); // 200 * (2^1) = 400

  engine.consecutiveFailures = 3;
  assert.equal(engine.calculateNextBackoff(), 800); // 200 * (2^2) = 800

  engine.consecutiveFailures = 4;
  assert.equal(engine.calculateNextBackoff(), 1600); // 200 * (2^3) = 1600

  engine.consecutiveFailures = 5;
  assert.equal(engine.calculateNextBackoff(), 2000); // capped at maxDelayMs 2000

  buffer.close();
});

test('End-to-End: Network disconnection, safe SQLite persistence, recovery and FIFO retransmission', async () => {
  // 模拟平台接收端
  let networkOnline = true;
  const receivedBatches: any[] = [];

  const mockPlatformFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (!networkOnline) {
      throw new Error('connect ECONNREFUSED 127.0.0.1:4192');
    }

    const body = JSON.parse(init?.body as string);
    // 严格校验平台 MeasurementBatch Schema 契约
    const batchOk = validateMeasurementBatch(body);
    if (!batchOk) {
      return new Response(JSON.stringify({ error: 'SCHEMA_INVALID', details: validateMeasurementBatch.errors }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 每条记录也必须符合 Measurement 规范
    for (const record of body.records) {
      const recOk = validateMeasurement(record);
      if (!recOk) {
        return new Response(JSON.stringify({ error: 'RECORD_INVALID', details: validateMeasurement.errors }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    receivedBatches.push(body);
    return new Response(
      JSON.stringify({
        schema_version: '1.0',
        batch_id: body.batch_id,
        counts: { total: body.records.length, stored: body.records.length, duplicate: 0, quarantined: 0, rejected: 0 },
        items: body.records.map((r: any, idx: number) => ({
          input_index: idx,
          source_id: r.record_id,
          receipt_status: 'STORED',
          stored_id: 'DB-' + r.record_id,
        })),
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const agent = new EdgeAgent({
    sqlitePath: ':memory:',
    syncConfig: {
      platformUrl: 'http://localhost:4192',
      customFetch: mockPlatformFetch as any,
      initialDelayMs: 100,
      backoffFactor: 2,
      maxDelayMs: 1000,
      batchSize: 10,
    },
    pulseCoefficient: 0.0005,
  });

  try {
    const metaDg = {
      deviceId: 'HY-DG-01',
      captureSessionId: 'SESS-E2E-DG',
      dataEnvironment: 'REAL' as const,
    };
    const metaJx = {
      deviceId: 'HY-JX-01',
      captureSessionId: 'SESS-E2E-JX',
      dataEnvironment: 'REAL' as const,
    };
    const metaBy = {
      deviceId: 'HY-BY-01',
      captureSessionId: 'SESS-E2E-BY',
      dataEnvironment: 'REAL' as const,
    };

    // 1. 正常在线阶段：采集 2 条记录并补传
    const dgRegs = [1, 10, 0, 2000, 250, 1250, 1, 0, 300]; // 10.00m, 12.50%
    const dgFrame = buildModbusRTUResponse(1, 0x03, dgRegs);
    agent.ingestOverlapRateRTU(dgFrame, metaDg);

    agent.addPulses(10000); // 10000 * 0.0005 = 5.0000m
    const byRegs = [4010, 4000, 4020, 20, 0];
    const byFrame = buildOpmacRTUResponse(1, byRegs);
    agent.ingestOpmacRTU(byFrame, metaBy);

    assert.equal(agent.buffer.getPendingCount(), 2);

    // 执行一次补传
    const sync1 = await agent.syncEngine.drainAll();
    assert.equal(sync1.totalDrained, 2);
    assert.equal(agent.buffer.getPendingCount(), 0);
    assert.equal(agent.syncEngine.isOnline, true);
    assert.equal(receivedBatches.length, 1);
    assert.equal(receivedBatches[0].records.length, 2);

    // 2. 模拟突发断网（4192 网络中断）
    networkOnline = false;

    // 产线继续高速送料，持续产生 5 条现场测量
    for (let i = 0; i < 5; i++) {
      agent.addPulses(2000); // 累加 1.0 米
      const jxRegs = [1, 0, (20 + i) * 1000, 150, 120, 2500, 1, 1, 120, 120, 120, 120];
      const jxFrame = buildModbusTCPResponse(2000 + i, 1, 0x03, jxRegs);
      agent.ingestWireGapTCP(jxFrame, metaJx);
    }

    // 离线状态下，所有 5 条记录安全落盘至本地 SQLite
    const offlineStats = agent.buffer.getStats();
    assert.equal(offlineStats.pending, 5);
    assert.equal(offlineStats.sent, 2); // 之前的 2 条保持已发送
    assert.equal(offlineStats.total, 7);

    // 尝试上传：触发断网捕获与指数退避
    const failedSync = await agent.syncEngine.drainOnce();
    assert.equal(failedSync.status, 'FAILED');
    assert.equal(agent.syncEngine.isOnline, false);
    assert.equal(agent.syncEngine.consecutiveFailures, 1);
    assert.equal(agent.syncEngine.currentBackoffDelayMs, 100);

    // 3. 模拟网络恢复（4192 恢复在线）
    networkOnline = true;

    // 触发自愈补传
    const recoverySync = await agent.syncEngine.drainAll();
    assert.equal(recoverySync.totalDrained, 5);
    assert.equal(agent.syncEngine.isOnline, true);
    assert.equal(agent.syncEngine.consecutiveFailures, 0);
    assert.equal(agent.syncEngine.currentBackoffDelayMs, 100);

    // 缓冲区待发数清空
    const recoveredStats = agent.buffer.getStats();
    assert.equal(recoveredStats.pending, 0);
    assert.equal(recoveredStats.sent, 7);

    // 4. 验证平台接收到的第 2 批数据：先进先出（FIFO）顺序且符合 schema
    assert.equal(receivedBatches.length, 2);
    const retransmittedRecords = receivedBatches[1].records;
    assert.equal(retransmittedRecords.length, 5);

    // 验证 FIFO sequence 递增
    for (let i = 0; i < retransmittedRecords.length; i++) {
      const expectedSeq = String(3 + i); // 前面有两帧，因此序列为 3, 4, 5, 6, 7
      assert.equal(retransmittedRecords[i].capture_sequence, expectedSeq);
      assert.equal(retransmittedRecords[i].data_environment, 'REAL');
      assert.equal(retransmittedRecords[i].values[0].metric_code, 'WIRE_GAP');
    }

    // 5. 换盘信号切盘验证
    agent.cutSpool();
    assert.equal(agent.getPulseCount(), 0);
    assert.equal(agent.getCurrentPositionM(), '0.0000');
  } finally {
    await agent.stop();
  }
});
