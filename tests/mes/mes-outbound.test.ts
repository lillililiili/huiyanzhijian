import test from 'node:test';
import assert from 'node:assert/strict';
import { MesClient, type MesInspectionPayload } from '../../apps/platform/modules/m07-mes/client';
import { computeDeliveryStatus } from '../../apps/platform/modules/m07-mes/service';

const validReport: MesInspectionPayload = {
  delivery_id: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  send_time: '2026-10-28T10:40:00.000Z',
  factory_code: 'FACTORY-01',
  work_order_code: 'WO-20261028-001',
  spool_code: 'SPOOL-20261028-01',
  specification_code: 'SP035-400',
  product_name: '35kV 高压电力电缆',
  inspection_scope: {
    total_length_m: 1000.0,
    effective_coverage_m: 998.5,
  },
  overall_verdict: 'PASS',
  metric_results: [
    {
      metric_code: 'SHIELD_OVERLAP_RATE',
      metric_name: '金属屏蔽铜带搭盖率',
      unit: '%',
      sample_count: 2000,
      failed_count: 0,
      mean_value: 14.85,
      min_value: 11.2,
      max_value: 18.5,
      verdict: 'PASS',
    },
    {
      metric_code: 'WIRE_GAP',
      metric_name: '铜丝屏蔽相邻间隙',
      unit: 'mm',
      sample_count: 2000,
      failed_count: 0,
      mean_value: 1.15,
      min_value: 0.8,
      max_value: 2.45,
      verdict: 'PASS',
    },
    {
      metric_code: 'OVALITY',
      metric_name: '电缆不圆度',
      unit: '%',
      sample_count: 2000,
      failed_count: 0,
      mean_value: 1.25,
      min_value: 0.35,
      max_value: 3.1,
      verdict: 'PASS',
    },
  ],
};

test('M07 MES Client: signature calculation and successful ACK handshake', async () => {
  const client = new MesClient({
    endpointUrl: 'http://mes-mock.local/api/qc/reports',
    apiToken: 'test-token-12345',
    secretKey: 'my-mes-secret-key',
  });

  let capturedHeaders: any = null;
  let capturedBody: any = null;

  const mockFetch: typeof fetch = async (input, init) => {
    capturedHeaders = init?.headers;
    capturedBody = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({
        code: 0,
        message: 'SUCCESS',
        data: {
          ack_code: 'MES-ACK-TEST-001',
          status: 'ACCEPTED',
        },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await client.deliverReport(validReport, 'IDEMP-001', mockFetch);

  assert.equal(result.success, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.ackCode, 'MES-ACK-TEST-001');

  // Verify headers
  assert.equal(capturedHeaders['Authorization'], 'Bearer test-token-12345');
  assert.equal(capturedHeaders['X-Idempotency-Key'], 'IDEMP-001');
  assert.ok(capturedHeaders['X-Signature'], 'Signature must be present');

  // Verify signature
  const expectedSig = client.generateSignature(JSON.stringify(validReport));
  assert.equal(capturedHeaders['X-Signature'], expectedSig);
  assert.equal(capturedBody.spool_code, 'SPOOL-20261028-01');
});

test('M07 MES Client: error response handling', async () => {
  const client = new MesClient({
    endpointUrl: 'http://mes-mock.local/api/qc/reports',
    apiToken: 'test-token-12345',
    secretKey: 'my-mes-secret-key',
  });

  const mockErrorFetch: typeof fetch = async () => {
    return new Response(
      JSON.stringify({
        error_code: 'INVALID_ORDER',
        message: 'Work order does not exist in MES',
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  };

  const result = await client.deliverReport(validReport, 'IDEMP-002', mockErrorFetch);
  assert.equal(result.success, false);
  assert.equal(result.httpStatus, 400);
  assert.equal(result.errorCode, 'INVALID_ORDER');
  assert.equal(result.errorMessage, 'Work order does not exist in MES');
});

test('M07 MES State Mapping: computeDeliveryStatus correctly maps SENT, ACKNOWLEDGED, REJECTED, RETRYING', () => {
  // 1. 已获取 ACK
  assert.equal(computeDeliveryStatus({ state: 'SENT', business_ack: 'MES-ACK-001' }), 'ACKNOWLEDGED');

  // 2. 发送成功尚未有 ACK
  assert.equal(computeDeliveryStatus({ state: 'SENT', business_ack: null }), 'SENT');

  // 3. 待处理
  assert.equal(computeDeliveryStatus({ state: 'PENDING' }), 'PENDING');

  // 4. 发送中
  assert.equal(computeDeliveryStatus({ state: 'SENDING' }), 'SENDING');

  // 5. 失败且处于指数退避期 (重试中)
  assert.equal(
    computeDeliveryStatus({
      state: 'FAILED',
      attempt_count: 2,
      max_attempts: 5,
      next_attempt_at: new Date(Date.now() + 60000).toISOString(),
      last_error: 'ETIMEDOUT',
    }),
    'RETRYING'
  );

  // 6. 业务拒绝 (400 / INVALID_SPOOL_CODE)
  assert.equal(
    computeDeliveryStatus({
      state: 'FAILED',
      attempt_count: 1,
      max_attempts: 5,
      last_error: 'INVALID_SPOOL_CODE',
    }),
    'REJECTED'
  );
});
