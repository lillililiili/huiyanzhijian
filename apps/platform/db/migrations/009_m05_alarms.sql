-- M05: Industrial Alarm lifecycle engine, debounce/cluster & quality handling
CREATE SCHEMA IF NOT EXISTS m05;

CREATE TABLE m05.alarm_event(
  id text PRIMARY KEY,
  factory_id text NOT NULL,
  device_id text NOT NULL,
  task_id text,
  spool_id text,
  work_order_id text,
  source_alarm_key text NOT NULL,
  alarm_type text NOT NULL CHECK(alarm_type IN('QUALITY','DEVICE','DATA')),
  metric_code text NOT NULL CHECK(metric_code IN('SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY')),
  severity text NOT NULL CHECK(severity IN('WARNING','CRITICAL','FATAL')),
  lifecycle text NOT NULL CHECK(lifecycle IN('ACTIVE','RECOVERED')),
  handling_state text NOT NULL CHECK(handling_state IN('PENDING','PROCESSING','HANDLED','REVIEWED')),
  sample_count integer NOT NULL DEFAULT 1,
  start_position_m numeric(24,10),
  end_position_m numeric(24,10),
  peak_value numeric(24,10),
  unit text NOT NULL,
  acknowledged_at timestamptz,
  acknowledged_by text,
  triggered_at timestamptz NOT NULL DEFAULT now(),
  recovered_at timestamptz,
  trigger_snapshot jsonb NOT NULL DEFAULT '{}',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, device_id, source_alarm_key)
);

CREATE INDEX alarm_factory_state ON m05.alarm_event(factory_id, handling_state, triggered_at DESC);
CREATE INDEX alarm_task ON m05.alarm_event(factory_id, task_id);

CREATE TABLE m05.alarm_action(
  id uuid PRIMARY KEY,
  alarm_id text NOT NULL REFERENCES m05.alarm_event(id),
  action text NOT NULL CHECK(action IN('TRIGGER','ACKNOWLEDGE','HANDLE','REVIEW','RECOVER')),
  actor_id text NOT NULL,
  actor_name text,
  from_state text,
  to_state text NOT NULL,
  opinion text,
  evidence_refs jsonb NOT NULL DEFAULT '[]',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  command_key text
);

CREATE INDEX alarm_action_alarm ON m05.alarm_action(alarm_id, occurred_at);

CREATE TABLE m05.alarm_command_receipt(
  factory_id text NOT NULL,
  actor_id text NOT NULL,
  command_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(factory_id, actor_id, command_key)
);

GRANT USAGE ON SCHEMA m05 TO hy_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA m05 TO hy_runtime;

UPDATE m00.app_role SET permission_codes=array_append(permission_codes,'alarms:read') WHERE NOT ('alarms:read'=ANY(permission_codes));
UPDATE m00.app_role SET permission_codes=array_append(permission_codes,'alarms:write') WHERE code IN ('admin', 'quality') AND NOT ('alarms:write'=ANY(permission_codes));
