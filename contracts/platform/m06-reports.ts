/**
 * M06 追溯、统计与质量报告快照 - 前后端共享契约定义
 * 
 * 对应工作包: WP5.4
 * 适用接口:
 * - GET  /api/v1/reports (质量报告列表与筛选)
 * - POST /api/v1/reports:generate (生成整盘/任务质量报告并冻结快照)
 * - GET  /api/v1/reports/:id (查询报告详情与防伪哈希)
 * - POST /api/v1/reports/:id:publish (发布质量报告，冻结签发时点与人员)
 * - GET  /api/v1/reports/:id/export (导出标准防伪质检合格证书格式)
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
  limit?: number; // 默认 20，最大 100
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
