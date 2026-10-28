/**
 * 前端 M06 质量报告与追溯快照类型定义
 * 严格对齐 contracts/platform/m06-reports.ts 契约
 */

export type ReportState = 'DRAFT' | 'GENERATED' | 'PUBLISHED' | 'FAILED';
export type QualityVerdict = 'PASS' | 'FAIL' | 'CONDITIONAL';
export type ReportKind = 'STAGE' | 'TASK_FINAL' | 'SPOOL_SUMMARY';

export interface MetricSummaryItem {
  metric_code: string;
  unit: string;
  total_samples: number;
  valid_samples: number;
  passed_samples: number;
  failed_samples: number;
  min_value: string | null;
  max_value: string | null;
  avg_value: string | null;
  compliance_rate: number; // 0.00 ~ 100.00 (%)
  verdict: 'PASS' | 'FAIL';
}

export interface CoverageSnapshot {
  start_position_m: string;
  end_position_m: string;
  total_covered_meters: string;
  total_records: number;
  quarantined_records: number;
  valid_records: number;
  coverage_completeness: 'COMPLETE' | 'PARTIAL';
}

export interface TemplateSnapshot {
  id?: string;
  template_code?: string;
  title?: string;
  subtitle?: string;
  revision?: number;
  signatory_label?: string;
  footer?: string;
  disclaimer?: string;
  includeLogo?: boolean;
  includeTrend?: boolean;
  includeAlarms?: boolean;
  includeDetails?: boolean;
  includeDeviceSnapshot?: boolean;
  includeSourceDeclaration?: boolean;
}

export interface QualityReportItem {
  id: string;
  factory_id: string;
  report_code: string;
  revision: number;
  report_kind: ReportKind;
  data_environment: 'REAL' | 'SIMULATED';
  spool_id: string;
  work_order_id: string | null;
  task_ids: string[];
  state: ReportState;
  final_result: QualityVerdict;
  snapshot_hash: string; // SHA-256 防篡改指纹
  template_snapshot?: TemplateSnapshot;
  coverage_snapshot: CoverageSnapshot;
  statistics: Record<string, MetricSummaryItem>;
  query_cutoff: string; // ISO UTC
  generated_by: string;
  published_by: string | null;
  published_at: string | null; // ISO UTC
  created_at: string; // ISO UTC
}

export interface GenerateReportDto {
  spool_id: string;
  work_order_id?: string;
  task_ids?: string[];
  report_kind?: ReportKind;
  template_code?: string;
}

export interface ReportFilterParams {
  spool_id?: string;
  work_order_id?: string;
  state?: ReportState;
  final_result?: QualityVerdict;
  report_kind?: ReportKind;
  limit?: number;
  after_id?: string;
}

export interface ReportListResponse {
  items: QualityReportItem[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface QualityCertificateExport {
  certificate_title: string;
  report_code: string;
  revision: number;
  spool_id: string;
  work_order_id: string | null;
  task_ids: string[];
  final_verdict: QualityVerdict;
  inspection_summary: {
    coverage_meters: string;
    meter_range: string;
    total_records: number;
    valid_records: number;
  };
  metrics_table: Array<{
    metric_name: string;
    metric_code: string;
    unit: string;
    min: string | null;
    max: string | null;
    avg: string | null;
    compliance_rate: string;
    status: 'PASS' | 'FAIL';
  }>;
  signatories: {
    label: string;
    generated_by: string;
    published_by: string | null;
    published_at: string | null;
  };
  tamper_proof: {
    algorithm: string;
    snapshot_hash: string;
    verification_status: 'VERIFIED_IMMUTABLE';
  };
  footer: string;
}

export const reportKindMeta: Record<ReportKind, { label: string; tone: 'green' | 'blue' | 'amber'; desc: string }> = {
  SPOOL_SUMMARY: { label: '整盘出厂报告', tone: 'green', desc: '整盘所有工序/指标汇总检测结果' },
  TASK_FINAL: { label: '单项出厂报告', tone: 'blue', desc: '单任务完成后的出厂检测结果' },
  STAGE: { label: '过程阶段报告', tone: 'amber', desc: '生产过程中抽检，不作为放行依据' }
};

export const reportStateMeta: Record<ReportState, { label: string; tone: 'green' | 'amber' | 'neutral' | 'red' }> = {
  DRAFT: { label: '草稿', tone: 'neutral' },
  GENERATED: { label: '已生成待签', tone: 'amber' },
  PUBLISHED: { label: '已发布签发', tone: 'green' },
  FAILED: { label: '生成失败', tone: 'red' }
};

export const qualityVerdictMeta: Record<QualityVerdict, { label: string; tone: 'green' | 'red' | 'amber' }> = {
  PASS: { label: '合格放行', tone: 'green' },
  FAIL: { label: '超限不合格', tone: 'red' },
  CONDITIONAL: { label: '条件放行', tone: 'amber' }
};
