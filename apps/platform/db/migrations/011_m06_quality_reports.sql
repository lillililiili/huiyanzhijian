-- M06: Quality Reports, Traceability Snapshots & Integrity Verification
CREATE SCHEMA IF NOT EXISTS m06;

CREATE TABLE m06.report_template_version(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL,
  template_code text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  signatory_label text,
  footer text,
  sections jsonb NOT NULL DEFAULT '{"summary":true,"metrics":true,"defects":true,"signatures":true}'::jsonb,
  format_settings jsonb NOT NULL DEFAULT '{"decimals":3,"units":{"overlap_ratio":"%","wire_gap":"mm","roundness":"%"},"timezone":"Asia/Shanghai"}'::jsonb,
  approval_state text NOT NULL DEFAULT 'APPROVED' CHECK(approval_state IN('DRAFT','APPROVED','RETIRED')),
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, template_code, revision)
);

CREATE TABLE m06.quality_report(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL,
  report_code text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  report_kind text NOT NULL DEFAULT 'TASK_FINAL' CHECK(report_kind IN('STAGE','TASK_FINAL','SPOOL_SUMMARY')),
  data_environment text NOT NULL DEFAULT 'SIMULATED' CHECK(data_environment IN('SIMULATED','REAL')),
  spool_id text NOT NULL,
  work_order_id text,
  task_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  template_version_id uuid REFERENCES m06.report_template_version(id),
  template_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  format_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  coverage_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  input_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  statistics jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'GENERATED' CHECK(state IN('DRAFT','GENERATED','PUBLISHED','FAILED')),
  final_result text NOT NULL DEFAULT 'PASS' CHECK(final_result IN('PASS','FAIL','CONDITIONAL')),
  artifact_key text,
  artifact_hash char(64),
  snapshot_hash char(64) NOT NULL,
  query_cutoff timestamptz NOT NULL DEFAULT now(),
  generated_by text NOT NULL,
  published_by text,
  published_at timestamptz,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, report_code, revision)
);

CREATE TABLE m06.report_command_receipt(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factory_id text NOT NULL,
  actor_id text NOT NULL,
  command_key text NOT NULL,
  payload_hash char(64) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(factory_id, actor_id, command_key)
);

CREATE INDEX idx_m06_qr_spool ON m06.quality_report(factory_id, spool_id, created_at DESC);
CREATE INDEX idx_m06_qr_wo ON m06.quality_report(factory_id, work_order_id);
CREATE INDEX idx_m06_qr_state ON m06.quality_report(factory_id, state);

GRANT USAGE ON SCHEMA m06 TO hy_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA m06 TO hy_runtime;

-- 插入默认标准报告模板
INSERT INTO m06.report_template_version(factory_id, template_code, revision, title, signatory_label, footer, approval_state, approved_by, approved_at)
VALUES(
  'factory-local',
  'DEFAULT_STANDARD',
  1,
  '高压电缆铠装与挤塑工序质量检验与追溯报告',
  '质检员 / 质检主管 / 生产班组长',
  '慧眼智检数字化质量追溯系统自动生成 · 工业级数据快照指纹防伪',
  'APPROVED',
  'system',
  now()
) ON CONFLICT DO NOTHING;

-- 兼容 quality_report_snapshot 与 report_approval 视图
CREATE OR REPLACE VIEW m06.quality_report_snapshot AS SELECT * FROM m06.quality_report;
GRANT SELECT, INSERT, UPDATE, DELETE ON m06.quality_report_snapshot TO hy_runtime;

CREATE OR REPLACE VIEW m06.report_approval AS
SELECT id, id AS report_id, factory_id, state AS approval_state,
       generated_by, published_by AS approved_by, published_at AS approved_at,
       created_at, updated_at
FROM m06.quality_report;
GRANT SELECT, INSERT, UPDATE, DELETE ON m06.report_approval TO hy_runtime;

-- 授权默认角色 reports:read 与 reports:write
UPDATE m00.app_role
SET permission_codes = array_cat(permission_codes, ARRAY['reports:read','reports:write'])
WHERE code IN('admin', 'quality') AND NOT (permission_codes @> ARRAY['reports:read']);

UPDATE m00.app_role
SET permission_codes = array_append(permission_codes, 'reports:read')
WHERE code = 'viewer' AND NOT (permission_codes @> ARRAY['reports:read']);
