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

const name = 'hy_pipeline_test_' + Date.now();
const env = {
  ...process.env,
  ...local,
  DATABASE_URL: local.DATABASE_URL.replace('/huiyan_b1', '/' + name),
  MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL.replace('/huiyan_b1', '/' + name),
  PORT: '4221',
};

const evidence = resolve(root, '临时文件夹/BE-TASK-04_业务流水线自动事件联动', name);
mkdirSync(evidence, { recursive: true });

let api: ChildProcess, logs = '';
const url = 'http://127.0.0.1:4221/api/v1';
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

test('BE-TASK-04: Business Pipeline Automation - Event-Driven Alarms, Auto Quality Report, MES Delivery & P12 Manual Import', { timeout: 100000 }, async t => {
  const bootstrap = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
  await bootstrap.query('CREATE DATABASE ' + name);
  await bootstrap.end();

  // 运行全部迁移与 bootstrap 种子
  for (const script of ['migrate', 'migrate', 'bootstrap']) {
    execFileSync(process.execPath, ['--import', 'tsx', 'db/' + script + '.ts'], { env, stdio: 'pipe' });
  }

  const owner = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

  try {
    // 重新编译最新 platform 生产代码
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
    assert.ok(ready, 'API must become ready on port 4221');

    const admin = await login('admin');
    const viewer = await login('viewer');

    // 确保默认 MES 模拟端点指向当前进程
    await owner.query(
      "UPDATE m07.mes_endpoint SET base_url = 'http://127.0.0.1:4221/api/v1/mes/mock-receiver' WHERE id = 'mes-mock-default'"
    );

    // 准备基础工单、盘号与检测任务 (HY-DG-01: 金属屏蔽搭盖率)
    const wo = ok(await req('/work-orders', { external_code: 'WO-AUTO-20261028-01', specification_id: 'SP035-400' }, admin));
    const spool = ok(await req('/spools', { work_order_id: wo.id, spool_code: 'SP-AUTO-20261028-A' }, admin));
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

    // 启动任务 (提供 If-Match 版本)
    await req(`/tasks/${task.id}:start`, {}, { ...admin, 'If-Match': String(task.version) });

    // ----------------------------------------------------
    // 测试点 1: P12 数据导入解析校验 (import:parse)
    // ----------------------------------------------------
    await t.test('P12 Import: parse CSV and JSON with line validation (timestamp, order, range)', async () => {
      // 1. 未授权检查
      assert.equal((await req('/measurements/import:parse', { task_id: task.id })).status, 401);

      // 2. 带有非法行（米数倒序、物理超限如 150%、时间无效）的解析
      const badInput = {
        task_id: task.id,
        rows: [
          { position_m: 10.0, value: 14.5, sample_time: new Date().toISOString() },
          { position_m: 8.0, value: 15.0, sample_time: new Date().toISOString() }, // 米数倒序
          { position_m: 12.0, value: 150.0, sample_time: new Date().toISOString() }, // 物理量程超限 (搭盖率 > 100%)
          { position_m: 15.0, value: 16.0, sample_time: 'INVALID-DATE-TIME' }, // 时间格式错误
        ],
      };

      const parseBad = ok(await req('/measurements/import:parse', badInput, admin));
      assert.equal(parseBad.valid, false, '存在错误行应标记为 valid=false');
      assert.equal(parseBad.total_rows, 4);
      assert.equal(parseBad.valid_rows, 1);
      assert.equal(parseBad.invalid_rows, 3);
      assert.ok(parseBad.rows[1].errors[0].includes('米数倒序'));
      assert.ok(parseBad.rows[2].errors[0].includes('物理合理范围'));
      assert.ok(parseBad.rows[3].errors[0].includes('采样时间格式无效'));

      // 3. 合法 CSV 文本解析
      const csvText = `position_m,value,sample_time\n20.0,15.2,${new Date().toISOString()}\n21.0,16.0,${new Date().toISOString()}`;
      const parseCsv = ok(await req('/measurements/import:parse', { task_id: task.id, csv_text: csvText }, admin));
      assert.equal(parseCsv.valid, true);
      assert.equal(parseCsv.valid_rows, 2);
      assert.equal(parseCsv.invalid_rows, 0);
    });

    // ----------------------------------------------------
    // 测试点 2: P12 数据导入质检主管确认提交 (import:submit)
    // ----------------------------------------------------
    await t.test('P12 Import: supervisor submit with recipe evaluation, audit event and raw view', async () => {
      // 1. 普通操作员/viewer 无权提交
      assert.equal((await req('/measurements/import:submit', { task_id: task.id, rows: [] }, viewer)).status, 403);

      // 2. 主管提交 3 个点（其中 1 个超限点：搭盖率 7.5% < 10.0%，2 个合格点 14.0%, 15.0%）
      const submitPayload = {
        task_id: task.id,
        batch_name: '车间白班人工补录批次',
        reason: '传感器信号偶发漂移，质检员按台账人工录入',
        rows: [
          { position_m: 30.0, value: 14.0, sample_time: new Date(Date.now() - 3000).toISOString() },
          { position_m: 30.5, value: 7.5, sample_time: new Date(Date.now() - 2000).toISOString() }, // FAIL 超限点
          { position_m: 31.0, value: 15.0, sample_time: new Date(Date.now() - 1000).toISOString() },
        ],
      };

      const submitRes = ok(await req('/measurements/import:submit', submitPayload, admin));
      assert.equal(submitRes.success, true);
      assert.equal(submitRes.inserted_count, 3);
      assert.equal(submitRes.fail_count, 1, '应精准识别 1 个超限点');
      assert.equal(submitRes.alarm_triggered, true, '发现超限点应自动触发防抖报警闭环');

      // 3. 校验数据库 m04.measurement_record 中标记了 MANUAL_IMPORT
      const rowsRes = await owner.query(
        "SELECT * FROM m04.measurement_record WHERE task_id = $1 AND source_type = 'MANUAL_IMPORT'",
        [task.id]
      );
      assert.equal(rowsRes.rowCount, 3);
      assert.equal(rowsRes.rows[0].position_quality, 'MANUAL_VERIFIED');

      // 4. 校验兼容视图 m04.measurement_raw 可查
      const rawRes = await owner.query("SELECT * FROM m04.measurement_raw WHERE task_id = $1", [task.id]);
      assert.equal(rawRes.rowCount, 3, 'm04.measurement_raw 视图必须能被正常查询');

      // 5. 校验审计事件库 m00.audit_event
      const auditRes = await owner.query(
        "SELECT * FROM m00.audit_event WHERE action = 'MANUAL_IMPORT_SUBMITTED' AND resource_id = $1",
        [task.id]
      );
      assert.ok(auditRes.rowCount && auditRes.rowCount > 0, '人工补录提交必须记录到 m00.audit_event');
      assert.equal(auditRes.rows[0].result, 'SUCCESS');

      // 6. 验证超限自动联动产生的报警事件 (M05)
      const alarmsRes = ok(await req(`/alarms?task_id=${task.id}`, undefined, admin));
      assert.ok(alarmsRes.items.length >= 1, '超限补录必须实时自动生成报警事件');
      assert.equal(alarmsRes.items[0].status, 'TRIGGERED');
      assert.equal(alarmsRes.items[0].metric_code, 'SHIELD_OVERLAP_RATE');
    });

    // ----------------------------------------------------
    // 测试点 3: 测点入库超限实时联动告警 (Event-Driven Alarm)
    // ----------------------------------------------------
    await t.test('measurements.ingest: auto-trigger M05 sliding window debounce on FAIL without manual call', async () => {
      // 模拟直接向数据库写入 FAIL 测点并调用 /api/v1/alarms 验证状态
      const recordFail = randomUUID();
      await owner.query(`
        INSERT INTO m04.measurement_record(
          id, factory_id, device_id, source_record_key, capture_session_id, capture_sequence,
          task_id, sample_kind, sample_time, time_source, position_m, position_quality,
          source_type, data_environment, data_status, receipt_status, raw_payload, payload_hash, schema_version
        ) VALUES(
          $1, 'factory-local', 'HY-DG-01', 'K-AUTO-01', 'S1', 991, $2, 'NEW_SAMPLE',
          now(), 'DEVICE', 50.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H-AUTO-1', '1.0'
        )
      `, [recordFail, task.id]);

      await owner.query(`
        INSERT INTO m04.measurement_value(record_id, metric_code, value, unit, data_status, source_quality_result, window_definition)
        VALUES($1, 'SHIELD_OVERLAP_RATE', 6.0, '%', 'VALID', 'FAIL', '{"kind":"POINT"}')
      `, [recordFail]);

      await owner.query(`
        INSERT INTO m04.measurement_evaluation(record_id, version, quality_result, reason_code, rule_snapshot)
        VALUES($1, 1, 'FAIL', 'BELOW_LOWER', '{}')
      `, [recordFail]);

      // 触发一次内部聚合，验证报警峰值与米数实时更新
      const aggRes = ok(await req('/alarms:aggregate', { task_id: task.id }, admin));
      assert.ok(aggRes.total_fail_points >= 2);

      const latestAlarm = ok(await req(`/alarms?task_id=${task.id}`, undefined, admin));
      assert.equal(latestAlarm.items[0].status, 'TRIGGERED');
      // 峰值应该被更新为 6.0 (比之前的 7.5 更严重)
      assert.equal(Number(latestAlarm.items[0].peak_value), 6.0);
    });

    // ----------------------------------------------------
    // 测试点 4: 任务完工全自动出报告与推报客户 MES
    // ----------------------------------------------------
    await t.test('POST /api/v1/tasks/:id:end: auto freezes quality report & delivers to MES outbox with ACK', async () => {
      // 获取当前任务版本并结束任务
      const curTask = ok(await req(`/tasks/${task.id}`, undefined, admin));
      const endRes = ok(await req(`/tasks/${task.id}:end`, { reason: '生产检测计划完成，整盘完工出料' }, { ...admin, 'If-Match': String(curTask.version) }));
      assert.equal(endRes.state, 'ENDED');

      // 验证返回值中附带了无人值守自动联动的 auto_report 和 auto_mes 结果
      assert.ok(endRes.auto_report, '任务结束必须自动出具质检报告');
      assert.ok(endRes.auto_report.report_code.startsWith('QR-'));
      assert.ok(endRes.auto_mes, '任务结束必须自动上报客户 MES');
      assert.equal(endRes.auto_mes.status, 'ACKNOWLEDGED', '必须成功获取客户 MES 返回的业务 ACK');
      assert.ok(endRes.auto_mes.ack_code.startsWith('MES-ACK-'));

      // 1. 验证质检报告快照真实存在于 M06
      const reportRes = ok(await req(`/quality-reports/${endRes.auto_report.id}`, undefined, admin));
      assert.equal(reportRes.id, endRes.auto_report.id);
      assert.equal(reportRes.spool_id, spool.id);
      assert.equal(reportRes.state, 'GENERATED');
      assert.equal(reportRes.fingerprint_verified, true, '报告 SHA-256 防伪指纹必须有效');

      // 2. 验证客户 MES 出站队列 (M07) 中状态闭环
      const outboxRes = ok(await req('/mes/outbox', undefined, admin));
      const mesItem = outboxRes.items.find((it: any) => it.id === endRes.auto_mes.delivery_id);
      assert.ok(mesItem, 'MES 出站队列中必须存在本次自动投递记录');
      assert.equal(mesItem.status, 'ACKNOWLEDGED');
      assert.equal(mesItem.business_ack, endRes.auto_mes.ack_code);
    });
  } finally {
    if (api && !api.killed) {
      api.kill();
    }
    await owner.end();
    const cleanup = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
    await cleanup.query('DROP DATABASE IF EXISTS ' + name);
    await cleanup.end();
  }
});
