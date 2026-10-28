import { createRoot, type Root } from 'react-dom/client';
import { act, type ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReportsLivePage, ReportLiveView } from '../live/ReportsLivePage';
import { ApiClient, emptyWorkspace, type Person, type Workspace } from '../live/api';
import type { QualityReportItem, QualityCertificateExport, ReportListResponse } from '../live/reportTypes';

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

const mockReport: QualityReportItem = {
  id: 'rep-001',
  factory_id: 'factory-local',
  report_code: 'QR-TEST-001',
  revision: 1,
  report_kind: 'SPOOL_SUMMARY',
  data_environment: 'REAL',
  spool_id: 'spool-001',
  work_order_id: 'wo-001',
  task_ids: ['task-001', 'task-002'],
  state: 'GENERATED',
  final_result: 'PASS',
  snapshot_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
  coverage_snapshot: {
    start_position_m: '0.000',
    end_position_m: '2000.000',
    total_covered_meters: '2000.000',
    total_records: 800,
    quarantined_records: 0,
    valid_records: 800,
    coverage_completeness: 'COMPLETE'
  },
  statistics: {
    SHIELD_OVERLAP_RATE: {
      metric_code: 'SHIELD_OVERLAP_RATE',
      unit: '%',
      total_samples: 400,
      valid_samples: 400,
      passed_samples: 400,
      failed_samples: 0,
      min_value: '16.5',
      max_value: '19.8',
      avg_value: '18.2',
      compliance_rate: 100,
      verdict: 'PASS'
    },
    WIRE_GAP: {
      metric_code: 'WIRE_GAP',
      unit: 'mm',
      total_samples: 400,
      valid_samples: 400,
      passed_samples: 400,
      failed_samples: 0,
      min_value: '1.20',
      max_value: '2.40',
      avg_value: '1.80',
      compliance_rate: 100,
      verdict: 'PASS'
    }
  },
  query_cutoff: '2026-10-28T08:00:00Z',
  generated_by: '质量工程师',
  published_by: null,
  published_at: null,
  created_at: '2026-10-28 08:30:00'
};

const mockCertificate: QualityCertificateExport = {
  certificate_title: '高压电缆出厂质量检测报告',
  report_code: 'QR-TEST-001',
  revision: 1,
  spool_id: 'spool-001',
  work_order_id: 'wo-001',
  task_ids: ['task-001'],
  final_verdict: 'PASS',
  inspection_summary: {
    coverage_meters: '2000.000',
    meter_range: '0.000m ~ 2000.000m',
    total_records: 800,
    valid_records: 800
  },
  metrics_table: [
    {
      metric_name: '金属屏蔽搭盖率',
      metric_code: 'SHIELD_OVERLAP_RATE',
      unit: '%',
      min: '16.5',
      max: '19.8',
      avg: '18.2',
      compliance_rate: '100%',
      status: 'PASS'
    }
  ],
  signatories: {
    label: '质检员 / 质量主管',
    generated_by: '质量工程师',
    published_by: '质检总监',
    published_at: '2026-10-28T09:00:00Z'
  },
  tamper_proof: {
    algorithm: 'SHA-256',
    snapshot_hash: '9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b',
    verification_status: 'VERIFIED_IMMUTABLE'
  },
  footer: '慧眼智检数字化质量追溯系统'
};

const mockUser: Person = {
  id: 'u-admin',
  username: 'admin',
  name: '质量主管',
  factory_id: 'factory-local',
  permissions: ['data:read', 'task:write', 'reports:read', 'reports:write']
};

function setupWorkspace(): Workspace {
  const ws = structuredClone(emptyWorkspace);
  ws.spools = [
    {
      id: 'spool-001',
      spool_code: 'SP-20261028-01',
      work_order_id: 'wo-001',
      canonical_spool_id: null,
      created_at: '2026-10-28 07:00:00'
    } as any
  ];
  ws.orders = [
    {
      id: 'wo-001',
      external_code: 'WO-20261028-01',
      specification_id: 'spec-01',
      status: 'IN_PROGRESS',
      created_at: '2026-10-28 07:00:00'
    } as any
  ];
  return ws;
}

test('ReportsLivePage loads reports from GET /api/v1/reports and displays KPI & SHA-256 hash', async () => {
  const api = new ApiClient();
  const reqSpy = vi.spyOn(api, 'request').mockImplementation(async (path: string) => {
    if (path.startsWith('/reports?')) {
      return { items: [mockReport], has_more: false, next_cursor: null } as ReportListResponse;
    }
    return null;
  });

  const ws = setupWorkspace();
  await render(
    <ReportsLivePage
      api={api}
      data={ws}
      user={mockUser}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  expect(reqSpy).toHaveBeenCalledWith(expect.stringContaining('/reports?limit=100'));
  expect(container.textContent).toContain('QR-TEST-001');
  expect(container.textContent).toContain('整盘出厂报告');
  expect(container.textContent).toContain('SP-20261028-01');
  expect(container.textContent).toContain('9a8b7c6d5e...');
  expect(container.textContent).toContain('主管签发');
});

test('ReportsLivePage submits generate report via POST /api/v1/reports:generate', async () => {
  const api = new ApiClient();
  const reqSpy = vi.spyOn(api, 'request').mockImplementation(async (path: string) => {
    if (path.startsWith('/reports?')) {
      return { items: [], has_more: false, next_cursor: null } as ReportListResponse;
    }
    if (path === '/reports:generate') {
      return { ...mockReport, id: 'rep-new', report_code: 'QR-NEW-999' };
    }
    return null;
  });

  const ws = setupWorkspace();
  await render(
    <ReportsLivePage
      api={api}
      data={ws}
      user={mockUser}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  const openBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.includes('出具质量检验报告')
  )!;
  await act(async () => openBtn.click());

  expect(document.body.textContent).toContain('出具质量检验报告');
  expect(document.body.textContent).toContain('按线缆主盘出具');

  const submitBtn = [...document.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent?.includes('确认生成并归档')
  )!;
  await act(async () => submitBtn.click());

  expect(reqSpy).toHaveBeenCalledWith(
    '/reports:generate',
    expect.objectContaining({
      spool_id: 'spool-001',
      template_code: 'DEFAULT_STANDARD'
    })
  );
});

test('ReportsLivePage calls POST /api/v1/reports/:id:publish when clicking 主管签发', async () => {
  const api = new ApiClient();
  const reqSpy = vi.spyOn(api, 'request').mockImplementation(async (path: string) => {
    if (path.startsWith('/reports?')) {
      return { items: [mockReport], has_more: false, next_cursor: null } as ReportListResponse;
    }
    if (path === '/reports/rep-001:publish') {
      return { id: 'rep-001', report_code: 'QR-TEST-001', state: 'PUBLISHED', published_by: 'u-admin', published_at: '2026-10-28T09:00:00Z' };
    }
    return null;
  });

  const ws = setupWorkspace();
  await render(
    <ReportsLivePage
      api={api}
      data={ws}
      user={mockUser}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  const pubBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent === '主管签发'
  )!;
  await act(async () => pubBtn.click());

  expect(reqSpy).toHaveBeenCalledWith('/reports/rep-001:publish', {});
});

test('ReportsLivePage exports certificate via GET /api/v1/reports/:id/export', async () => {
  const api = new ApiClient();
  const reqSpy = vi.spyOn(api, 'request').mockImplementation(async (path: string) => {
    if (path.startsWith('/reports?')) {
      return { items: [mockReport], has_more: false, next_cursor: null } as ReportListResponse;
    }
    if (path === '/reports/rep-001/export') {
      return mockCertificate;
    }
    return null;
  });

  const ws = setupWorkspace();
  await render(
    <ReportsLivePage
      api={api}
      data={ws}
      user={mockUser}
      params={new URLSearchParams()}
      refresh={vi.fn(async () => {})}
    />
  );

  const expBtn = [...container.querySelectorAll<HTMLButtonElement>('button')].find(b =>
    b.textContent === '导出证书'
  )!;
  await act(async () => expBtn.click());

  expect(reqSpy).toHaveBeenCalledWith('/reports/rep-001/export');
  expect(document.body.textContent).toContain('标准质检合格证书与防伪凭据');
  expect(document.body.textContent).toContain('VERIFIED_IMMUTABLE');
});

test('ReportLiveView renders high-fidelity A4 paper layout with SHA-256 seal and metrics', async () => {
  const api = new ApiClient();
  vi.spyOn(api, 'request').mockImplementation(async (path: string) => {
    if (path === '/reports/rep-001') {
      return mockReport;
    }
    return null;
  });

  const ws = setupWorkspace();
  await render(
    <ReportLiveView
      api={api}
      data={ws}
      user={mockUser}
      params={new URLSearchParams('id=rep-001')}
      refresh={vi.fn(async () => {})}
    />
  );

  expect(container.textContent).toContain('报告预览与导出');
  expect(container.textContent).toContain('QR-TEST-001');
  expect(container.textContent).toContain('VERIFIED_IMMUTABLE');
  expect(container.textContent).toContain('9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b');
  expect(container.textContent).toContain('金属屏蔽搭盖率');
  expect(container.textContent).toContain('铜丝屏蔽间隙');
  expect(container.textContent).toContain('2000.000 m');
  expect(container.textContent).toContain('打印 / 保存 PDF');
});
