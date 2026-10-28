/**
 * M05 工业级报警生命周期引擎 - 前端类型定义
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
  start_position_m: string; // 保证高精度小数字符串，如 "10.0000000000"
  end_position_m: string;   // 保证高精度小数字符串，如 "11.5000000000"
  peak_value: string;       // 保证高精度小数字符串，如 "18.1818181818"
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
  limit?: number;
  after_id?: string;
}

export interface AlarmListResponse {
  items: AlarmItem[];
  has_more: boolean;
  next_cursor: string | null;
  as_of?: string;
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
  total_fail_points: number;
  created_alarms: number;
  updated_alarms: number;
}

export const handlingStateMeta: Record<AlarmHandlingState, { label: string; tone: 'red' | 'amber' | 'blue' | 'green'; desc: string }> = {
  PENDING: { label: '待确认', tone: 'red', desc: '新触发的超限缺陷段，等待操作员响应' },
  PROCESSING: { label: '处置中', tone: 'amber', desc: '操作员已确认看到，正在排查原因与整改' },
  HANDLED: { label: '待主管复核', tone: 'blue', desc: '已提交处置整改方案，等待质检主管复核' },
  REVIEWED: { label: '已复核结案', tone: 'green', desc: '主管已审批闭环，整改归档' }
};

export const severityMeta: Record<AlarmSeverity, { label: string; tone: 'red' | 'amber' | 'blue' | 'neutral' }> = {
  FATAL: { label: '致命超标', tone: 'red' },
  CRITICAL: { label: '严重缺陷', tone: 'red' },
  WARN: { label: '超限警告', tone: 'amber' },
  INFO: { label: '工艺提示', tone: 'blue' }
};

export const actionNames: Record<string, string> = {
  TRIGGER: '触发报警',
  ACKNOWLEDGE: '操作员确认',
  HANDLE: '登记处置',
  REVIEW: '主管复核',
  AUTO_RECOVER: '系统自动恢复'
};
