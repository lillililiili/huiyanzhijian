import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { Queue } from '../../tools/simulator/src/queue';
import { FeedControl } from '../../tools/simulator/src/feed-control';
import {
  record,
  SCENARIO_PERFECT,
  SCENARIO_OVERLAP_DEFECT,
  SCENARIO_GAP_GLITCH,
  SCENARIO_OVALITY_OUT_OF_BOUNDS,
  SCENARIO_SENSOR_BLOCKED,
  INDUSTRIAL_SCENARIOS,
} from '../../tools/simulator/src/scenarios';
import { WebManager } from '../../tools/simulator/src/web-manager';
import { validateMeasurement } from '../edge/schema-validator';

test('Industrial scenarios presets: value generation, boundary defects and missing status', () => {
  // 基础模拟任务元数据
  const dgAssignment = {
    task_id: 'TASK-DG-01',
    spool_id: 'SPOOL-001',
    metric_code: 'SHIELD_OVERLAP_RATE',
    binding_id: 'BIND-DG-01',
    binding_version: '1',
    recipe_version_id: 'RECIPE-DG-1',
  };
  const jxAssignment = {
    task_id: 'TASK-JX-01',
    spool_id: 'SPOOL-001',
    metric_code: 'WIRE_GAP',
    binding_id: 'BIND-JX-01',
    binding_version: '1',
    recipe_version_id: 'RECIPE-JX-1',
  };
  const byAssignment = {
    task_id: 'TASK-BY-01',
    spool_id: 'SPOOL-001',
    metric_code: 'OVALITY',
    binding_id: 'BIND-BY-01',
    binding_version: '1',
    recipe_version_id: 'RECIPE-BY-1',
  };

  const makeRun = (deviceId: string, assignment: any, scenario: string) => ({
    id: 'test-run-' + deviceId,
    device_id: deviceId,
    capture_session: 'sess-' + deviceId,
    scenario,
    seed: 0,
    assignment: JSON.stringify(assignment),
  });

  // 1. SCENARIO_PERFECT (黄金合格盘)
  const perfectDg = record(makeRun('HY-DG-01', dgAssignment, SCENARIO_PERFECT), 10);
  assert.equal(perfectDg.data_status, 'VALID');
  assert.equal(perfectDg.position_quality, 'KNOWN');
  assert.equal(perfectDg.values[0].value, '15.0000000000');
  assert.equal(perfectDg.values[0].unit, '%');
  assert.equal(validateMeasurement(perfectDg), true);

  const perfectJx = record(makeRun('HY-JX-01', jxAssignment, SCENARIO_PERFECT), 10);
  assert.equal(perfectJx.values[0].value, '1.5000000000');
  assert.equal(perfectJx.values[0].unit, 'mm');
  assert.equal(validateMeasurement(perfectJx), true);

  const perfectBy = record(makeRun('HY-BY-01', byAssignment, SCENARIO_PERFECT), 10);
  assert.equal(perfectBy.values[0].value, '3.0000000000');
  assert.equal(perfectBy.values[0].unit, '%');
  assert.equal(validateMeasurement(perfectBy), true);
  assert.equal((perfectBy.raw.data as any).observation.registers['0x0200_status_word'], '0x0002');
  assert.equal((perfectBy.raw.data as any).observation.registers['0x003E_run_status'], '0x0000');
  assert.equal((perfectBy.raw.data as any).observation.registers.tx_frame_hex, '01 03 02 00 00 06 C4 70');
  assert.ok(String((perfectBy.raw.data as any).observation.registers.rx_frame_hex).startsWith('01 03 0C 00 02 '));

  const blockedBy = record(makeRun('HY-BY-01', byAssignment, SCENARIO_SENSOR_BLOCKED), 15);
  assert.equal(blockedBy.data_status, 'MISSING');
  assert.equal(blockedBy.values[0].value, null);
  assert.equal((blockedBy.raw.data as any).observation.registers['0x0200_status_word'], '0x4442');
  assert.equal((blockedBy.raw.data as any).observation.registers['0x003E_run_status'], '0x4006');
  assert.equal(validateMeasurement(blockedBy), true);

  const invalidBy = record(makeRun('HY-BY-01', byAssignment, 'invalid'), 16);
  assert.equal(invalidBy.data_status, 'INVALID');
  assert.equal(invalidBy.values[0].value, null);
  assert.equal((invalidBy.raw.data as any).observation.registers['0x0200_status_word'], '0x2222');
  assert.equal((invalidBy.raw.data as any).observation.registers['0x003E_run_status'], '0x2003');
  assert.equal(validateMeasurement(invalidBy), true);

  // 2. SCENARIO_OVERLAP_DEFECT (金属屏蔽搭盖开缝缺陷：搭盖率掉至 6%~8%)
  const defectDg = record(makeRun('HY-DG-01', dgAssignment, SCENARIO_OVERLAP_DEFECT), 11);
  const dgVal = Number(defectDg.values[0].value);
  assert.ok(dgVal >= 6.0 && dgVal <= 8.0, `Expected overlap defect between 6% and 8%, got ${dgVal}`);
  assert.equal(defectDg.data_status, 'VALID');
  assert.equal(validateMeasurement(defectDg), true);

  // 3. SCENARIO_GAP_GLITCH (铜丝间隙毛刺超标：间隙出现 3.5mm~4.2mm)
  const defectJx = record(makeRun('HY-JX-01', jxAssignment, SCENARIO_GAP_GLITCH), 12);
  const jxVal = Number(defectJx.values[0].value);
  assert.ok(jxVal >= 3.5 && jxVal <= 4.2, `Expected gap glitch between 3.5mm and 4.2mm, got ${jxVal}`);
  assert.equal(defectJx.data_status, 'VALID');
  assert.equal(validateMeasurement(defectJx), true);

  // 4. SCENARIO_OVALITY_OUT_OF_BOUNDS (绝缘挤出失圆：不圆度达到 10%~12%)
  const defectBy = record(makeRun('HY-BY-01', byAssignment, SCENARIO_OVALITY_OUT_OF_BOUNDS), 13);
  const byVal = Number(defectBy.values[0].value);
  assert.ok(byVal >= 10.0 && byVal <= 12.0, `Expected ovality between 10% and 12%, got ${byVal}`);
  assert.equal(defectBy.data_status, 'VALID');
  assert.equal(validateMeasurement(defectBy), true);

  // 5. SCENARIO_SENSOR_BLOCKED (光电遮挡空料：数值为 null，data_status='MISSING')
  const blocked = record(makeRun('HY-DG-01', dgAssignment, SCENARIO_SENSOR_BLOCKED), 14);
  assert.equal(blocked.data_status, 'MISSING');
  assert.equal(blocked.position_quality, 'UNKNOWN');
  assert.equal(blocked.position_m, null);
  assert.equal(blocked.values[0].value, null);
  assert.equal(blocked.values[0].data_status, 'MISSING');
  assert.equal(blocked.values[0].reason_code, 'OPTICAL_SENSOR_BLOCKED');
  assert.equal(validateMeasurement(blocked), true);
});

test('Auto cut spool: feed-control monitors planned_length_m, stops feeding and sends CUT_SPOOL event', async () => {
  const dir = mkdtempSync(tmpdir() + '/sim-cut-');
  const q = new Queue(dir + '/test_cut.sqlite');

  const dispatchedEvents: any[] = [];
  const mockClient = {
    sendCutSpoolEvent: async (payload: any) => {
      dispatchedEvents.push(payload);
      return { status: 200, value: { code: 'OK', data: { event_id: 'EVT-CUT-1' } } };
    },
  };

  try {
    const feed = new FeedControl(q);
    const runId = 'run-cut-test-01';
    const assignment = {
      task_id: 'TASK-CUT-01',
      spool_id: 'SPOOL-A1',
      metric_code: 'SHIELD_OVERLAP_RATE',
      planned_length_m: '100.0000',
    };

    q.db.prepare(
      'INSERT INTO sim_run(id,device_id,capture_session,scenario,seed,target,assignment,created_at) VALUES(?,?,?,?,?,?,?,?)'
    ).run(runId, 'HY-DG-01', 'sess-cut', 'normal', 0, 200, JSON.stringify(assignment), new Date().toISOString());

    // 1. 送料米数未达 planned_length_m (50.0m < 100.0m)
    const res1 = await feed.checkAutoCutSpool({
      runId,
      currentPositionM: '50.0000',
      plannedLengthM: '100.0000',
      deviceId: 'HY-DG-01',
      spoolId: 'SPOOL-A1',
      client: mockClient,
    });
    assert.equal(res1.cut, false);
    assert.equal(res1.event_sent, false);
    assert.equal(q.run(runId).control, 'RUNNING');
    assert.equal(dispatchedEvents.length, 0);

    // 2. 送料米数到达 planned_length_m (100.0m >= 100.0m)
    const res2 = await feed.checkAutoCutSpool({
      runId,
      currentPositionM: '100.0000',
      plannedLengthM: '100.0000',
      deviceId: 'HY-DG-01',
      spoolId: 'SPOOL-A1',
      client: mockClient,
    });
    assert.equal(res2.cut, true);
    assert.equal(res2.event_sent, true);
    // 自动停止送料
    assert.equal(q.run(runId).control, 'STOPPED');
    // 验证向平台发送了 CUT_SPOOL 生产事件
    assert.equal(dispatchedEvents.length, 1);
    assert.equal(dispatchedEvents[0].device_id, 'HY-DG-01');
    assert.equal(dispatchedEvents[0].spool_id, 'SPOOL-A1');
    assert.equal(dispatchedEvents[0].position_m, '100.0000');

    // 3. 幂等性验证：重复触发不会重复发送
    const res3 = await feed.checkAutoCutSpool({
      runId,
      currentPositionM: '100.5000',
      plannedLengthM: '100.0000',
      deviceId: 'HY-DG-01',
      spoolId: 'SPOOL-A1',
      client: mockClient,
    });
    assert.equal(res3.cut, true);
    assert.equal(dispatchedEvents.length, 1); // 依然保持为 1 次

    // 4. 状态查询验证
    assert.equal(feed.isCutSpoolTriggered(runId), true);
    const cutEvent = feed.getCutSpoolEvent(runId);
    assert.equal(cutEvent.status, 'CUT');
    assert.equal(cutEvent.position_m, '100.0000');
  } finally {
    q.db.close();
    rmSync(dir, { recursive: true });
  }
});

test('Coordinated feeding: three devices concurrent feeding with microsecond interleaved timestamps', async () => {
  const dir = mkdtempSync(tmpdir() + '/sim-coord-');
  const dbPath = dir + '/sim_coord.sqlite';

  // 模拟平台后端接口
  const clientToken = 'test-token-sim';
  const manager = new WebManager(dbPath, 'http://127.0.0.1:4192', clientToken);

  // Mock manager.client.request
  const mockAssignments: Record<string, any> = {
    'HY-DG-01': {
      binding_id: 'BIND-DG',
      binding_version: 1,
      task_id: 'TASK-DG',
      spool_id: 'SPOOL-COORD-1',
      metric_code: 'SHIELD_OVERLAP_RATE',
      planned_length_m: '2.0000',
    },
    'HY-JX-01': {
      binding_id: 'BIND-JX',
      binding_version: 1,
      task_id: 'TASK-JX',
      spool_id: 'SPOOL-COORD-1',
      metric_code: 'WIRE_GAP',
      planned_length_m: '2.0000',
    },
    'HY-BY-01': {
      binding_id: 'BIND-BY',
      binding_version: 1,
      task_id: 'TASK-BY',
      spool_id: 'SPOOL-COORD-1',
      metric_code: 'OVALITY',
      planned_length_m: '2.0000',
    },
  };

  const cutSpoolEvents: any[] = [];
  (manager as any).client = {
    request: async (path: string) => {
      if (path === '/ingestion/profile') {
        return {
          data: {
            data_environment: 'SIMULATED',
            devices: [
              { device_id: 'HY-DG-01', metric_codes: ['SHIELD_OVERLAP_RATE'] },
              { device_id: 'HY-JX-01', metric_codes: ['WIRE_GAP'] },
              { device_id: 'HY-BY-01', metric_codes: ['OVALITY'] },
            ],
          },
        };
      }
      for (const [devId, assign] of Object.entries(mockAssignments)) {
        if (path === `/devices/${devId}/assignment`) {
          return { data: { assignment: assign } };
        }
      }
      return { data: {} };
    },
    sendCutSpoolEvent: async (payload: any) => {
      cutSpoolEvents.push(payload);
      return { status: 200, value: { code: 'OK' } };
    },
  };

  try {
    // 协同进料：步长 0.5m，计划米数 2.0m（共 4 步触发切盘）
    const result = await manager.coordinatedFeed({
      spool_id: 'SPOOL-COORD-1',
      step_m: 0.5,
      planned_length_m: 2.0,
      scenario: SCENARIO_PERFECT,
      device_scenarios: {
        'HY-JX-01': SCENARIO_GAP_GLITCH, // 模拟间隙出现毛刺缺陷，其他正常
      },
    });

    assert.equal(result.coordinated_runs.length, 3);
    assert.equal(result.total_steps, 4);
    assert.equal(result.final_position_m, '2.0000');
    assert.equal(result.auto_cut_triggered, true);
    assert.equal(result.cut_spool_events.length, 3);

    // 检查三台设备在 SQLite 缓冲中落盘的样本记录
    for (const run of result.coordinated_runs) {
      const samples = manager.queue.db
        .prepare('SELECT payload FROM sample WHERE run_id=? ORDER BY sequence ASC')
        .all(run.runId) as any[];

      assert.equal(samples.length, 4);

      for (let sIdx = 0; sIdx < samples.length; sIdx++) {
        const payload = JSON.parse(samples[sIdx].payload);
        const expectedPos = ((sIdx + 1) * 0.5).toFixed(4);
        assert.equal(payload.position_m, expectedPos);
        assert.equal(payload.device_id, run.device_id);

        // 验证每条测点报文完全符合 Schema 1.0 契约
        assert.equal(validateMeasurement(payload), true, JSON.stringify(validateMeasurement.errors));
      }
    }

    // 验证微秒级交织时序：
    // 在同一步（seq=1）下，三台设备采样时间戳微秒偏移各异（0μs, 100μs, 200μs）
    const dgSample1 = JSON.parse(
      (manager.queue.db.prepare('SELECT payload FROM sample WHERE run_id=? AND sequence=1').get(result.coordinated_runs[0].runId) as any).payload
    );
    const jxSample1 = JSON.parse(
      (manager.queue.db.prepare('SELECT payload FROM sample WHERE run_id=? AND sequence=1').get(result.coordinated_runs[1].runId) as any).payload
    );
    const bySample1 = JSON.parse(
      (manager.queue.db.prepare('SELECT payload FROM sample WHERE run_id=? AND sequence=1').get(result.coordinated_runs[2].runId) as any).payload
    );

    assert.ok(dgSample1.sample_time.endsWith('100000Z'));
    assert.ok(jxSample1.sample_time.endsWith('100100Z'));
    assert.ok(bySample1.sample_time.endsWith('100200Z'));

    // 验证三台设备达到 2.0m 后均停止并发送了切盘事件
    assert.equal(cutSpoolEvents.length, 3);
    const cutDevices = cutSpoolEvents.map((c) => c.device_id).sort();
    assert.deepEqual(cutDevices, ['HY-BY-01', 'HY-DG-01', 'HY-JX-01']);
  } finally {
    await manager.close();
    rmSync(dir, { recursive: true });
  }
});

test('WebManager API scenarios listing and cut spool trigger', async () => {
  const dir = mkdtempSync(tmpdir() + '/sim-api-');
  const dbPath = dir + '/sim_api.sqlite';
  const manager = new WebManager(dbPath, 'http://127.0.0.1:4192', 'token');

  let sentEvent: any = null;
  (manager as any).client = {
    sendCutSpoolEvent: async (payload: any) => {
      sentEvent = payload;
      return { status: 200, value: { code: 'OK' } };
    },
  };

  try {
    // 1. 获取预设场景
    const scenariosResp = manager.scenarios();
    assert.ok(scenariosResp.presets[SCENARIO_PERFECT]);
    assert.ok(scenariosResp.presets[SCENARIO_OVERLAP_DEFECT]);
    assert.ok(scenariosResp.presets[SCENARIO_GAP_GLITCH]);
    assert.ok(scenariosResp.presets[SCENARIO_OVALITY_OUT_OF_BOUNDS]);
    assert.ok(scenariosResp.presets[SCENARIO_SENSOR_BLOCKED]);

    // 2. 主动触发切盘
    const cutResp = await manager.triggerCutSpool({
      device_id: 'HY-DG-01',
      spool_id: 'SPOOL-API-1',
      position_m: '250.0000',
    });

    assert.equal(cutResp.status, 200);
    assert.equal(sentEvent.device_id, 'HY-DG-01');
    assert.equal(sentEvent.spool_id, 'SPOOL-API-1');
    assert.equal(sentEvent.position_m, '250.0000');
  } finally {
    await manager.close();
    rmSync(dir, { recursive: true });
  }
});
