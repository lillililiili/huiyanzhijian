import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AnalyticsLivePage } from '../live/AnalyticsLivePage';
import { emptyWorkspace, type Person, type Task } from '../live/api';

let root: Root, container: HTMLDivElement;

async function render(node: ReactNode) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(node));
}

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
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
    passed: 980,
    failed: 10,
    unevaluated: 0,
    quarantined: 0,
    first_sample_at: '2026-10-28 08:15:00',
    latest_sample_at: '2026-10-28 09:55:00',
    minimum: '14.2',
    maximum: '19.8',
    mean: '17.6',
    unit: '%'
  }
};

test('renders analytics KPIs, metric cards, and tasks list', async () => {
  const data = structuredClone(emptyWorkspace);
  data.tasks = [mockTask];
  const user: Person = {
    id: 'u1',
    username: 'admin',
    name: '质量工程师',
    factory_id: 'f1',
    permissions: ['data:read', 'quality:write']
  };

  await render(<AnalyticsLivePage data={data} user={user} refresh={vi.fn(async () => {})} />);

  expect(container.textContent).toContain('质量统计分析');
  expect(container.textContent).toContain('TASK-20261028-01');
  expect(container.textContent).toContain('金属屏蔽搭盖率检测统计');
  expect(container.textContent).toContain('99.0 %'); // (980 / 990) -> 99.0%
  expect(container.textContent).toContain('10 超限');
});

test('filtering by metric alters visible cards and task list', async () => {
  const data = structuredClone(emptyWorkspace);
  const gapTask: Task = {
    ...mockTask,
    id: 'task-02',
    task_code: 'TASK-20261028-02',
    metric_code: 'WIRE_GAP'
  };
  data.tasks = [mockTask, gapTask];
  const user: Person = {
    id: 'u1',
    username: 'admin',
    name: '质量工程师',
    factory_id: 'f1',
    permissions: ['data:read']
  };

  await render(<AnalyticsLivePage data={data} user={user} refresh={vi.fn(async () => {})} />);

  const metricSelect = container.querySelector<HTMLSelectElement>('.analytics-filter-grid select')!;
  await act(async () => {
    metricSelect.value = 'WIRE_GAP';
    metricSelect.dispatchEvent(new Event('change', { bubbles: true }));
  });

  expect(container.textContent).toContain('铜丝屏蔽相邻间隙统计');
  expect(container.textContent).not.toContain('金属屏蔽搭盖率检测统计');
  expect(container.textContent).toContain('TASK-20261028-02');
  expect(container.textContent).not.toContain('TASK-20261028-01');
});
