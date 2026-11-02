import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { AnalyticsLivePage } from '../live/AnalyticsLivePage';
import { ApiClient, emptyWorkspace, type Person, type Task } from '../live/api';

vi.mock('echarts',()=>({init:()=>({setOption:vi.fn(),resize:vi.fn(),dispose:vi.fn()})}));
vi.mock('../ui/download',()=>({csvCell:(v:unknown)=>String(v??''),downloadFile:vi.fn()}));
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

const user={id:'u1',permissions:['data:read']} as Person;
const response=(tasks:Task[])=>({items:tasks,total:tasks.length,as_of:'2026-10-30T01:00:00Z'});
async function click(text:string){const b=[...container.querySelectorAll('button')].find(b=>b.textContent===text)!;await act(async()=>b.click());}
async function setup(tasks:Task[]){const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue(response(tasks));await render(<AnalyticsLivePage api={api} data={emptyWorkspace} user={user}/>);return api;}

test('loads real summaries, separates pending judgments and preserves counts in charts',async()=>{
  const pending={...mockTask,id:'pending',task_code:'PENDING',measurements:{...mockTask.measurements!,total:200,valid:200,passed:0,failed:0,unevaluated:200}};
  const api=await setup([mockTask,pending]);
  expect(api.request).toHaveBeenCalledWith('/production/tasks?page=1&limit=100',undefined,{},expect.any(AbortSignal));
  expect(container.textContent).toContain('99.0 %');
  expect(container.textContent).toContain('未判定记录');
  expect(container.querySelector('[aria-label="检测结果分布：符合980、超限10、未判定200条"]')).toBeTruthy();
  expect(container.textContent).not.toContain('符合标准');
  expect(container.textContent).not.toContain('受控基准');
  expect(container.querySelectorAll('.metric-mini-bar')).toHaveLength(0);
});

test('metric filter changes chart scope and rows; CSV uses the same filtered detail',async()=>{
  const gap={...mockTask,id:'gap',task_code:'GAP-02',metric_code:'WIRE_GAP'};
  await setup([mockTask,gap]);
  const select=container.querySelector<HTMLSelectElement>('.analytics-filter-grid select')!;
  await act(async()=>{select.value='WIRE_GAP';select.dispatchEvent(new Event('change',{bubbles:true}));});
  expect(container.querySelector('tbody')?.textContent).toContain('GAP-02');
  expect(container.querySelector('tbody')?.textContent).not.toContain(mockTask.task_code);
  expect(container.querySelectorAll('.ana-metric')).toHaveLength(1);
  await click('导出统计 CSV');
  const {downloadFile}=await import('../ui/download');
  const csv=String(vi.mocked(downloadFile).mock.calls[0][1]);
  expect(csv).toContain('GAP-02');expect(csv).not.toContain(mockTask.task_code);
  await click('重置');expect(container.querySelectorAll('.ana-metric')).toHaveLength(3);
});

test('pending-only tasks are selectable and have no invented passing percentage',async()=>{
  const t={...mockTask,measurements:{...mockTask.measurements!,passed:0,failed:0,unevaluated:1000}};
  await setup([t]);
  await click('含超限');expect(container.textContent).toContain('当前筛选范围没有任务');
  await click('含未判定');expect(container.querySelector('tbody')?.textContent).toContain(t.task_code);
  expect(container.querySelectorAll('.ana-kpi')[1].textContent).toContain('—');
});

test('initial failures never become zero statistics; retry works; refresh failure marks stale data',async()=>{
  const api=new ApiClient(),request=vi.spyOn(api,'request').mockRejectedValue(new Error('连接中断'));
  await render(<AnalyticsLivePage api={api} data={emptyWorkspace} user={user}/>);
  expect(container.textContent).toContain('未生成统计结果');expect(container.querySelector('.ana-kpis')).toBeNull();
  request.mockResolvedValue(response([mockTask]));await click('重新读取');
  expect(container.querySelector('tbody')?.textContent).toContain(mockTask.task_code);
  request.mockRejectedValue(new Error('查询失败'));await click('刷新统计');
  expect(container.textContent).toContain('当前保留上次成功结果');
  expect(container.querySelector('tbody')?.textContent).toContain(mockTask.task_code);
  expect([...container.querySelectorAll('button')].find(b=>b.textContent==='导出统计 CSV')?.disabled).toBe(true);
});

test('empty successful response shows empty charts instead of decorative data',async()=>{
  await setup([]);expect(container.textContent).toContain('当前范围暂无检测记录');expect(container.textContent).toContain('当前检测项目暂无可用均值');
});
