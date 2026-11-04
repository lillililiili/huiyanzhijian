-- DB01: forward repair; recovered 001/010/011 hashes remain unchanged.
-- Between deployed 016 and unreleased 017; views do not grant writes to immutable facts.

-- 兼容 measurement_raw 视图
CREATE OR REPLACE VIEW m04.measurement_raw AS SELECT * FROM m04.measurement_record;
GRANT SELECT ON m04.measurement_raw TO hy_runtime;


-- 兼容 measurement_outbox 出站表视图
CREATE OR REPLACE VIEW m07.measurement_outbox AS SELECT * FROM m07.mes_delivery;
GRANT SELECT ON m07.measurement_outbox TO hy_runtime;


-- 兼容 quality_report_snapshot 与 report_approval 视图
CREATE OR REPLACE VIEW m06.quality_report_snapshot AS SELECT * FROM m06.quality_report;
GRANT SELECT ON m06.quality_report_snapshot TO hy_runtime;

CREATE OR REPLACE VIEW m06.report_approval AS
SELECT id, id AS report_id, factory_id, state AS approval_state,
       generated_by, published_by AS approved_by, published_at AS approved_at,
       created_at, updated_at
FROM m06.quality_report;
GRANT SELECT ON m06.report_approval TO hy_runtime;

-- 授权默认角色 reports:read 与 reports:write
UPDATE m00.app_role
SET permission_codes = array_cat(permission_codes, ARRAY['reports:read','reports:write'])
WHERE code IN('admin', 'quality') AND NOT (permission_codes @> ARRAY['reports:read']);

UPDATE m00.app_role
SET permission_codes = array_append(permission_codes, 'reports:read')
WHERE code = 'viewer' AND NOT (permission_codes @> ARRAY['reports:read']);
