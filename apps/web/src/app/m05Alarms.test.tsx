import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AnomalyRecords } from '../live/AnomalyRecords';
import { ApiClient, emptyWorkspace } from '../live/api';
import type { AlarmDetail, AlarmItem, AlarmListResponse } from '../live/alarmTypes';

let root: Root, container: HTMLDivElement;

const sampleAlarm: AlarmItem = {
  id: 'ALR-TEST-001',
  factory_id: 'factory-local',
  device_id: 'HY-DG-01',
  task_id: 'task-1001',
  spool_id: 'spool-2001',
  work_order_id: 'wo-3001',
  source_alarm_key: 'ALARM:HY-DG-01:task-1001:SHIELD_OVERLAP_RATE',
  alarm_type: 'QUALITY',
  metric_code: 'SHIELD_OVERLAP_RATE',
  severity: 'CRITICAL',
  lifecycle: 'ACTIVE',
  handling_state: 'PENDING',
  sample_count: 4,
  start_position_m: '2.0000000000',
  end_position_m: '3.5000000000',
  peak_value: '5.0000000000',
  unit: '%',
  acknowledged_at: null,
  acknowledged_by: null,
  triggered_at: '2026-10-28T02:00:00.000Z',
  recovered_at: null,
  version: 1,
  created_at: '2026-10-28T02:00:01.000Z'
};

const sampleDetail: AlarmDetail = {
  ...sampleAlarm,
  actions: [
    {
      id: 'act-1',
      action: 'TRIGGER',
      actor_id: 'SYSTEM',
      actor_name: '质量检测引擎',
      from_state: 'PENDING',
      to_state: 'PENDING',
      opinion: '连续4个测点超限，触发搭盖率报警',
      evidence_refs: null,
      occurred_at: '2026-10-28T02:00:00.000Z'
    }
  ]
};

function setup(query = '') {
  const api = new ApiClient();
  const data = {
    ...emptyWorkspace,
    catalog: {
      ...emptyWorkspace.catalog,
      device: [
        { id: 'HY-DG-01', name: '搭盖率检测仪', model: 'M1', metric_code: 'SHIELD_OVERLAP_RATE', process_id: 'P1', line_id: 'L1', enabled: true, data_environment: 'SIMULATED' }
      ]
    },
    tasks: [
      {
        id: 'task-1001',
        task_code: '20261028-TASK-01',
        spool_id: 'spool-2001',
        work_order_id: 'wo-3001',
        device_id: 'HY-DG-01',
        metric_code: 'SHIELD_OVERLAP_RATE',
        process_id: 'P1',
        specification_id: 'S1',
        planned_length_m: '20',
        data_environment: 'SIMULATED',
        state: 'RUNNING',
        version: 1,
        rule_snapshot: {} as any,
        context_snapshot: { spool_code: '盘-001', external_code: 'WO-001' } as any,
        created_at: '2026-10-28T02:00:00.000Z'
      } as any
    ],
    spools: [{ id: 'spool-2001', spool_code: '盘-001', work_order_id: 'wo-3001', created_at: '' }],
    orders: [{ id: 'wo-3001', external_code: 'WO-001', specification_id: 'S1', created_at: '' }]
  };

  return { api, data, params: new URLSearchParams(query) };
}

async function renderComponent(p: ReturnType<typeof setup>, alarmList = [sampleAlarm]) {
  const spy = vi.spyOn(p.api, 'request').mockImplementation(async (path: string) => {
    if (path.startsWith('/alarms?')) {
      return { items: alarmList, has_more: false, next_cursor: null } as AlarmListResponse;
    }
    if (path === '/alarms/ALR-TEST-001') {
      return sampleDetail;
    }
    if (path === '/alarms:aggregate') {
      return { total_fail_points: 4, created_alarms: 1, updated_alarms: 0 };
    }
    if (path.startsWith('/alarms/ALR-TEST-001:')) {
      return { id: 'ALR-TEST-001', handling_state: 'HANDLED' };
    }
    if (path === '/measurements?quality=FAIL' || path.startsWith('/measurements?')) {
      return { items: [], total: 0, has_more: false, next_cursor: null };
    }
    return {} as any;
  });

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<AnomalyRecords {...p} />));
  return spy;
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
});

test('WP4.2: renders M05 workbench tabs, KPIs and alarm item with defect meters', async () => {
  const p = setup();
  await renderComponent(p);

  // 1. 验证 Tabs 切换入口
  expect(container.textContent).toContain('工业级报警事件（M05 聚类工作台');
  expect(container.textContent).toContain('原始超限测点明细（FAIL 采样点记录');

  // 2. 验证 KPI 卡片
  expect(container.textContent).toContain('待确认响应 (PENDING)');
  expect(container.textContent).toContain('正在排查处置 (PROCESSING)');
  expect(container.textContent).toContain('待主管复核 (HANDLED)');
  expect(container.textContent).toContain('已复核结案 (REVIEWED)');

  // 3. 验证报警表格中的关键字段（编号、缺陷区段米数、采样点数、峰值）
  expect(container.textContent).toContain('ALR-TEST-001');
  expect(container.textContent).toContain('2.00m ~ 3.50m');
  expect(container.textContent).toContain('共包含 4 个超限测点');
  expect(container.textContent).toContain('5.0000 %');
});

test('WP4.2: operator can acknowledge alarm via one-click Ack', async () => {
  const p = setup();
  const reqSpy = await renderComponent(p);

  const ackBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('一键确认'));
  expect(ackBtn).toBeDefined();

  await act(async () => ackBtn!.click());
  expect(reqSpy).toHaveBeenCalledWith('/alarms/ALR-TEST-001:ack', {});
});

test('WP4.2: operator can open handle modal and submit opinion', async () => {
  const p = setup();
  const processingAlarm = { ...sampleAlarm, handling_state: 'PROCESSING' as const };
  const reqSpy = await renderComponent(p, [processingAlarm]);

  const handleBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('登记处置'));
  expect(handleBtn).toBeDefined();

  await act(async () => handleBtn!.click());

  // 验证弹窗打开
  const modal = document.querySelector('.modal');
  expect(modal).not.toBeNull();
  expect(modal!.textContent).toContain('登记报警处置意见');

  // 输入意见并提交
  const textarea = modal!.querySelector<HTMLTextAreaElement>('textarea[name=opinion]')!;
  textarea.value = '已调节冷却水温并切除缺陷段';
  const planArea = modal!.querySelector<HTMLTextAreaElement>('textarea[name=action_plan]')!;
  planArea.value = '切除报废2~3.5m';

  await act(async () => {
    modal!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(reqSpy).toHaveBeenCalledWith('/alarms/ALR-TEST-001:handle', expect.objectContaining({
    opinion: '已调节冷却水温并切除缺陷段',
    action_plan: '切除报废2~3.5m'
  }));
});

test('WP4.2: reviewer can open review modal and approve closing', async () => {
  const p = setup();
  const handledAlarm = { ...sampleAlarm, handling_state: 'HANDLED' as const };
  const reqSpy = await renderComponent(p, [handledAlarm]);

  const reviewBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('主管复核'));
  expect(reviewBtn).toBeDefined();

  await act(async () => reviewBtn!.click());

  const modal = document.querySelector('.modal');
  expect(modal).not.toBeNull();
  expect(modal!.textContent).toContain('质检主管复核审批');

  const textarea = modal!.querySelector<HTMLTextAreaElement>('textarea[name=opinion]')!;
  textarea.value = '复查合格，缺陷段已报废，准予结案';

  await act(async () => {
    modal!.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  expect(reqSpy).toHaveBeenCalledWith('/alarms/ALR-TEST-001:review', expect.objectContaining({
    approved: true,
    opinion: '复查合格，缺陷段已报废，准予结案'
  }));
});

test('WP4.2: clicking detail opens drawer with audit timeline', async () => {
  const p = setup();
  await renderComponent(p);

  const detailBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('轨迹详情'));
  expect(detailBtn).toBeDefined();

  await act(async () => detailBtn!.click());

  const drawer = document.querySelector('.drawer');
  expect(drawer).not.toBeNull();
  expect(drawer!.textContent).toContain('报警处置生命周期轨迹');
  expect(drawer!.textContent).toContain('质量检测引擎');
  expect(drawer!.textContent).toContain('连续4个测点超限，触发搭盖率报警');
});

test('WP4.2: user can switch to Tab 2 for raw measurement records', async () => {
  const p = setup();
  await renderComponent(p);

  const tab2Btn = Array.from(container.querySelectorAll<HTMLButtonElement>('.alarms-workbench-tabs button'))[1];
  await act(async () => tab2Btn.click());

  expect(container.textContent).toContain('筛选范围超限记录');
  expect(container.textContent).toContain('模拟来源（当前页）');
});
