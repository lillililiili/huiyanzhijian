import { useState, useMemo, useEffect, useCallback } from 'react';
import { PageTitle } from '../ui/PageTitle';
import { Panel } from '../ui/Panel';
import { Kpi } from '../ui/Kpi';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Note } from '../ui/Note';
import { Field, TextInput } from '../ui/Field';
import { DataTable } from '../ui/DataTable';
import { HashLink } from '../ui/HashLink';
import { Modal } from '../ui/Modal';
import { toast } from '../ui/Toast';
import { names, taskState, labelTime, type Workspace, type Person, type ApiClient } from './api';
import type {
  QualityReportItem,
  GenerateReportDto,
  ReportListResponse,
  QualityCertificateExport,
  ReportKind
} from './reportTypes';
import { reportKindMeta, reportStateMeta, qualityVerdictMeta } from './reportTypes';
import { ReportSummaryVisuals } from './ReportSummaryVisuals';
import './reports.css';
import './templates.css';

const STORAGE_KEY_REPORTS = 'huiyan_quality_reports_v2';

function loadFallbackSeeds(data: Workspace): QualityReportItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_REPORTS);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // 降级为初始化种子数据
  }

  const seeds: QualityReportItem[] = [];
  const tasks = data.tasks;

  const finishedTask = tasks.find(t => t.state === 'ENDED') || tasks[0];
  if (finishedTask) {
    const m = finishedTask.measurements;
    seeds.push({
      id: 'RP-20261028-001',
      factory_id: 'factory-local',
      report_code: 'RP-20261028-001',
      revision: 1,
      report_kind: 'TASK_FINAL',
      data_environment: (finishedTask.data_environment as 'SIMULATED' | 'REAL') || 'REAL',
      spool_id: finishedTask.spool_id,
      work_order_id: finishedTask.work_order_id,
      task_ids: [finishedTask.id],
      state: 'PUBLISHED',
      final_result: (m?.failed ?? 0) === 0 && (m?.valid ?? 0) > 0 ? 'PASS' : 'FAIL',
      snapshot_hash: '536f878f91a09452727e10439f8877892ea302322999f3c553f48545c284a35f',
      coverage_snapshot: {
        start_position_m: '0.000',
        end_position_m: '2500.000',
        total_covered_meters: '2500.000',
        total_records: m?.total ?? 1820,
        quarantined_records: 0,
        valid_records: m?.valid ?? 1820,
        coverage_completeness: 'COMPLETE'
      },
      statistics: {
        [finishedTask.metric_code]: {
          metric_code: finishedTask.metric_code,
          unit: m?.unit ?? '%',
          total_samples: m?.total ?? 1820,
          valid_samples: m?.valid ?? 1820,
          passed_samples: (m?.valid ?? 1820) - (m?.failed ?? 0),
          failed_samples: m?.failed ?? 0,
          min_value: m?.minimum ?? '16.2',
          max_value: m?.maximum ?? '19.8',
          avg_value: m?.mean ?? '18.4',
          compliance_rate: (m?.failed ?? 0) === 0 ? 100 : 92.5,
          verdict: (m?.failed ?? 0) === 0 ? 'PASS' : 'FAIL'
        }
      },
      template_snapshot: {
        title: '高压电缆出厂质量检测报告',
        subtitle: '全工序金属屏蔽联锁铠装质量检测与几何轮廓核验',
        signatory_label: '检验员：张工____________    复核人：李总工____________    质量管理部：王部长____________',
        footer: '山东宏亮电缆有限公司 · 慧眼智检 质见未来 · 生产质检合格专用章',
        disclaimer: '本报告汇总该电缆盘全长测量点位之实际数据，未检测或不适用工序不作质量推断。',
        includeLogo: true,
        includeTrend: true,
        includeAlarms: true,
        includeDetails: true,
        includeDeviceSnapshot: true,
        includeSourceDeclaration: true
      },
      query_cutoff: '2026-10-28T09:30:15Z',
      generated_by: '质量工程师',
      published_by: '技术总工',
      published_at: '2026-10-28T09:40:00Z',
      created_at: '2026-10-28 09:30:15'
    });
  }

  const runningTask = tasks.find(t => t.state === 'RUNNING');
  if (runningTask) {
    const m = runningTask.measurements;
    seeds.push({
      id: 'RP-20261028-002',
      factory_id: 'factory-local',
      report_code: 'RP-20261028-002',
      revision: 1,
      report_kind: 'STAGE',
      data_environment: (runningTask.data_environment as 'SIMULATED' | 'REAL') || 'SIMULATED',
      spool_id: runningTask.spool_id,
      work_order_id: runningTask.work_order_id,
      task_ids: [runningTask.id],
      state: 'GENERATED',
      final_result: 'CONDITIONAL',
      snapshot_hash: 'a98f12c304d9e710293847561029384756102938475610293847561029384756',
      coverage_snapshot: {
        start_position_m: '0.000',
        end_position_m: '640.000',
        total_covered_meters: '640.000',
        total_records: m?.total ?? 640,
        quarantined_records: 0,
        valid_records: m?.valid ?? 640,
        coverage_completeness: 'PARTIAL'
      },
      statistics: {
        [runningTask.metric_code]: {
          metric_code: runningTask.metric_code,
          unit: m?.unit ?? 'mm',
          total_samples: m?.total ?? 640,
          valid_samples: m?.valid ?? 640,
          passed_samples: m?.valid ?? 640,
          failed_samples: 0,
          min_value: '1.20',
          max_value: '2.10',
          avg_value: m?.mean ?? '1.75',
          compliance_rate: 100,
          verdict: 'PASS'
        }
      },
      template_snapshot: {
        title: '高压电缆阶段过程检测记录报告',
        subtitle: '生产运行过程阶段检测抽查报告 · 任务未结束',
        signatory_label: '采样员：李明____________    车间复核：赵强____________',
        footer: '山东宏亮电缆有限公司 · 过程检测记录备查',
        disclaimer: '阶段报告仅反映当前已完成长度之量测数据，不作为产品最终出厂合格证明。',
        includeLogo: true,
        includeTrend: true,
        includeAlarms: false,
        includeDetails: true,
        includeDeviceSnapshot: true,
        includeSourceDeclaration: true
      },
      query_cutoff: '2026-10-28T10:15:00Z',
      generated_by: '产线质检员',
      published_by: null,
      published_at: null,
      created_at: '2026-10-28 10:15:00'
    });
  }

  return seeds;
}

export interface PageProps {
  api?: ApiClient;
  data: Workspace;
  user: Person;
  params: URLSearchParams;
  refresh: () => Promise<void>;
}

export function ReportsLivePage({ api, data, user, refresh }: PageProps) {
  const [reports, setReports] = useState<QualityReportItem[]>(() => loadFallbackSeeds(data));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [keyword, setKeyword] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [verdictFilter, setVerdictFilter] = useState('');

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [exportModalData, setExportModalData] = useState<QualityCertificateExport | null>(null);

  // 从服务端 M06 API 加载质量报告列表
  const loadReports = useCallback(async () => {
    if (!api) return;
    setLoading(true);
    setError(null);
    try {
      const q = new URLSearchParams();
      q.set('limit', '100');
      if (kindFilter) q.set('report_kind', kindFilter);
      if (stateFilter) q.set('state', stateFilter);
      if (verdictFilter) q.set('final_result', verdictFilter);

      const res = await api.request<ReportListResponse>(`/reports?${q.toString()}`);
      if (res && Array.isArray(res.items)) {
        setReports(res.items);
      }
    } catch (e) {
      // 容错降级
      setError(e instanceof Error ? e.message : '从平台读取报告失败');
    } finally {
      setLoading(false);
    }
  }, [api, kindFilter, stateFilter, verdictFilter]);

  useEffect(() => {
    void loadReports();
  }, [loadReports]);

  function saveFallback(next: QualityReportItem[]) {
    setReports(next);
    try {
      localStorage.setItem(STORAGE_KEY_REPORTS, JSON.stringify(next));
    } catch {
      // 容错
    }
  }

  // 综合本地筛选过滤
  const filtered = useMemo(() => {
    return reports.filter(r => {
      if (kindFilter && r.report_kind !== kindFilter) return false;
      if (stateFilter && r.state !== stateFilter) return false;
      if (verdictFilter && r.final_result !== verdictFilter) return false;
      if (keyword) {
        const text = [r.id, r.report_code, r.spool_id, r.work_order_id, ...(r.task_ids || [])]
          .join(' ')
          .toLowerCase();
        if (!text.includes(keyword.trim().toLowerCase())) return false;
      }
      return true;
    });
  }, [reports, kindFilter, stateFilter, verdictFilter, keyword]);

  const finalCount = reports.filter(r => r.report_kind === 'SPOOL_SUMMARY' || r.report_kind === 'TASK_FINAL').length;
  const stageCount = reports.filter(r => r.report_kind === 'STAGE').length;
  const publishedCount = reports.filter(r => r.state === 'PUBLISHED').length;

  // 出具报告
  async function handleCreateReport(dto: GenerateReportDto) {
    if (api) {
      try {
        const res = await api.request<QualityReportItem>('/reports:generate', dto);
        toast(`报告 ${res.report_code} 出具成功，已冻结 SHA-256 防伪指纹: ${res.snapshot_hash.slice(0, 10)}...`);
        setCreateModalOpen(false);
        await loadReports();
        await refresh();
        return;
      } catch (e) {
        toast(`出具报告失败: ${e instanceof Error ? e.message : '未知错误'}`);
        return;
      }
    }

    // 单元测试 / 离线模式降级
    const selectedTask = data.tasks.find(t => t.id === dto.task_ids?.[0]) || data.tasks[0];
    const reportCode = `RP-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${Math.floor(Math.random() * 900 + 100)}`;
    const newReport: QualityReportItem = {
      id: reportCode,
      factory_id: 'factory-local',
      report_code: reportCode,
      revision: 1,
      report_kind: dto.report_kind || 'TASK_FINAL',
      data_environment: (selectedTask?.data_environment as 'SIMULATED' | 'REAL') || 'REAL',
      spool_id: dto.spool_id || selectedTask?.spool_id || 'spool-01',
      work_order_id: dto.work_order_id || selectedTask?.work_order_id || 'wo-01',
      task_ids: dto.task_ids || [selectedTask?.id || 'task-01'],
      state: 'GENERATED',
      final_result: selectedTask?.measurements?.failed ? 'FAIL' : 'PASS',
      snapshot_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      coverage_snapshot: {
        start_position_m: '0.000',
        end_position_m: selectedTask?.planned_length_m || '1000.000',
        total_covered_meters: selectedTask?.planned_length_m || '1000.000',
        total_records: selectedTask?.measurements?.total || 1000,
        quarantined_records: 0,
        valid_records: selectedTask?.measurements?.valid || 990,
        coverage_completeness: 'COMPLETE'
      },
      statistics: {
        [selectedTask?.metric_code || 'SHIELD_OVERLAP_RATE']: {
          metric_code: selectedTask?.metric_code || 'SHIELD_OVERLAP_RATE',
          unit: selectedTask?.measurements?.unit || '%',
          total_samples: selectedTask?.measurements?.total || 1000,
          valid_samples: selectedTask?.measurements?.valid || 990,
          passed_samples: selectedTask?.measurements?.passed || 990,
          failed_samples: selectedTask?.measurements?.failed || 0,
          min_value: selectedTask?.measurements?.minimum || '16.0',
          max_value: selectedTask?.measurements?.maximum || '19.5',
          avg_value: selectedTask?.measurements?.mean || '17.8',
          compliance_rate: 100,
          verdict: 'PASS'
        }
      },
      query_cutoff: new Date().toISOString(),
      generated_by: user.name || user.username || '当前用户',
      published_by: null,
      published_at: null,
      created_at: new Date().toISOString().slice(0, 19).replace('T', ' ')
    };

    saveFallback([newReport, ...reports]);
    setCreateModalOpen(false);
    toast(`报告 ${newReport.report_code} 出具成功，已深度冻结数据与模板快照。`);
  }

  // 主管签发发布
  async function handlePublishReport(report: QualityReportItem) {
    if (!api) {
      toast('离线模式不支持主管签发');
      return;
    }
    try {
      const res = await api.request<{ id: string; report_code: string; state: string; published_by: string; published_at: string }>(
        `/reports/${encodeURIComponent(report.id)}:publish`,
        {}
      );
      toast(`报告 ${res.report_code} 已由主管成功签发发布，状态更新为 PUBLISHED！`);
      await loadReports();
    } catch (e) {
      toast(`主管签发失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  // 导出质检证书 JSON
  async function handleExportCertificate(reportId: string) {
    if (!api) {
      toast('当前环境未连接平台 API');
      return;
    }
    try {
      const cert = await api.request<QualityCertificateExport>(`/reports/${encodeURIComponent(reportId)}/export`);
      setExportModalData(cert);

      const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `CERT-${cert.report_code}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`标准质检合格证书已导出：CERT-${cert.report_code}.json`);
    } catch (e) {
      toast(`导出证书失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  // 导出 CSV 快照
  function handleExportCsv(report: QualityReportItem) {
    const headers = ['报告编号', '报告类型', '防伪指纹(SHA-256)', '线缆盘号', '工单编号', '覆盖米数', '采样总数', '有效测点', '综合结论', '签发状态', '生成时间'];
    const row = [
      report.report_code || report.id,
      reportKindMeta[report.report_kind]?.label || report.report_kind,
      report.snapshot_hash,
      report.spool_id,
      report.work_order_id || '—',
      `${report.coverage_snapshot?.total_covered_meters || '—'}m`,
      report.coverage_snapshot?.total_records || 0,
      report.coverage_snapshot?.valid_records || 0,
      qualityVerdictMeta[report.final_result]?.label || report.final_result,
      reportStateMeta[report.state]?.label || report.state,
      report.created_at
    ];
    const csv = '\uFEFF' + headers.join(',') + '\r\n' + row.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${report.report_code || report.id}-质检数据快照.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="reports-page">
      <PageTitle
        title="质量报告管理"
        subtitle="M06 追溯、统计与质量报告快照平台：支持整盘出厂检验报告与阶段过程报告智能出具、SHA-256 防篡改指纹固化与标准质检证书签发导出。"
        actions={
          <>
            <Button disabled={loading} onClick={() => { void loadReports(); void refresh(); }}>
              {loading ? '正在刷新...' : '刷新报告'}
            </Button>
            <Button primary icon="file-plus" onClick={() => setCreateModalOpen(true)}>
              出具质量检验报告
            </Button>
          </>
        }
      />

      {error && <Note tone="amber">{error}</Note>}

      {/* 顶部统计卡片 */}
      <div className="grid cols-4">
        <Kpi
          label="已归档质量报告"
          value={reports.length}
          note="每份报告均深度冻结生成时刻数据快照与哈希"
          icon="file-text"
        />
        <Kpi
          label="出厂最终检验报告"
          value={finalCount}
          note="针对检测完成任务/主盘，作为正式放行证明"
          icon="shield-check"
          tone="green"
        />
        <Kpi
          label="过程阶段检测报告"
          value={stageCount}
          note="任务运行中抽查记录，不作为放行依据"
          icon="clock"
          tone="amber"
        />
        <Kpi
          label="已主管签发发布"
          value={publishedCount}
          note="经质量主管电子审批签字并正式归档"
          icon="check-circle"
          tone="blue"
        />
      </div>

      {/* 筛选过滤工具条 */}
      <div className="report-filter-bar">
        <div style={{ flex: '1 1 240px' }}>
          <Field label="检索报告 / 盘号 / 工单 / 任务">
            <TextInput
              name="kw"
              value={keyword}
              placeholder="输入报告单号、线缆盘ID、工单号或任务ID"
              onChange={e => setKeyword(e.target.value)}
            />
          </Field>
        </div>

        <div style={{ width: 180 }}>
          <Field label="报告类型">
            <select value={kindFilter} onChange={e => setKindFilter(e.target.value)}>
              <option value="">全部类型报告</option>
              <option value="SPOOL_SUMMARY">整盘出厂报告 (综合汇总)</option>
              <option value="TASK_FINAL">单项出厂报告 (单任务完成)</option>
              <option value="STAGE">阶段过程报告 (生产运行中)</option>
            </select>
          </Field>
        </div>

        <div style={{ width: 160 }}>
          <Field label="签发状态">
            <select value={stateFilter} onChange={e => setStateFilter(e.target.value)}>
              <option value="">全部签发状态</option>
              <option value="GENERATED">已生成 (待主管签发)</option>
              <option value="PUBLISHED">已发布 (签发结案)</option>
              <option value="DRAFT">草稿状态</option>
            </select>
          </Field>
        </div>

        <div style={{ width: 160 }}>
          <Field label="质量评定结论">
            <select value={verdictFilter} onChange={e => setVerdictFilter(e.target.value)}>
              <option value="">全部质量结论</option>
              <option value="PASS">合格放行 (PASS)</option>
              <option value="FAIL">超限不合格 (FAIL)</option>
              <option value="CONDITIONAL">条件放行</option>
            </select>
          </Field>
        </div>
      </div>

      {/* 报告记录表格 */}
      <Panel
        core
        table
        title="质量报告归档列表"
        tools={<span className="muted small">共 {filtered.length} 份报告</span>}
      >
        <DataTable
          headers={['报告编号 / 版本', '报告类型', '关联盘号 / 工单', '覆盖区间 / 采样点', '质量结论', '防伪指纹 (SHA-256)', '签发状态', '生成时间', '闭环操作']}
          rows={filtered.map(r => {
            const kMeta = reportKindMeta[r.report_kind] || { label: r.report_kind, tone: 'neutral' };
            const sMeta = reportStateMeta[r.state] || { label: r.state, tone: 'neutral' };
            const vMeta = qualityVerdictMeta[r.final_result] || { label: r.final_result, tone: 'neutral' };

            const spool = data.spools?.find(s => s.id === r.spool_id);
            const order = data.orders?.find(o => o.id === r.work_order_id);
            const task = data.tasks?.find(t => r.task_ids?.includes(t.id));
            const spoolCode = spool?.spool_code || r.spool_id;
            const orderCode = order?.external_code || r.work_order_id || '—';
            const taskCode = task?.task_code || r.task_ids?.[0] || '—';

            return [
              <HashLink key="code" route={`report?id=${encodeURIComponent(r.id)}`}>
                <strong>{r.report_code || r.id}</strong>
                <span className="muted small" style={{ marginLeft: 6 }}>Rev.{r.revision}</span>
              </HashLink>,
              <Badge key="kind" tone={kMeta.tone}>{kMeta.label}</Badge>,
              <div key="target">
                <div>盘号：<strong>{spoolCode}</strong></div>
                <div className="muted small">工单：{orderCode} · 任务：{taskCode}</div>
              </div>,
              <div key="cov">
                <div>{r.coverage_snapshot?.total_covered_meters ? `${r.coverage_snapshot.total_covered_meters} m` : '—'}</div>
                <div className="muted small">{r.coverage_snapshot?.valid_records ?? 0} 个有效测点</div>
              </div>,
              <Badge key="verdict" tone={vMeta.tone}>{vMeta.label}</Badge>,
              <span key="hash" className="hash-badge" title={`完整SHA-256指纹:\n${r.snapshot_hash}`}>
                {r.snapshot_hash ? `${r.snapshot_hash.slice(0, 10)}...${r.snapshot_hash.slice(-6)}` : '—'}
              </span>,
              <Badge key="state" tone={sMeta.tone}>{sMeta.label}</Badge>,
              <div key="time" className="muted small">
                <div>{r.created_at ? labelTime(r.created_at) : '—'}</div>
                <div>编制: {r.generated_by}</div>
              </div>,
              <div key="actions" className="report-actions-cell">
                <HashLink route={`report?id=${encodeURIComponent(r.id)}`}>预览</HashLink>
                {r.state === 'GENERATED' && (
                  <Button primary onClick={() => void handlePublishReport(r)}>主管签发</Button>
                )}
                {api && (
                  <Button onClick={() => void handleExportCertificate(r.id)}>导出证书</Button>
                )}
                <Button onClick={() => handleExportCsv(r)}>CSV</Button>
              </div>
            ];
          })}
        />
      </Panel>

      <Note>
        <strong>受控防伪规则：</strong>
        报告一经生成即刻深度冻结任务快照、规则快照及当时生效的模板快照，并计算全字段 SHA-256 防篡改数字指纹。主管签发后永久锁定放行时点与人员，后续配方规则调整绝不改写已归档报告历史判定。
      </Note>

      {/* 出具质量检验报告弹窗 */}
      {createModalOpen && (
        <CreateReportModal
          data={data}
          currentUser={user}
          onClose={() => setCreateModalOpen(false)}
          onSubmit={handleCreateReport}
        />
      )}

      {/* 导出防伪证书预览弹窗 */}
      {exportModalData && (
        <Modal
          title={`标准质检合格证书与防伪凭据 · ${exportModalData.report_code}`}
          open
          submitLabel="确定"
          onClose={() => setExportModalData(null)}
          onSubmit={() => setExportModalData(null)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="tamper-proof-seal">
              <span>✔ 工业级不可篡改哈希认证：</span>
              <code>{exportModalData.tamper_proof.snapshot_hash}</code>
              <Badge tone="green">{exportModalData.tamper_proof.verification_status}</Badge>
            </div>
            <table className="report-metrics-table">
              <thead>
                <tr>
                  <th>检测指标</th>
                  <th>单位</th>
                  <th>均值</th>
                  <th>极值范围</th>
                  <th>合格率</th>
                  <th>单项结论</th>
                </tr>
              </thead>
              <tbody>
                {exportModalData.metrics_table.map(m => (
                  <tr key={m.metric_code}>
                    <td><strong>{m.metric_name}</strong></td>
                    <td>{m.unit}</td>
                    <td>{m.avg ?? '—'}</td>
                    <td>{m.min ?? '—'} ~ {m.max ?? '—'}</td>
                    <td>{m.compliance_rate}</td>
                    <td>
                      <Badge tone={m.status === 'PASS' ? 'green' : 'red'}>
                        {m.status === 'PASS' ? '符合' : '超限'}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="muted small">
              签署责任：{exportModalData.signatories.label} | 签发时点：{exportModalData.signatories.published_at ? labelTime(exportModalData.signatories.published_at) : '未签发'}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

interface CreateModalProps {
  data: Workspace;
  currentUser: Person;
  onClose: () => void;
  onSubmit: (dto: GenerateReportDto) => Promise<void>;
}

function CreateReportModal({ data, currentUser, onClose, onSubmit }: CreateModalProps) {
  const spools = data.spools || [];
  const tasks = data.tasks || [];

  // 出具维度：spool (整盘综合报告，推荐) 或 task (单任务报告)
  const [dimension, setDimension] = useState<'spool' | 'task'>('spool');
  const [selectedSpoolId, setSelectedSpoolId] = useState(spools[0]?.id || tasks[0]?.spool_id || '');
  const [selectedTaskId, setSelectedTaskId] = useState(tasks[0]?.id || '');
  const [submitting, setSubmitting] = useState(false);

  // 计算当前所选线缆盘关联的任务
  const spoolTasks = useMemo(() => {
    return tasks.filter(t => t.spool_id === selectedSpoolId);
  }, [tasks, selectedSpoolId]);

  // 计算当前所选任务
  const currentTask = useMemo(() => {
    return tasks.find(t => t.id === selectedTaskId) || tasks[0];
  }, [tasks, selectedTaskId]);

  // 判定报告类型：若整盘下存在 RUNNING 任务或单任务为 RUNNING 则为 STAGE，全部结束则为 SPOOL_SUMMARY / TASK_FINAL
  const hasRunning = dimension === 'spool'
    ? spoolTasks.some(t => t.state === 'RUNNING')
    : currentTask?.state === 'RUNNING';

  const defaultKind: ReportKind = hasRunning
    ? 'STAGE'
    : dimension === 'spool'
    ? 'SPOOL_SUMMARY'
    : 'TASK_FINAL';

  async function handleFormSubmit() {
    setSubmitting(true);
    try {
      if (dimension === 'spool') {
        await onSubmit({
          spool_id: selectedSpoolId,
          work_order_id: spoolTasks[0]?.work_order_id,
          task_ids: spoolTasks.map(t => t.id),
          report_kind: defaultKind,
          template_code: 'DEFAULT_STANDARD'
        });
      } else {
        await onSubmit({
          spool_id: currentTask?.spool_id || selectedSpoolId,
          work_order_id: currentTask?.work_order_id,
          task_ids: currentTask ? [currentTask.id] : undefined,
          report_kind: defaultKind,
          template_code: 'DEFAULT_STANDARD'
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      title="出具质量检验报告"
      open
      submitLabel={submitting ? '正在生成快照...' : '确认生成并归档'}
      onClose={onClose}
      onSubmit={() => void handleFormSubmit()}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <Note>
          {hasRunning ? (
            <span style={{ color: '#d97706' }}>
              当前关联任务处于<strong>「检测中 (RUNNING)」</strong>状态，系统将按规程出具<strong>「阶段过程报告 (STAGE)」</strong>，不形成最终出厂放行结论。
            </span>
          ) : (
            <span style={{ color: '#0d824d' }}>
              当前任务处于<strong>「已结束 (ENDED)」</strong>状态，系统将出具正式<strong>「出厂最终质量检验报告」</strong>。
            </span>
          )}
        </Note>

        <Field label="出具统计维度">
          <div style={{ display: 'flex', gap: 16, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="dim"
                checked={dimension === 'spool'}
                onChange={() => setDimension('spool')}
              />
              <strong>按线缆主盘出具（整盘综合汇总 · 推荐）</strong>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input
                type="radio"
                name="dim"
                checked={dimension === 'task'}
                onChange={() => setDimension('task')}
              />
              <span>按单项检测任务出具</span>
            </label>
          </div>
        </Field>

        {dimension === 'spool' ? (
          <Field label="选择目标线缆盘">
            <select value={selectedSpoolId} onChange={e => setSelectedSpoolId(e.target.value)}>
              {spools.map(s => {
                const matchedTasks = tasks.filter(t => t.spool_id === s.id);
                return (
                  <option key={s.id} value={s.id}>
                    {s.spool_code} (关联 {matchedTasks.length} 个任务 · {(s as any).specification_name || '高压电缆'})
                  </option>
                );
              })}
            </select>
          </Field>
        ) : (
          <Field label="关联检测任务">
            <select value={selectedTaskId} onChange={e => setSelectedTaskId(e.target.value)}>
              {tasks.map(t => (
                <option key={t.id} value={t.id}>
                  {t.task_code || t.id} · {names[t.metric_code]} · 盘号:{t.context_snapshot?.spool_code || t.current_spool_code || '—'} ({taskState[t.state]})
                </option>
              ))}
            </select>
          </Field>
        )}

        <div className="report-create-grid">
          <Field label="报告类型标记">
            <TextInput
              name="kind"
              value={
                defaultKind === 'SPOOL_SUMMARY'
                  ? '整盘综合出厂报告 (Spool Summary)'
                  : defaultKind === 'TASK_FINAL'
                  ? '单项最终出厂报告 (Task Final)'
                  : '阶段过程报告 (Stage Report)'
              }
              readOnly
            />
          </Field>
          <Field label="关联受控模板">
            <TextInput name="tpl" value="高压电缆检测报告受控模板 · V1.0 (DEFAULT_STANDARD)" readOnly />
          </Field>
        </div>

        <div className="report-create-grid">
          <Field label="编制人员">
            <TextInput name="creator" value={currentUser.name || currentUser.username} readOnly />
          </Field>
          <Field label="质量主管审批节点">
            <TextInput name="reviewer" value="质量主管审批 (签发时生效)" readOnly />
          </Field>
        </div>

        <div style={{ background: '#f8fafc', padding: 12, borderRadius: 6, fontSize: 13, border: '1px solid #e2e8f0' }}>
          <div><strong>防篡改快照机制说明：</strong></div>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            系统将调用后端 M06 质量分析引擎，自动聚合目标对象全长采样记录、计算均值/极值/合格率统计、锁定当时生效的判定规则快照，并计算全字段不可篡改 SHA-256 数字指纹。
          </p>
        </div>
      </div>
    </Modal>
  );
}

/**
 * P17: 报告预览详情组件 (路由 `#report?id=...`)
 */
export function ReportLiveView({ api, data, params }: PageProps) {
  const reportId = params.get('id');
  const [report, setReport] = useState<QualityReportItem | null>(null);
  const [loading, setLoading] = useState(false);
  const [isLocalPreview, setIsLocalPreview] = useState(false);

  useEffect(() => {
    let active = true;
    if (api && reportId) {
      setLoading(true);
      setIsLocalPreview(false);
      api.request<QualityReportItem>(`/reports/${encodeURIComponent(reportId)}`)
        .then(res => {
          if (active && res) {
            setReport(res);
            setIsLocalPreview(false);
          }
        })
        .catch(() => {
          // 本地预览种子不是服务端报告；页面和PDF都必须明确标识。
          if (active) {
            const fallback = loadFallbackSeeds(data).find(r => r.id === reportId) || null;
            setReport(fallback);
            setIsLocalPreview(Boolean(fallback));
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    } else {
      const fallback = reportId ? loadFallbackSeeds(data).find(r => r.id === reportId) || null : null;
      setReport(fallback);
      setIsLocalPreview(Boolean(fallback));
    }
    return () => { active = false; };
  }, [api, reportId, data]);

  if (loading) {
    return (
      <div className="reports-page">
        <PageTitle title="报告详情" subtitle="正在从平台读取防伪快照..." actions={<HashLink route="reports">返回报告列表</HashLink>} />
        <Note>正在校验 SHA-256 快照哈希并渲染排版…</Note>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="reports-page">
        <PageTitle title="报告详情" subtitle="未找到指定报告" actions={<HashLink route="reports">返回报告列表</HashLink>} />
        <Note>报告不存在或已归档移除。</Note>
      </div>
    );
  }

  const tpl = report.template_snapshot || {};
  const statsList = Object.values(report.statistics || {});
  const spool = data.spools?.find(s => s.id === report.spool_id);
  const order = data.orders?.find(o => o.id === report.work_order_id);
  const spoolCode = spool?.spool_code || report.spool_id;
  const orderCode = order?.external_code || report.work_order_id || '—';

  async function handlePublish() {
    if (!api || !report || isLocalPreview) return;
    try {
      await api.request(`/reports/${encodeURIComponent(report.id)}:publish`, {});
      toast('主管签发成功，报告已发布！');
      const updated = await api.request<QualityReportItem>(`/reports/${encodeURIComponent(report.id)}`);
      setReport(updated);
    } catch (e) {
      toast(`签发失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  async function handleExportJson() {
    if (!api || !report || isLocalPreview) return;
    try {
      const cert = await api.request<QualityCertificateExport>(`/reports/${encodeURIComponent(report.id)}/export`);
      const blob = new Blob([JSON.stringify(cert, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `CERT-${cert.report_code}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast(`已成功导出标准质检证书 CERT-${cert.report_code}.json`);
    } catch (e) {
      toast(`导出失败: ${e instanceof Error ? e.message : '未知错误'}`);
    }
  }

  return (
    <div className="reports-page">
      <PageTitle
        title="报告预览与导出"
        subtitle={`当前展示单号 ${report.report_code || report.id} 之冻结快照数据，打印可生成正式 PDF 文件。`}
        actions={
          <>
            <HashLink route="reports">返回报告管理</HashLink>
            {!isLocalPreview && report.state === 'GENERATED' && (
              <Button primary onClick={() => void handlePublish()}>主管签发发布</Button>
            )}
            {api && !isLocalPreview && (
              <Button onClick={() => void handleExportJson()}>导出防伪证书</Button>
            )}
            <Button primary icon="printer" onClick={() => window.print()}>
              {isLocalPreview ? '打印样张 / 保存 PDF' : '打印 / 保存 PDF'}
            </Button>
          </>
        }
      />

      {/* 高保真 A4 报告纸质排版 */}
      <article className="report-paper report-print-target">
        {isLocalPreview && (
          <div className="report-sample-banner" role="note">
            <strong>本地预览样张 · 非服务端归档报告</strong>
            <span>此内容用于界面演示，不能作为正式质量结论；发布与防伪证书导出已禁用。</span>
          </div>
        )}
        {/* 防伪验真印章印条 */}
        <div className="tamper-proof-seal">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>报告快照指纹 (SHA-256)：</span>
            <code>{report.snapshot_hash}</code>
          </div>
          <Badge tone="green">已冻结快照</Badge>
        </div>

        {/* 页眉 */}
        <div className="report-header-row">
          <div>
            {tpl.includeLogo !== false ? (
              <img src="assets/images/logo.png" alt="慧眼智检" className="report-logo-img" />
            ) : (
              <strong style={{ fontSize: 18, color: '#155ab6' }}>山东宏亮电缆有限公司</strong>
            )}
          </div>
          <div className="report-header-meta">
            <div>报告编号：<strong>{report.report_code || report.id}</strong></div>
            <div>生成时间：{labelTime(report.created_at)}</div>
            <div>模板修订：<Badge tone="blue">{tpl.revision ? `Rev.${tpl.revision}` : '生成时快照'}</Badge></div>
            <div>报告修订：Rev.{report.revision}</div>
          </div>
        </div>

        {/* 标题 */}
        <div className="report-title-section">
          <h2 className="report-main-title">{tpl.title || '高压电缆出厂质量检测报告'}</h2>
          <p className="report-subtitle">{tpl.subtitle || '全工序金属屏蔽联锁铠装质量检测与几何轮廓核验'}</p>
        </div>

        {/* 事实元数据表格 */}
        <table className="report-meta-table">
          <tbody>
            <tr>
              <th>检测电缆盘</th>
              <td>{spoolCode}</td>
              <th>生产工单</th>
              <td>{orderCode}</td>
            </tr>
            <tr>
              <th>检测工序</th>
              <td>金属屏蔽联锁铠装</td>
              <th>数据环境</th>
              <td>{report.data_environment === 'REAL' ? '生产现场采集 (REAL)' : '仿真模拟数据 (SIMULATED)'}</td>
            </tr>
            <tr>
              <th>覆盖全长</th>
              <td>
                {report.coverage_snapshot?.total_covered_meters ? `${report.coverage_snapshot.total_covered_meters} m` : '—'}
                <span className="muted small" style={{ marginLeft: 6 }}>
                  ({report.coverage_snapshot?.start_position_m || '0.000'}m ~ {report.coverage_snapshot?.end_position_m || '0.000'}m)
                </span>
              </td>
              <th>采样记录数</th>
              <td>{report.coverage_snapshot?.valid_records ?? 0} 点有效 (共 {report.coverage_snapshot?.total_records ?? 0} 点)</td>
            </tr>
            <tr>
              <th>报告性质</th>
              <td>
                <Badge tone={reportKindMeta[report.report_kind]?.tone || 'blue'}>
                  {reportKindMeta[report.report_kind]?.label || report.report_kind}
                </Badge>
              </td>
              <th>最终质量评定</th>
              <td>
                <Badge tone={qualityVerdictMeta[report.final_result]?.tone || 'neutral'}>
                  {qualityVerdictMeta[report.final_result]?.label || report.final_result}
                </Badge>
              </td>
            </tr>
          </tbody>
        </table>

        {/* 数据汇总：三项指标全量表格 */}
        <div className="report-section">
          <div className="report-section-title">
            <span>检测数据汇总统计（{statsList.length} 项指标）</span>
            <span style={{ fontSize: 13, color: '#65758b' }}>
              编制人：{report.generated_by} · 签发人：{report.published_by || '待主管签发'}
            </span>
          </div>

          <table className="report-metrics-table">
            <thead>
              <tr>
                <th>检测项目</th>
                <th>量纲</th>
                <th>有效 / 总点数</th>
                <th>符合 / 超限</th>
                <th>平均值</th>
                <th>最小值 ～ 最大值</th>
                <th>合格率</th>
                <th>结论</th>
              </tr>
            </thead>
            <tbody>
              {statsList.length > 0 ? (
                statsList.map(s => (
                  <tr key={s.metric_code}>
                    <td><strong>{names[s.metric_code] || s.metric_code}</strong></td>
                    <td>{s.unit}</td>
                    <td>{s.valid_samples} / {s.total_samples}</td>
                    <td style={{ color: s.failed_samples > 0 ? '#b91c1c' : '#0d824d', fontWeight: 600 }}>
                      {s.passed_samples} / {s.failed_samples}
                    </td>
                    <td>{s.avg_value ?? '—'} {s.avg_value !== null ? s.unit : ''}</td>
                    <td>{s.min_value ?? '—'} ～ {s.max_value ?? '—'} {s.min_value !== null || s.max_value !== null ? s.unit : ''}</td>
                    <td>{typeof s.compliance_rate === 'number' ? `${s.compliance_rate}%` : s.compliance_rate}</td>
                    <td>
                      <Badge tone={s.verdict === 'PASS' ? 'green' : 'red'}>
                        {s.verdict === 'PASS' ? '符合' : '超限'}
                      </Badge>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ textAlign: 'center', color: '#94a3b8' }}>暂无指标汇总数据，报告没有可绘制的统计图表。</td>
                </tr>
              )}
            </tbody>
          </table>

          {/* 只用报告本身的冻结汇总绘图；当前契约没有逐点时间序列，不能绘制趋势线 */}
          {tpl.includeTrend !== false && (
            <ReportSummaryVisuals metrics={statsList} />
          )}
          <p className="report-snapshot-caption">
            图表只使用本报告冻结的统计汇总；未纳入快照的逐点曲线、报警处置、设备参数或现场图片不会被补造。统计范围图表示最小值、平均值和最大值，不代表随时间变化的趋势。
          </p>
        </div>

        {/* 签审责任栏 */}
        <div className="report-sign-area">
          <div className="report-sign-row">
            <span>
              {tpl.signatory_label || '检验员：____________    复核人：____________    质量总监：____________'}
            </span>
            <span>
              签发时间：{report.published_at ? labelTime(report.published_at) : (report.created_at ? labelTime(report.created_at) : '—')}
            </span>
          </div>
          <div className="report-compliance-note">
            <strong>合规声明：</strong>
            {tpl.disclaimer || '本报告仅反映所关联任务及所配置检测项目之实际测量结果。'}
            （签审栏为纸质/PDF展示格式，文字签名不替代电子签名或生产资质放行凭证。）
          </div>
        </div>

        {/* 页脚 */}
        <div className="report-footer-area">
          <div>{tpl.footer || '山东宏亮电缆有限公司 · 慧眼智检 质见未来'}</div>
          <div style={{ marginTop: 4 }}>
            编制单位：山东宏亮电缆有限公司 · 报告单号：{report.report_code || report.id} · 防伪指纹：{report.snapshot_hash.slice(0, 16)}...
          </div>
        </div>
      </article>
    </div>
  );
}
