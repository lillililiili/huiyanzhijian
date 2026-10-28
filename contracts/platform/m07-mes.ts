/**
 * M07 客户 MES 出站投递与对账 - 前后端共享契约定义
 * 
 * 对应工作包: WP4.3 / WP4.4
 * 适用接口:
 * - GET  /api/v1/mes/deliveries (出站投递列表与对账筛选)
 * - POST /api/v1/mes/enqueue-task (手动/自动将完工任务报告推入出站队列)
 * - POST /api/v1/mes/deliveries/:id:retry (投递失败手动重试)
 */

export type MesDeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'ACKED' | 'REJECTED';

export interface MesDeliveryItem {
  id: string;
  factory_id: string;
  business_key: string;       // 业务唯一键，如 "TASK:task-uuid-xxx"
  endpoint_id: string | null;
  payload: any;               // 按照 contracts/mes/v1/mes-inspection-report.schema.json 的完工报告载荷
  status: MesDeliveryStatus;
  retry_count: number;
  last_http_status: number | null;
  last_error: string | null;
  response_ack: any | null;   // MES 系统返回的业务 ACK 报文
  next_retry_at: string | null; // ISO UTC
  sent_at: string | null;     // ISO UTC
  created_at: string;         // ISO UTC
}

export interface MesDeliveryFilterParams {
  status?: MesDeliveryStatus;
  business_key?: string;
  limit?: number;
}

export interface MesEnqueueDto {
  task_id: string;
}

export interface MesRetryResult {
  id: string;
  status: MesDeliveryStatus;
  retry_count: number;
  last_http_status?: number;
  response_ack?: any;
  last_error?: string;
}
