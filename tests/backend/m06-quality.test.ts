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

const name = 'hy_m06_test_' + Date.now();
const env = {
  ...process.env,
  ...local,
  DATABASE_URL: local.DATABASE_URL.replace('/huiyan_b1', '/' + name),
  MIGRATION_DATABASE_URL: local.MIGRATION_DATABASE_URL.replace('/huiyan_b1', '/' + name),
  PORT: '4219',
};

const evidence = resolve(root, '临时文件夹/M06_质量报告与追溯快照', name);
mkdirSync(evidence, { recursive: true });

let api: ChildProcess, logs = '';
const url = 'http://127.0.0.1:4219/api/v1';
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

test('M06 Quality report generation, tamper-proof snapshot, publishing and export', { timeout: 90000 }, async t => {
  const bootstrap = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
  await bootstrap.query('CREATE DATABASE ' + name);
  await bootstrap.end();

  // Run all migrations including 011_m06_quality_reports.sql and bootstrap seed
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

    await t.test('initial reports list is empty and permissions guard works', async () => {
      const list = ok(await req('/quality-reports', undefined, admin));
      assert.equal(list.items.length, 0);

      // 未登录拒绝
      assert.equal((await req('/quality-reports')).status, 401);
      // viewer 用户不能生成报告
      assert.equal((await req('/quality-reports/generate', { spool_id: 'test' }, viewer)).status, 403);
    });

    let spoolId = '';
    let workOrderId = '';
    let taskId1 = '';
    let taskId2 = '';

    await t.test('prepare spool, tasks and measurement data via platform API', async () => {
      // 1. 创建工单与线缆盘 (SP035-400 支持 dg 与 by)
      const woRes = ok(await req('/work-orders', { external_code: 'WO-REPORT-01', specification_id: 'SP035-400' }, admin));
      workOrderId = woRes.id;

      const spoolRes = ok(await req('/spools', { work_order_id: workOrderId, spool_code: 'SPOOL-REPORT-01' }, admin));
      spoolId = spoolRes.id;

      // 2. 创建关联检测任务 (Task 1: 搭盖率; Task 2: 不圆度)
      const t1Res = ok(await req('/tasks', {
        work_order_id: workOrderId,
        spool_id: spoolId,
        specification_id: 'SP035-400',
        process_id: 'process-dg',
        device_id: 'HY-DG-01',
        metric_code: 'SHIELD_OVERLAP_RATE',
        recipe_version_id: 'DG-V1.0',
        planned_length_m: '1000'
      }, admin));
      taskId1 = t1Res.id;

      const t2Res = ok(await req('/tasks', {
        work_order_id: workOrderId,
        spool_id: spoolId,
        specification_id: 'SP035-400',
        process_id: 'process-by',
        device_id: 'HY-BY-01',
        metric_code: 'OVALITY',
        recipe_version_id: 'BY-V1.0',
        planned_length_m: '1000'
      }, admin));
      taskId2 = t2Res.id;

      // 3. 模拟插入测点数据 (搭盖率 与 不圆度)
      const r1 = randomUUID(), r2 = randomUUID(), r3 = randomUUID(), r4 = randomUUID();

      await owner.query(`
        INSERT INTO m04.measurement_record(
          id, factory_id, device_id, source_record_key, capture_session_id, capture_sequence,
          task_id, sample_kind, sample_time, time_source, position_m, position_quality,
          source_type, data_environment, data_status, receipt_status, raw_payload, payload_hash, schema_version
        ) VALUES
        ($1, 'factory-local', 'HY-DG-01', 'RK1', 'S1', 1, $5, 'NEW_SAMPLE', now() - interval '5 minutes', 'DEVICE', 10.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H1', '1.0'),
        ($2, 'factory-local', 'HY-DG-01', 'RK2', 'S1', 2, $5, 'NEW_SAMPLE', now() - interval '4 minutes', 'DEVICE', 20.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H2', '1.0'),
        ($3, 'factory-local', 'HY-BY-01', 'RK3', 'S1', 3, $6, 'NEW_SAMPLE', now() - interval '3 minutes', 'DEVICE', 10.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H3', '1.0'),
        ($4, 'factory-local', 'HY-BY-01', 'RK4', 'S1', 4, $6, 'NEW_SAMPLE', now() - interval '2 minutes', 'DEVICE', 20.0, 'VERIFIED', 'DEVICE', 'SIMULATED', 'VALID', 'STORED', '{}', 'H4', '1.0')
      `, [r1, r2, r3, r4, taskId1, taskId2]);

      await owner.query(`
        INSERT INTO m04.measurement_value(record_id, metric_code, value, unit, data_status, source_quality_result, window_definition) VALUES
        ($1, 'SHIELD_OVERLAP_RATE', 22.500, '%', 'VALID', 'PASS', '{"kind":"POINT"}'),
        ($2, 'SHIELD_OVERLAP_RATE', 23.000, '%', 'VALID', 'PASS', '{"kind":"POINT"}'),
        ($3, 'OVALITY', 4.500, '%', 'VALID', 'PASS', '{"kind":"POINT"}'),
        ($4, 'OVALITY', 5.200, '%', 'VALID', 'PASS', '{"kind":"POINT"}')
      `, [r1, r2, r3, r4]);

      await owner.query(`
        INSERT INTO m04.measurement_evaluation(record_id, version, quality_result, rule_snapshot, evaluated_at) VALUES
        ($1, 1, 'PASS', '{}', now()),
        ($2, 1, 'PASS', '{}', now()),
        ($3, 1, 'PASS', '{}', now()),
        ($4, 1, 'PASS', '{}', now())
      `, [r1, r2, r3, r4]);
    });

    let generatedReportId = '';

    await t.test('POST /api/v1/quality-reports/generate by spool_id: verify overall verdict PASSED, std_dev, and SHA-256 fingerprint', async () => {
      const res = ok(await req('/quality-reports/generate', { spool_id: spoolId }, admin));
      assert.ok(res.id, 'Report ID must be generated');
      assert.ok(res.report_code.startsWith('QR-'), 'Report code must have QR- prefix');
      assert.equal(res.state, 'GENERATED');
      assert.equal(res.final_result, 'PASS');
      assert.equal(res.overall_verdict, 'PASSED', '整盘判定结论必须为 PASSED');
      assert.equal(res.snapshot_hash.length, 64, 'Snapshot hash must be 64-char sha256');
      assert.equal(res.fingerprint_verified, true, '防伪指纹必须校验通过');

      // 验证覆盖米数与统计
      const cov = res.coverage_snapshot;
      assert.equal(cov.start_position_m, '10.000');
      assert.equal(cov.end_position_m, '20.000');
      assert.equal(cov.total_covered_meters, '10.000');
      assert.equal(cov.total_records, 4);

      // 验证整盘判定统计量（最大值、最小值、均值、标准差、不合格区段总长）
      const stats = res.statistics;
      assert.ok(stats.SHIELD_OVERLAP_RATE);
      const dgStat = stats.SHIELD_OVERLAP_RATE;
      assert.equal(dgStat.total_samples, 2);
      assert.equal(dgStat.compliance_rate, 100);
      assert.equal(dgStat.min_value, '22.500');
      assert.equal(dgStat.max_value, '23.000');
      assert.equal(dgStat.avg_value, '22.750');
      assert.equal(dgStat.std_dev, '0.250', '标准差必须准确计算');
      assert.equal(dgStat.defective_meters, 0, '合格线缆不合格区段总长必须为 0');
      assert.equal(dgStat.verdict, 'PASS');

      assert.ok(stats.OVALITY);
      const byStat = stats.OVALITY;
      assert.equal(byStat.total_samples, 2);
      assert.equal(byStat.compliance_rate, 100);
      assert.equal(byStat.min_value, '4.500');
      assert.equal(byStat.max_value, '5.200');
      assert.equal(byStat.avg_value, '4.850');
      assert.equal(byStat.std_dev, '0.350', '不圆度标准差计算验证');
      assert.equal(byStat.defective_meters, 0);
      assert.equal(byStat.verdict, 'PASS');

      generatedReportId = res.id;
    });

    await t.test('POST /api/v1/quality-reports/generate by task_id: auto resolves spool and freezes snapshot', async () => {
      const taskReport = ok(await req('/quality-reports/generate', { task_id: taskId1 }, admin));
      assert.ok(taskReport.id);
      assert.equal(taskReport.spool_id, spoolId);
      assert.equal(taskReport.overall_verdict, 'PASSED');
      assert.equal(taskReport.snapshot_hash.length, 64);
    });

    await t.test('query report detail GET /api/v1/quality-reports/:id and verify immutability & views', async () => {
      const detail = ok(await req(`/quality-reports/${generatedReportId}`, undefined, admin));
      assert.equal(detail.id, generatedReportId);
      assert.equal(detail.spool_id, spoolId);
      assert.equal(detail.work_order_id, workOrderId);
      assert.equal(detail.state, 'GENERATED');
      assert.equal(detail.overall_verdict, 'PASSED');
      assert.equal(detail.verification_status, 'VERIFIED_IMMUTABLE');
      assert.equal(detail.fingerprint_verified, true);

      // 验证兼容视图 m06.quality_report_snapshot 与 m06.report_approval 可查
      const snapRes = await owner.query('SELECT * FROM m06.quality_report_snapshot WHERE id = $1', [generatedReportId]);
      assert.equal(snapRes.rowCount, 1, 'quality_report_snapshot 视图必须可查');

      const appRes = await owner.query('SELECT * FROM m06.report_approval WHERE id = $1', [generatedReportId]);
      assert.equal(appRes.rowCount, 1, 'report_approval 视图必须可查');
    });

    await t.test('publish report and verify published state and signer', async () => {
      const pub = ok(await req(`/quality-reports/${generatedReportId}/publish`, {}, admin));
      assert.equal(pub.id, generatedReportId);
      assert.equal(pub.state, 'PUBLISHED');
      assert.ok(pub.published_at);
      assert.equal(pub.published_by, 'U001');

      // 重复发布应报错 409
      const dup = await req(`/quality-reports/${generatedReportId}/publish`, {}, admin);
      assert.equal(dup.status, 409);
    });

    await t.test('export certificate and verify tamper-proof verification structure', async () => {
      const exp = ok(await req(`/quality-reports/${generatedReportId}/export`, undefined, admin));
      assert.ok(exp.certificate_title);
      assert.equal(exp.final_verdict, 'PASS');
      assert.equal(exp.overall_verdict, 'PASSED');
      assert.equal(exp.metrics_table.length, 2);
      assert.equal(exp.tamper_proof.verification_status, 'VERIFIED_IMMUTABLE');
      assert.equal(exp.tamper_proof.snapshot_hash.length, 64);
      assert.equal(exp.signatories.published_by, 'U001');
    });
  } finally {
    if (api) api.kill('SIGTERM');
    await owner.end();
    const cleanup = new Pool({ connectionString: local.MIGRATION_DATABASE_URL });
    await cleanup.query('DROP DATABASE IF EXISTS ' + name);
    await cleanup.end();
  }
});
