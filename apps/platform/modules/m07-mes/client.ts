import { createHmac, randomUUID } from 'node:crypto';

export interface MesConfig {
  endpointUrl: string;
  apiToken: string;
  secretKey: string;
  timeoutMs?: number;
}

export interface MesInspectionPayload {
  delivery_id: string;
  send_time: string;
  factory_code: string;
  work_order_code: string;
  spool_code: string;
  specification_code: string;
  product_name?: string;
  inspection_scope: {
    total_length_m: number;
    effective_coverage_m: number;
    start_time?: string;
    end_time?: string;
  };
  overall_verdict: 'PASS' | 'FAIL';
  metric_results: Array<{
    metric_code: 'SHIELD_OVERLAP_RATE' | 'WIRE_GAP' | 'OVALITY';
    metric_name?: string;
    unit: string;
    sample_count: number;
    failed_count: number;
    rule_expression?: string;
    mean_value: number | null;
    min_value: number | null;
    max_value: number | null;
    verdict: 'PASS' | 'FAIL' | 'NOT_EVALUATED';
  }>;
  inspector?: {
    operator_name?: string;
    operator_id?: string;
  };
}

export interface MesDeliveryResult {
  success: boolean;
  httpStatus?: number;
  ackCode?: string;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
}

/**
 * M07 客户 MES 出站投递客户端
 */
export class MesClient {
  constructor(private readonly config: MesConfig) {}

  /**
   * 生成报文防篡改 HMAC-SHA256 签名
   */
  generateSignature(rawBody: string): string {
    return createHmac('sha256', this.config.secretKey).update(rawBody).digest('hex');
  }

  /**
   * 向客户 MES 系统发送质检完工数据包
   */
  async deliverReport(
    payload: MesInspectionPayload,
    idempotencyKey: string = payload.delivery_id || randomUUID(),
    fetchFn: typeof fetch = fetch
  ): Promise<MesDeliveryResult> {
    const rawBody = JSON.stringify(payload);
    const signature = this.generateSignature(rawBody);
    const startTime = Date.now();

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.config.apiToken}`,
      'X-Idempotency-Key': idempotencyKey,
      'X-Signature': signature,
    };

    try {
      const response = await fetchFn(this.config.endpointUrl, {
        method: 'POST',
        headers,
        body: rawBody,
        signal: AbortSignal.timeout(this.config.timeoutMs || 5000),
      });

      const durationMs = Date.now() - startTime;
      const text = await response.text();
      let resJson: any = null;
      try {
        resJson = JSON.parse(text);
      } catch {
        // Not a JSON response
      }

      const isSuccess = response.ok &&
        (!resJson?.code || resJson?.code === 0 || resJson?.code === 'OK') &&
        (!resJson?.data?.code || resJson?.data?.code === 0) &&
        !resJson?.error_code && !resJson?.data?.error_code;

      if (isSuccess) {
        return {
          success: true,
          httpStatus: response.status,
          ackCode: resJson?.data?.data?.ack_code || resJson?.data?.ack_code || resJson?.ack_code || `MES-ACK-${idempotencyKey.slice(0, 8).toUpperCase()}`,
          durationMs,
        };
      }

      const errCode = resJson?.data?.error_code || resJson?.error_code || 'HTTP_ERROR';
      const errMsg = resJson?.data?.message || resJson?.message || text.slice(0, 200);

      return {
        success: false,
        httpStatus: response.status === 200 ? 400 : response.status,
        errorCode: errCode,
        errorMessage: errMsg,
        durationMs,
      };
    } catch (err: any) {
      return {
        success: false,
        errorCode: err.name === 'TimeoutError' ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: err.message,
        durationMs: Date.now() - startTime,
      };
    }
  }
}
