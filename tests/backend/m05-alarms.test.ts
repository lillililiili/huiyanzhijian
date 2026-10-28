import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';

const require = createRequire(resolve('package.json')), { Pool } = require('pg');
const root = resolve('../..');
const local = Object.fromEntries(
  readFileSync(resolve(root, 'runtime/b1/local.env'), 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(s => {
      const i = s.indexOf('=');
      return [s.slice(0, i), s.slice(i + 1)];
    })
);
const access = JSON.parse(readFileSync(resolve(root, 'runtime/b1/access.json'), 'utf8'));

const name = 'hy_m05_test_' + Date.now();
const env = {
  ...process.env,
  ...local,
  DATABASE_URL: local.DATABASE_URL.replace('/huiyan_b1', '/' + name),
  MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL.replace('/huiyan_b1', '/' + name),
  PORT: '4218',
};

const evidence = resolve(root, '临时文件夹/M05_工业报警生命周期', name);
mkdirSync(evidence, { recursive: true });

let api: ChildProcess, logs = '';
const url = 'http://127.0.0.1:4218/api/v1';
const pause = (ms: number) => new Promise(r => setTimeout(r, ms));

async function req(path: string, b?: any, h: any = {}, key = randomUUID()) {
  const r = await fetch(url + path, {
    method: b === undefined ? 'GET' : 'POST',
    headers: { ...h, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: b === undefined ? undefined : JSON.stringify(b),
  });
  return { status: r.status, body: await r.json(), cookies: r.headers.getSetCookie() };
}

async function login(user: string) {
  const r = await req('/auth/login', { username: user, password: access.users[user] });
  assert.equal(r.status, 200);
  return {
    Cookie: r.cookies.map(s => s.split(';')[0]).join('; '),
    'X-CSRF-Token': r.body.data.csrf_token,
  };
}

const ok = (r: any) => {
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.data;
};

test('M05 Industrial Alarm lifecycle, debounce clustering, handling & review state machine', { timeout: 90000 }, async t => {
  const bootstrap = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
  await bootstrap.query('CREATE DATABASE ' + name);
  await bootstrap.end();

  // Run all migrations including 009_m05_alarms.sql and bootstrap seed
  for (const script of ['migrate', 'migrate', 'bootstrap']) {
    execFileSync(process.execPath, ['--import', 'tsx', 'db/' + script + '.ts'], { env, stdio: 'pipe' });
  }

  const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

  try {
    // 重新构建 platform 生产产物
    execFileSync('cmd', ['/c', 'npm', 'run', 'build'], { stdio: 'pipe' });

    api = spawn(process.execPath, ['dist/composition/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    api.stdout!.on('data', s => logs += s);
    api.stderr!.on('data', s => logs += s);

    let ready = false;
    for (let n = 0; n < 80; n++) {
      try {
        if ((await fetch(url + '/health/ready')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await pause(100);
    }
    assert.ok(ready, 'API must become ready');

    const admin = await login('admin');
    const viewer = await login('viewer');

    await t.test('initial alarms list is empty and permissions guard works', async () => {
      const list = ok(await req('/alarms', undefined, admin));
      assert.equal(list.items.length, 0);

      // 未登录拒绝
      assert.equal((await req('/alarms')).status, 401);
      // viewer 用户不能执行确认或聚合
      assert.equal((await req('/alarms:aggregate', {}, viewer)).status, 403);
    });

    await t.test('sliding window debounce: aggregate continuous glitches into clustered alarm and separate distant glitches', async () => {
      // 模拟插入属于同一任务和设备的 3 个连续超限点 (搭盖率不足，相距 0.5m，时间相隔 1 分钟)
      const record1 = randomUUID(), record2 = randomUUID(), record3 = randomUUID(), recordDistant = randomUUID();
      const taskId = 'task-demo-01', deviceId = 'HY-DG-01';

      await owner.query(`
        INSERT INTO m04.measurement_record(
          id, factory_id, device_id, source_record_key, capture_session_id, capture_sequence,
          task_id, sample_kind, sample_time, time_source, position_m, position_quality,
          source_type, data_environment, data_status, receipt_status, raw_payload, payload_hash, schema_version
        ) VALUES
        ($1, 'factory-local', $4, 'K1', 'S1', 1, $5, 'NEW_SAMPLE', now() - interval '3 minutes', 'DEVICE', 10.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H1', '1.0'),
        ($2, 'factory-local', $4, 'K2', 'S1', 2, $5, 'NEW_SAMPLE', now() - interval '2 minutes', 'DEVICE', 10.5, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H2', '1.0'),
        ($3, 'factory-local', $4, 'K3', 'S1', 3, $5, 'NEW_SAMPLE', now() - interval '1 minute', 'DEVICE', 11.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H3', '1.0')
      `, [record1, record2, record3, deviceId, taskId]);

      await owner.query(`
        INSERT INTO m04.measurement_value(record_id, metric_code, value, unit, data_status, source_quality_result, window_definition) VALUES
        ($1, 'SHIELD_OVERLAP_RATE', 6.5, '%', 'VALID', 'FAIL', '{"kind":"POINT"}'),
        ($2, 'SHIELD_OVERLAP_RATE', 5.0, '%', 'VALID', 'FAIL', '{"kind":"POINT"}'),
        ($3, 'SHIELD_OVERLAP_RATE', 7.0, '%', 'VALID', 'FAIL', '{"kind":"POINT"}')
      `, [record1, record2, record3]);

      await owner.query(`
        INSERT INTO m04.measurement_evaluation(record_id, version, quality_result, reason_code, rule_snapshot) VALUES
        ($1, 1, 'FAIL', 'BELOW_LOWER', '{}'),
        ($2, 1, 'FAIL', 'BELOW_LOWER', '{}'),
        ($3, 1, 'FAIL', 'BELOW_LOWER', '{}')
      `, [record1, record2, record3]);

      // 触发聚合（支持 /api/v1/alarms:aggregate 与 options 参数）
      const agg = ok(await req('/alarms:aggregate', { task_id: taskId, options: { windowSeconds: 180, windowMeters: 5.0 } }, admin));
      assert.equal(agg.total_fail_points, 3);
      assert.equal(agg.created_alarms, 1, '连续毛刺在时间与米数窗口内必须合并为一个报警');

      // 多维筛选：按 task_id, status, severity, metric 过滤
      const filtered = ok(await req(`/alarms?task_id=${taskId}&status=TRIGGERED&severity=CRITICAL&metric=SHIELD_OVERLAP_RATE`, undefined, admin));
      assert.equal(filtered.items.length, 1);
      const a = filtered.items[0];
      assert.equal(a.metric_code, 'SHIELD_OVERLAP_RATE');
      assert.equal(a.sample_count, 3);
      assert.equal(a.status, 'TRIGGERED', '状态机初始状态必须为 TRIGGERED');
      assert.equal(a.handling_state, 'PENDING');
      assert.equal(a.lifecycle, 'ACTIVE');
      assert.equal(a.severity, 'CRITICAL');
      assert.equal(Number(a.start_position_m), 10.0);
      assert.equal(Number(a.end_position_m), 11.0);
      // 搭盖率越低越严重，峰值应为 5.0
      assert.equal(Number(a.peak_value), 5.0);
    });

    await t.test('complete lifecycle state machine: TRIGGERED -> ACKNOWLEDGED -> HANDLED -> VERIFIED_CLOSED with audit', async () => {
      const alarms = ok(await req('/alarms?status=TRIGGERED', undefined, admin));
      assert.ok(alarms.items.length > 0);
      const alarmId = alarms.items[0].id;

      // 1. 操作员确认：POST /api/v1/alarms/:id/ack (TRIGGERED -> ACKNOWLEDGED)
      const ackKey = randomUUID();
      const ackRes = ok(await req(`/alarms/${alarmId}/ack`, {}, admin, ackKey));
      assert.equal(ackRes.status, 'ACKNOWLEDGED');
      assert.equal(ackRes.handling_state, 'PROCESSING');
      assert.ok(ackRes.acknowledged_at);

      // 幂等重试应返回相同结果
      const ackRetry = ok(await req(`/alarms/${alarmId}/ack`, {}, admin, ackKey));
      assert.equal(ackRetry.status, 'ACKNOWLEDGED');

      // 状态已变，用新 key 重复确认应报 409
      assert.equal((await req(`/alarms/${alarmId}/ack`, {}, admin, randomUUID())).status, 409);

      // 2. 登记处置措施与原因说明：POST /api/v1/alarms/:id/handle (ACKNOWLEDGED -> HANDLED)
      const handlePayload = {
        opinion: '排查发现铜带张力过松导致局部搭盖超限，已停机校正张力架并标记隔离缺陷段',
        action_plan: '复查下一段张力平稳度并在交接班记录留痕',
        evidence_refs: [{ name: '现场校准单.pdf', url: '/files/evidence-20261028-01.pdf' }],
      };
      const handleRes = ok(await req(`/alarms/${alarmId}/handle`, handlePayload, admin));
      assert.equal(handleRes.status, 'HANDLED');
      assert.equal(handleRes.handling_state, 'HANDLED');
      assert.ok(handleRes.handled_at);

      // 3. 主管复核关闭并写入 audit 记录：POST /api/v1/alarms/:id/close (HANDLED -> VERIFIED_CLOSED)
      const closePayload = {
        approved: true,
        opinion: '主管确认张力已调整到位，隔离区段已登记，同意结案关闭',
      };
      const closeRes = ok(await req(`/alarms/${alarmId}/close`, closePayload, admin));
      assert.equal(closeRes.status, 'VERIFIED_CLOSED');
      assert.equal(closeRes.handling_state, 'REVIEWED');
      assert.equal(closeRes.lifecycle, 'RECOVERED');
      assert.ok(closeRes.reviewed_at);

      // 4. 查看详情时间线 (Detail)
      const detail = ok(await req(`/alarms/${alarmId}`, undefined, admin));
      assert.equal(detail.status, 'VERIFIED_CLOSED');
      assert.equal(detail.actions.length, 4, '应包含 TRIGGER, ACKNOWLEDGE, HANDLE, REVIEW 完整生命周期轨迹');

      const actions = detail.actions.map((act: any) => act.action);
      assert.deepEqual(actions, ['TRIGGER', 'ACKNOWLEDGE', 'HANDLE', 'REVIEW']);

      // 5. 校验审计事件库 m00.audit_event 中确实写入了主管复核关闭事件
      const audits = await owner.query(
        "SELECT * FROM m00.audit_event WHERE resource_type = 'ALARM' AND resource_id = $1 AND action = 'ALARM_VERIFIED_CLOSED'",
        [alarmId]
      );
      assert.ok(audits.rowCount && audits.rowCount > 0, '主管关闭报警必须写入 m00.audit_event 审计表');
      assert.equal(audits.rows[0].result, 'SUCCESS');
    });
  } finally {
    if (api && !api.killed) {
      api.kill();
    }
    await owner.end();
  }
});
