-- CAT01: M01 owns directory commands and append-only revision history.
ALTER TABLE m01.product_specification ADD COLUMN cable_model text NOT NULL DEFAULT '', ADD COLUMN customer_code text NOT NULL DEFAULT '', ADD COLUMN product_type text NOT NULL DEFAULT '', ADD COLUMN description text NOT NULL DEFAULT '', ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE m01.device ADD COLUMN manufacturer text NOT NULL DEFAULT '', ADD COLUMN serial_number text NOT NULL DEFAULT '', ADD COLUMN firmware text NOT NULL DEFAULT '', ADD COLUMN notes text NOT NULL DEFAULT '', ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE m01.catalog_command_receipt(factory_id text NOT NULL,actor_id text NOT NULL,command_key text NOT NULL,payload_hash char(64) NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(factory_id,actor_id,command_key));
CREATE TABLE m01.catalog_revision(factory_id text NOT NULL,kind text NOT NULL CHECK(kind IN('specifications','devices')),object_id text NOT NULL,version bigint NOT NULL,snapshot jsonb NOT NULL,actor_id text,request_id text NOT NULL,reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(factory_id,kind,object_id,version));
GRANT SELECT,INSERT ON m01.catalog_command_receipt,m01.catalog_revision TO hy_runtime;
GRANT DELETE ON m01.specification_applicability TO hy_runtime;
UPDATE m00.app_role SET permission_codes=array_append(permission_codes,'catalog:write') WHERE code='admin' AND NOT ('catalog:write'=ANY(permission_codes));
