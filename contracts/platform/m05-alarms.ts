/**
 * M05 工业级报警生命周期引擎 - 前后端共享契约定义
 * 
 * 对应工作包: WP4.1 / WP4.2
 * 适用接口:
 * - GET  /api/v1/alarms (列表分页与多维筛选)
 * - GET  /api/v1/alarms/:id (详情与处置审计历史)
 * - POST /api/v1/alarms/:id:ack (操作员确认)
 * - POST /api/v1/alarms/:id:handle (登记处置意见)
 * - POST /api/v1/alarms/:id:review (复核审批/回退)
 * - POST /api/v1/alarms:aggregate (触发缺陷段防抖聚合)
 */

export type AlarmSeverity = 'INFO' | 'WARN' | 'CRITICAL' | 'FATAL';
export type AlarmLifecycle = 'ACTIVE' | 'RECOVERED';
export type AlarmHandlingState = 'PENDING' | 'PROCESSING' | 'HANDLED' | 'REVIEWED';

export interface AlarmItem {
  id: string;
  factory_id: string;
  device_id: string;
  task_id: string | null;
  spool_id: string | null;
  work_order_id: string | null;
  source_alarm_key: string | null;
  alarm_type: string;
  metric_code: string;
  severity: AlarmSeverity;
  lifecycle: AlarmLifecycle;
  handling_state: AlarmHandlingState;
  sample_count: number;
  start_position_m: string; // 保证高精度小数字符串，如 "120.450"
  end_position_m: string;   // 保证高精度小数字符串，如 "122.100"
  peak_value: string;       // 保证高精度小数字符串，如 "3.850"
  unit: string;             // 如 "mm" 或 "%"
  acknowledged_at: string | null; // ISO UTC
  acknowledged_by: string | null;
  triggered_at: string;     // ISO UTC
  recovered_at: string | null; // ISO UTC
  version: number;
  created_at: string;
}

export interface AlarmAction {
  id: string;
  action: 'TRIGGER' | 'ACKNOWLEDGE' | 'HANDLE' | 'REVIEW' | 'AUTO_RECOVER';
  actor_id: string;
  actor_name: string;
  from_state: AlarmHandlingState;
  to_state: AlarmHandlingState;
  opinion: string | null;
  evidence_refs: Array<{ name: string; url: string }> | null;
  occurred_at: string; // ISO UTC
}

export interface AlarmDetail extends AlarmItem {
  actions: AlarmAction[];
}

export interface AlarmFilterParams {
  handling_state?: AlarmHandlingState;
  lifecycle?: AlarmLifecycle;
  metric_code?: string;
  device_id?: string;
  task_id?: string;
  severity?: AlarmSeverity;
  limit?: number; // 默认 50，最大 100
  after_id?: string;
}

export interface AlarmListResponse {
  items: AlarmItem[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface HandleAlarmDto {
  opinion: string;
  action_plan?: string;
  evidence_refs?: Array<{ name: string; url: string }>;
}

export interface ReviewAlarmDto {
  approved: boolean;
  opinion: string;
}

export interface AlarmAggregateResult {
  fail_points_scanned: number;
  alarms_created: number;
  alarms_updated: number;
  total_active_alarms: number;
}
