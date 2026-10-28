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

const name = 'hy_m07_test_' + Date.now();
const env = {
  ...process.env,
  ...local,
  DATABASE_URL: local.DATABASE_URL.replace('/huiyan_b1', '/' + name),
  MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL.replace('/huiyan_b1', '/' + name),
  PORT: '4220',
};

const evidence = resolve(root, '临时文件夹/M07_MES出站队列与ACK闭环', name);
mkdirSync(evidence, { recursive: true });

let api: ChildProcess, logs = '';
const url = 'http://127.0.0.1:4220/api/v1';
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

test('M07 Customer MES Outbound Queue, HMAC-SHA256 Delivery, Business ACK & Retry Lifecycle', { timeout: 90000 }, async t => {
  const bootstrap = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
  await bootstrap.query('CREATE DATABASE ' + name);
  await bootstrap.end();

  // 运行迁移与引导种子
  for (const script of ['migrate', 'migrate', 'bootstrap']) {
    execFileSync(process.execPath, ['--import', 'tsx', 'db/' + script + '.ts'], { env, stdio: 'pipe' });
  }

  const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

  try {
    // 重新构建 platform 生产代码
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

    await t.test('initial mes outbox queue is empty and permissions guard works', async () => {
      const list = ok(await req('/mes/outbox', undefined, admin));
      assert.equal(list.items.length, 0);

      // 未登录拒绝
      assert.equal((await req('/mes/outbox')).status, 401);
      // viewer 用户不能将任务推入出站队列
      assert.equal((await req('/mes/enqueue-task', { task_id: 't1' }, viewer)).status, 403);
    });

    let createdTaskId = '';
    await t.test('prepare task, spool and measurements for MES outbound', async () => {
      // 1. 创建工单
      const wo = ok(await req('/work-orders', { external_code: 'WO-MES-20261028-01', specification_id: 'SP035-400' }, admin));

      // 2. 创建线缆盘
      const spool = ok(await req('/spools', {
        spool_code: 'SP-MES-20261028-A',
        work_order_id: wo.id,
      }, admin));

      // 3. 创建任务
      const task = ok(await req('/tasks', {
        work_order_id: wo.id,
        spool_id: spool.id,
        device_id: 'HY-DG-01',
        specification_id: 'SP035-400',
        process_id: 'process-dg',
        metric_code: 'SHIELD_OVERLAP_RATE',
        recipe_version_id: 'DG-V1.0',
        planned_length_m: '1000',
      }, admin));
      createdTaskId = task.id;

      // 启动并结束任务以生成完工记录
      await req(`/tasks/${task.id}:start`, {}, admin);
      await req(`/tasks/${task.id}:end`, {}, admin);

      // 插入测量数据
      const r1 = randomUUID(), r2 = randomUUID(), r3 = randomUUID();
      await owner.query(`
        INSERT INTO m04.measurement_record(
          id, factory_id, device_id, source_record_key, capture_session_id, capture_sequence,
          task_id, sample_kind, sample_time, time_source, position_m, position_quality,
          source_type, data_environment, data_status, receipt_status, raw_payload, payload_hash, schema_version
        ) VALUES
        ($1, 'factory-local', 'HY-DG-01', 'K1', 'S1', 1, $4, 'NEW_SAMPLE', now() - interval '2 minutes', 'DEVICE', 10.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H1', '1.0'),
        ($2, 'factory-local', 'HY-DG-01', 'K2', 'S1', 2, $4, 'NEW_SAMPLE', now() - interval '1 minute', 'DEVICE', 20.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H2', '1.0'),
        ($3, 'factory-local', 'HY-DG-01', 'K3', 'S1', 3, $4, 'NEW_SAMPLE', now(), 'DEVICE', 30.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H3', '1.0')
      `, [r1, r2, r3, task.id]);

      await owner.query(`
        INSERT INTO m04.measurement_value(record_id, metric_code, value, unit, data_status, source_quality_result, window_definition) VALUES
        ($1, 'SHIELD_OVERLAP_RATE', 14.5, '%', 'VALID', 'PASS', '{"kind":"POINT"}'),
        ($2, 'WIRE_GAP', 1.2, 'mm', 'VALID', 'PASS', '{"kind":"POINT"}'),
        ($3, 'OVALITY', 1.8, '%', 'VALID', 'PASS', '{"kind":"POINT"}')
      `, [r1, r2, r3]);

      await owner.query(`
        INSERT INTO m04.measurement_evaluation(record_id, version, quality_result, reason_code, rule_snapshot) VALUES
        ($1, 1, 'PASS', 'NONE', '{}'),
        ($2, 1, 'PASS', 'NONE', '{}'),
        ($3, 1, 'PASS', 'NONE', '{}')
      `, [r1, r2, r3]);
    });

    let deliveryId = '';
    await t.test('enqueue task quality result to MES outbox, compute HMAC signature and handshake ACK', async () => {
      // 确保默认端点 URL 指向当前进程的端口
      await owner.query(
        "UPDATE m07.mes_endpoint SET base_url = 'http://127.0.0.1:4220/api/v1/mes/mock-receiver' WHERE id = 'mes-mock-default'"
      );

      // 将完工任务推入出站通道并立即投递
      const res = ok(await req('/mes/enqueue-task', { task_id: createdTaskId }, admin));
      assert.ok(res.delivery_id, '必须生成 delivery_id');
      assert.equal(res.state, 'SENT');
      assert.equal(res.status, 'ACKNOWLEDGED');
      assert.ok(res.ack_code.startsWith('MES-ACK-'), '必须成功获取客户 MES 返回的业务 ACK');
      assert.equal(res.verdict, 'PASS');
      deliveryId = res.delivery_id;

      // 通过管理员控制接口 GET /api/v1/mes/outbox 检查队列与状态
      const outbox = ok(await req('/mes/outbox', undefined, admin));
      assert.ok(outbox.items.length >= 1);
      const item = outbox.items.find((d: any) => d.id === deliveryId);
      assert.ok(item);
      assert.equal(item.status, 'ACKNOWLEDGED');
      assert.equal(item.business_ack, res.ack_code);
      assert.equal(item.attempt_count, 1);
      assert.ok(item.payload.metric_results.length >= 3, '出站报文必须完整组装指标数据');

      // 验证兼容视图 m07.measurement_outbox
      const viewRes = await owner.query('SELECT * FROM m07.measurement_outbox WHERE id = $1', [deliveryId]);
      assert.equal(viewRes.rowCount, 1, 'm07.measurement_outbox 视图必须能被正常查询');
    });

    await t.test('manual retry endpoint: POST /api/v1/mes/outbox/:id/retry and exponential backoff on errors', async () => {
      // 1. 手动触发已有记录重试
      const retryRes = ok(await req(`/mes/outbox/${deliveryId}/retry`, {}, admin));
      assert.equal(retryRes.status, 'ACKNOWLEDGED');
      assert.ok(retryRes.ack_code);

      // 2. 模拟网络异常或故障端点
      const fakeDeliveryId = randomUUID();
      await owner.query(`
        INSERT INTO m07.mes_delivery(
          id, factory_id, endpoint_id, task_id, business_key, message_type,
          state, attempt_count, max_attempts, payload, payload_hash, next_attempt_at
        ) VALUES(
          $1, 'factory-local', 'mes-mock-default', $2, 'TASK-QC:fake-01', 'INSPECTION_REPORT',
          'FAILED', 1, 5, '{"spool_code":"SP-ERR"}'::jsonb, 'hash-fake', now()
        )
      `, [fakeDeliveryId, createdTaskId]);

      // 将端点改为一个无效地址以触发网络故障
      await owner.query("UPDATE m07.mes_endpoint SET base_url = 'http://127.0.0.1:59999/unreachable' WHERE id = 'mes-mock-default'");

      const failRetry = ok(await req(`/mes/outbox/${fakeDeliveryId}/retry`, {}, admin));
      assert.equal(failRetry.state, 'FAILED');
      assert.equal(failRetry.status, 'RETRYING', '失败但未超最大重试次数应标记为 RETRYING');

      // 检查指数退避 next_attempt_at 确实被写入
      const failRow = await owner.query('SELECT attempt_count, next_attempt_at FROM m07.mes_delivery WHERE id = $1', [fakeDeliveryId]);
      assert.equal(failRow.rows[0].attempt_count, 2);
      assert.ok(failRow.rows[0].next_attempt_at, '指数退避重试时间必须被设置');

      // 3. 模拟业务拒绝（如 400 Bad Request）
      // 将端点恢复为 mock receiver，但修改 payload 使得缺失 spool_code
      await owner.query("UPDATE m07.mes_endpoint SET base_url = 'http://127.0.0.1:4220/api/v1/mes/mock-receiver' WHERE id = 'mes-mock-default'");
      await owner.query("UPDATE m07.mes_delivery SET payload = '{\"bad\":\"no_spool\"}'::jsonb WHERE id = $1", [fakeDeliveryId]);

      const rejectRetry = ok(await req(`/mes/outbox/${fakeDeliveryId}/retry`, {}, admin));
      assert.equal(rejectRetry.state, 'FAILED');
      assert.equal(rejectRetry.status, 'REJECTED', '业务校验拒绝应标记为 REJECTED');
    });

    await t.test('outbox worker batch polling process', async () => {
      // 触发 Worker 批量处理接口
      const procRes = ok(await req('/mes/outbox/process', { batch_size: 5 }, admin));
      assert.ok(typeof procRes.processed === 'number');
      assert.ok(typeof procRes.success === 'number');
      assert.ok(typeof procRes.failed === 'number');
    });
  } finally {
    if (api && !api.killed) {
      api.kill();
    }
    await owner.end();
  }
});
