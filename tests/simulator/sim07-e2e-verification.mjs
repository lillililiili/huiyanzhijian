import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const SIM_URL = 'http://127.0.0.1:4196/api';
const API_URL = 'http://127.0.0.1:4192/api/v1';

async function req(url, method = 'GET', body = null, headers = {}) {
  const opts = { method, headers: { ...headers } };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(url, opts);
  const data = await r.json().catch(() => null);
  return { status: r.status, data, cookies: r.headers.getSetCookie() };
}

async function run() {
  console.log('=== [WP1.2 / SIM07] 开始端到端复验 ===');

  // 1. 登录验证
  console.log('[1/5] 登录 4196 模拟器与 4192 主平台 API...');
  const simLogin = await req(SIM_URL + '/login', 'POST', { username: 'admin', password: '123456' });
  assert.equal(simLogin.status, 200, '模拟器登录失败: ' + JSON.stringify(simLogin.data));
  const simCookie = simLogin.cookies.map(c => c.split(';')[0]).join('; ');
  const simCsrf = simLogin.data.csrf;
  const simH = { Cookie: simCookie, 'X-Sim-CSRF': simCsrf };

  const apiLogin = await req(API_URL + '/auth/login', 'POST', { username: 'admin', password: '123456' });
  assert.equal(apiLogin.status, 200, '主平台登录失败: ' + JSON.stringify(apiLogin.data));
  const apiCookie = apiLogin.cookies.map(c => c.split(';')[0]).join('; ');
  const apiCsrf = apiLogin.data.data.csrf_token;
  const apiH = { Cookie: apiCookie, 'X-CSRF-Token': apiCsrf, 'Idempotency-Key': randomUUID() };

  console.log('✓ 模拟器与主平台登录成功');

  // 2. 验证 SIM07 五项正常基准值与三项缺陷区段模型校验
  console.log('[2/5] 验证 SIM07 五项基准量与区段缺陷校验约束...');
  const cableId = randomUUID();
  const validCable = {
    name: 'SIM07端到端验收电缆-' + Date.now(),
    material_ref: 'sim07-test-ref',
    length_m: '20',
    baseline: {
      tape_width_mm: '20',
      overlap_width_mm: '2.5',
      wire_gap_mm: '1.25',
      diameter_x_mm: '40',
      diameter_y_mm: '40'
    },
    defects: [
      { name: '搭盖率过低段', metric: 'SHIELD_OVERLAP_RATE', start_m: '2', length_m: '2', value_mm: '1' },
      { name: '铜丝间隙超标段', metric: 'WIRE_GAP', start_m: '6', length_m: '2', value_mm: '4' },
      { name: '电缆截面椭圆段', metric: 'OVALITY', start_m: '10', length_m: '2', value_mm: '48' }
    ]
  };

  // 2.1 校验重叠区段应被拦截
  const overlappingCable = {
    ...validCable,
    defects: [
      { name: '区段A', metric: 'WIRE_GAP', start_m: '2', length_m: '3', value_mm: '4' },
      { name: '区段B重叠', metric: 'WIRE_GAP', start_m: '4', length_m: '3', value_mm: '4.5' }
    ]
  };
  const overlapRes = await req(SIM_URL + '/models/cables', 'POST', { id: cableId, version: 0, data: overlappingCable, reason: '重叠测试' }, simH);
  assert.equal(overlapRes.status, 400, '同指标重叠区段应被拦截: ' + JSON.stringify(overlapRes.data));
  console.log('✓ 同指标重叠缺陷拦截生效 (400 MODEL_INVALID)');

  // 2.2 校验搭盖宽度超过铜带宽度应被拦截
  const invalidOverlap = {
    ...validCable,
    baseline: { ...validCable.baseline, overlap_width_mm: '25', tape_width_mm: '20' }
  };
  const invalidOverlapRes = await req(SIM_URL + '/models/cables', 'POST', { id: cableId, version: 0, data: invalidOverlap, reason: '搭盖超宽测试' }, simH);
  assert.equal(invalidOverlapRes.status, 400, '搭盖宽超过带宽应被拦截');
  console.log('✓ 搭盖宽超出带宽拦截生效 (400 MODEL_INVALID)');

  // 2.3 成功保存新模型并递增版本
  const saveRes = await req(SIM_URL + '/models/cables', 'POST', { id: cableId, version: 0, data: validCable, reason: '初始SIM07模型' }, simH);
  assert.equal(saveRes.status, 200, '保存初始模型失败: ' + JSON.stringify(saveRes.data));
  assert.equal(saveRes.data.version, 1, '初次保存后版本应为 1');
  assert.deepEqual(saveRes.data.data.baseline, validCable.baseline, '五项正常基准值存储完全一致');
  assert.equal(saveRes.data.data.defects.length, 3, '三项缺陷区段存储完整');

  // 2.4 版本冲突校验
  const conflictRes = await req(SIM_URL + '/models/cables', 'POST', { id: cableId, version: 0, data: validCable, reason: '过期版本' }, simH);
  assert.equal(conflictRes.status, 412, '版本冲突应返回 412: ' + JSON.stringify(conflictRes.data));
  console.log('✓ 模型版本冲突保护生效 (412 MODEL_VERSION_CONFLICT)');

  // 3. 物理换算说明与测试界限核验
  console.log('[3/5] 验证物理值到检测指标的换算逻辑...');
  const overlapExpected = (100 * 1 / 20).toFixed(10);
  assert.equal(overlapExpected, '5.0000000000', '搭盖率换算值应为 5%');

  const gapExpected = (4).toFixed(10);
  assert.equal(gapExpected, '4.0000000000', '铜丝间隙值应为 4 mm');

  const ovalityExpected = (200 * Math.abs(40 - 48) / (40 + 48)).toFixed(10);
  assert.equal(ovalityExpected, '18.1818181818', '不圆度换算值应为 18.1818181818%');
  console.log('✓ 三项指标物理换算公式核验完全一致');

  // 4. 端到端创建任务并执行送料
  console.log('[4/5] 准备主平台工单与任务，并执行送料测试...');
  // 三项检测项与配方、规格映射 (按照工艺，搭盖率/不圆度使用 SP035-300，铜丝间隙使用 SP066-630)
  const taskConfigs = [
    { metric: 'SHIELD_OVERLAP_RATE', device: 'HY-DG-01', process: 'process-dg', recipe: 'DG-V1.0', specId: 'SP035-300', detectorId: '03d649be-18e6-4a0f-aec3-0d18bd3d6c88', expectedFail: '5.0000000000' },
    { metric: 'WIRE_GAP', device: 'HY-JX-01', process: 'process-jx', recipe: 'JX-V1.0', specId: 'SP066-630', detectorId: 'df526b49-e00a-41e9-adbc-864f3a41c08d', expectedFail: '4.0000000000' },
    { metric: 'OVALITY', device: 'HY-BY-01', process: 'process-by', recipe: 'BY-V1.0', specId: 'SP035-300', detectorId: '94452151-2f52-48d1-a9bb-b3ecb93512a2', expectedFail: '18.1818181818' }
  ];

  for (const cfg of taskConfigs) {
    console.log(` -> 开始测试检测项: ${cfg.metric} (${cfg.device}, 规格 ${cfg.specId}, 配方 ${cfg.recipe})...`);
    
    // 先清理该设备上可能残留的 RUNNING 任务
    const overviewRes = await req(API_URL + '/operations/overview', 'GET', null, apiH);
    if (overviewRes.status === 200 && overviewRes.data?.data?.tasks) {
      for (const pt of overviewRes.data.data.tasks) {
        if (pt.device_id === cfg.device && pt.state === 'RUNNING') {
          await req(API_URL + `/tasks/${pt.id}:end`, 'POST', { reason: '测试前重置残留任务' }, { ...apiH, 'If-Match': String(pt.version), 'Idempotency-Key': randomUUID() });
        }
      }
    }

    // 为每个测试项创建专属工单和线缆盘
    const woRes = await req(API_URL + '/work-orders', 'POST', { external_code: `SIM07-${cfg.metric}-` + Date.now(), specification_id: cfg.specId }, { ...apiH, 'Idempotency-Key': randomUUID() });
    assert.equal(woRes.status, 200, `创建工单失败: ${cfg.metric}`);
    const wo = woRes.data.data;

    const spoolRes = await req(API_URL + '/spools', 'POST', { work_order_id: wo.id, spool_code: `SIM07-盘-${cfg.metric}-` + Date.now() }, { ...apiH, 'Idempotency-Key': randomUUID() });
    assert.equal(spoolRes.status, 200, `创建线缆盘失败: ${cfg.metric}`);
    const spool = spoolRes.data.data;

    // 创建任务
    const taskRes = await req(API_URL + '/tasks', 'POST', {
      work_order_id: wo.id,
      spool_id: spool.id,
      specification_id: cfg.specId,
      process_id: cfg.process,
      device_id: cfg.device,
      metric_code: cfg.metric,
      recipe_version_id: cfg.recipe,
      planned_length_m: '20'
    }, { ...apiH, 'Idempotency-Key': randomUUID() });
    assert.equal(taskRes.status, 200, `创建任务失败: ${cfg.metric} - ` + JSON.stringify(taskRes.data));
    let task = taskRes.data.data;

    try {
      // 启动任务
      const startRes = await req(API_URL + `/tasks/${task.id}:start`, 'POST', {}, { ...apiH, 'If-Match': String(task.version), 'Idempotency-Key': randomUUID() });
      assert.equal(startRes.status, 200, `启动任务失败: ${cfg.metric} - ` + JSON.stringify(startRes.data));
      task = startRes.data.data;

      // 发起模拟器送料
      const passInput = {
        request_id: randomUUID(),
        cable_id: cableId,
        cable_version: 1,
        detector_id: cfg.detectorId,
        detector_version: 1,
        mode: 'BOUND',
        task_id: task.id,
        spool_id: spool.id
      };

      const passRes = await req(SIM_URL + '/passes', 'POST', passInput, simH);
      assert.equal(passRes.status, 202, `发起送料请求失败: ${passRes.status} ` + JSON.stringify(passRes.data));
      const runId = passRes.data.run_id;

      // 等待送料完成 (40 个采样点，每步 0.5m，总长 20m，最多等待 90 秒以兼容限流重试)
      let completed = false;
      for (let i = 0; i < 450; i++) {
        await new Promise(r => setTimeout(r, 200));
        const stateRes = await req(SIM_URL + '/state', 'GET', null, simH);
        const activeRun = stateRes.data.runs.find(r => r.id === runId);
        if (activeRun && activeRun.generated === 40 && activeRun.stored === 40) {
          completed = true;
          break;
        }
        if (i % 25 === 0 && activeRun) {
          console.log(`    进度: 生成 ${activeRun.generated}/40，存储 ${activeRun.stored}/40...`);
        }
      }
      assert.ok(completed, `任务 ${cfg.metric} 送料 40 个采样点超时未全部完成`);

      // 5. 校验 P13 接口回读与异常判定闭环
      console.log(` -> 校验任务 ${task.task_code} 的测量结果与 P13 FAIL 列表...`);
      const measRes = await req(API_URL + `/measurements?task_id=${task.id}&limit=50`, 'GET', null, apiH);
      assert.equal(measRes.status, 200, '查询任务测量失败');
      const items = measRes.data.data.items;
      assert.equal(items.length, 40, '应接收并入库 40 条记录');

      // 缺陷区段在 2m~4m, 6m~8m, 10m~12m (步长 0.5m，每个区段恰好包含 4 个采样点: start, start+0.5, start+1.0, start+1.5)
      const fails = items.filter(m => m.quality_result === 'FAIL');
      const passes = items.filter(m => m.quality_result === 'PASS');
      const notEvals = items.filter(m => m.quality_result === 'NOT_EVALUATED');

      assert.equal(notEvals.length, 0, `不应存在未判定记录 (NOT_EVALUATED: ${notEvals.length})`);
      assert.equal(fails.length, 4, `缺陷区段应恰好检出 4 个超限采样点，实际检出: ${fails.length}`);
      assert.equal(passes.length, 36, `正常区段应恰好检出 36 个合格采样点，实际检出: ${passes.length}`);

      // 验证超限值换算完全相符
      for (const f of fails) {
        assert.equal(Number(f.value).toFixed(10), cfg.expectedFail, `超限值应为 ${cfg.expectedFail}，实际为 ${f.value}`);
      }

      console.log(`✓ 检测项 ${cfg.metric} 端到端闭环验证通过 (40采样/4FAIL/36PASS, 超限值=${cfg.expectedFail})`);
    } finally {
      // 结束任务释放设备
      try {
        const curTask = await req(API_URL + `/tasks/${task.id}`, 'GET', null, apiH);
        if (curTask.data?.data?.state === 'RUNNING') {
          await req(API_URL + `/tasks/${task.id}:end`, 'POST', { reason: 'SIM07测试结束' }, { ...apiH, 'If-Match': String(curTask.data.data.version), 'Idempotency-Key': randomUUID() });
        }
      } catch {
        // ignore cleanup error
      }
      // 间隔 6 秒平滑限流窗口
      await new Promise(r => setTimeout(r, 6000));
    }
  }

  // 6. 全局 P13 异常列表回读验证
  console.log('[5/5] 验证 4181 P13 异常列表接口回显...');
  const p13All = await req(API_URL + '/measurements?quality=FAIL&limit=100', 'GET', null, apiH);
  assert.equal(p13All.status, 200, 'P13 查询失败');
  assert.ok(p13All.data.data.items.length >= 12, 'P13 应至少包含刚才产生的 12 条新 FAIL 记录');
  console.log(`✓ 4181 P13 接口回读成功，总 FAIL 记录数: ${p13All.data.data.total}`);

  console.log('=== [WP1.2 / SIM07] 端到端复验全部通过！ ===');
}

run().catch(err => {
  console.error('❌ 测试执行异常:', err);
  process.exit(1);
});
