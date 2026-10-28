-- M07: Customer MES Outbound Delivery, Business ACK & Reconciliation
CREATE SCHEMA IF NOT EXISTS m07;

CREATE TABLE m07.mes_endpoint(
  id text PRIMARY KEY,
  factory_id text NOT NULL,
  code text NOT NULL,
  name text NOT NULL,
  base_url text NOT NULL,
  api_token text NOT NULL,
  secret_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  timeout_ms integer NOT NULL DEFAULT 5000,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, code)
);

CREATE TABLE m07.mes_delivery(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL,
  endpoint_id text REFERENCES m07.mes_endpoint(id),
  task_id text,
  spool_id text,
  work_order_id text,
  business_key text NOT NULL,
  message_type text NOT NULL CHECK(message_type IN('INSPECTION_REPORT','ALARM_EVENT','QUALITY_SUMMARY')),
  state text NOT NULL CHECK(state IN('PENDING','SENDING','SENT','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5,
  next_attempt_at timestamptz,
  business_ack text,
  acked_at timestamptz,
  last_error text,
  payload jsonb NOT NULL,
  payload_hash char(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, business_key)
);

CREATE INDEX mes_delivery_factory_state ON m07.mes_delivery(factory_id, state, created_at DESC);
CREATE INDEX mes_delivery_task ON m07.mes_delivery(factory_id, task_id);

GRANT USAGE ON SCHEMA m07 TO hy_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA m07 TO hy_runtime;

-- 插入默认模拟 MES 接收端配置
INSERT INTO m07.mes_endpoint(id, factory_id, code, name, base_url, api_token, secret_key)
VALUES(
  'mes-mock-default',
  'factory-local',
  'MES-SIMULATOR',
  '厂区MES模拟对接端点',
  'http://127.0.0.1:4192/api/v1/mes/mock-receiver',
  'TOKEN-MES-20261028',
  'SECRET-MES-KEY-001'
) ON CONFLICT DO NOTHING;

-- 兼容 measurement_outbox 出站表视图
CREATE OR REPLACE VIEW m07.measurement_outbox AS SELECT * FROM m07.mes_delivery;
GRANT SELECT, INSERT, UPDATE, DELETE ON m07.measurement_outbox TO hy_runtime;
