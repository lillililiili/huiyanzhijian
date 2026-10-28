import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReportsLivePage, ReportLiveView } from '../live/ReportsLivePage';
import { emptyWorkspace, type Person, type Task } from '../live/api';

let root: Root, container: HTMLDivElement;

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
});

const mockTask: Task = {
  id: 'task-01',
  task_code: 'TASK-20261028-01',
  spool_id: 'spool-01',
  work_order_id: 'wo-01',
  specification_id: 'spec-01',
  process_id: 'proc-01',
  device_id: 'dev-01',
  metric_code: 'SHIELD_OVERLAP_RATE',
  recipe_version_id: 'rec-01',
  state: 'ENDED',
  version: '1',
  planned_length_m: '2500',
  data_environment: 'REAL',
  created_at: '2026-10-28 08:00:00',
  started_at: '2026-10-28 08:10:00',
  ended_at: '2026-10-28 10:00:00',
  rule_snapshot: {
    approval_state: 'APPROVED',
    method_id: 'm1',
    method_version: '1',
    comparison: { operator: 'GE', lower: '15', upper: null }
  },
  context_snapshot: {
    spool_code: 'P2026102801',
    external_code: 'WO2026102801',
    specification: {
      id: 'spec-01',
      name: '高压电缆 110kV',
      voltage_kv: '110',
      conductor_area_mm2: '800',
      core_count: 1,
      shield_structure: 'tape',
      enabled: true
    },
    device: {
      id: 'dev-01',
      name: '搭盖率检测仪',
      model: 'AR-01',
      metric_code: 'SHIELD_OVERLAP_RATE',
      process_id: 'proc-01',
      line_id: 'line-01',
      enabled: true,
      data_environment: 'REAL'
    }
  },
  measurements: {
    task_id: 'task-01',
    total: 1000,
    valid: 990,
    invalid: 10,
    passed: 990,
    failed: 0,
    unevaluated: 0,
    quarantined: 0,
    first_sample_at: '2026-10-28 08:15:00',
    latest_sample_at: '2026-10-28 09:55:00',
    minimum: '16.2',
    maximum: '19.8',
    mean: '17.8',
    unit: '%'
  }
};

const user: Person = {
  id: 'u1',
  username: 'quality_admin',
  name: '质量工程师',
  factory_id: 'f1',
  permissions: ['data:read', 'quality:write']
};

test('reports list page renders seeded reports and KPIs', async () => {
  const data = structuredClone(emptyWorkspace);
  data.tasks = [mockTask];

  await render(
    <ReportsLivePage
      data={data}
      user={user}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  expect(container.textContent).toContain('质量报告管理');
  expect(container.textContent).toContain('RP-20261028-001');
  expect(container.textContent).toContain('出厂最终检验报告');
  expect(container.textContent).toContain('TASK-20261028-01');
});

test('opening create modal and generating report appends to report list', async () => {
  const data = structuredClone(emptyWorkspace);
  data.tasks = [mockTask];

  await render(
    <ReportsLivePage
      data={data}
      user={user}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  const createBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.includes('出具质量检验报告')
  )!;
  await act(async () => createBtn.click());

  expect(document.body.textContent).toContain('出厂最终质量检验报告');

  const submitBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent === '确认生成并归档'
  )!;
  await act(async () => submitBtn.click());

  expect(container.textContent).toContain('已归档质量报告');
  expect(container.querySelectorAll('tbody tr').length).toBeGreaterThanOrEqual(1);
});

test('report detail preview renders paper layout, header, and metadata', async () => {
  const data = structuredClone(emptyWorkspace);
  data.tasks = [mockTask];

  await render(
    <ReportLiveView
      data={data}
      user={user}
      params={new URLSearchParams('id=RP-20261028-001')}
      refresh={vi.fn(async () => {})}
    />
  );

  expect(container.textContent).toContain('报告预览与导出');
  expect(container.textContent).toContain('RP-20261028-001');
  expect(container.textContent).toContain('高压电缆出厂质量检测报告');
  expect(container.textContent).toContain('山东宏亮电缆有限公司');
  expect(container.textContent).toContain('打印 / 保存 PDF');
});
