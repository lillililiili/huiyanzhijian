-- RULE01: immutable versions/metadata, independently mutable activation state.
CREATE TABLE m03.recipe_metadata(
 recipe_version_id text PRIMARY KEY REFERENCES m03.recipe_version(id),
 factory_id text NOT NULL,group_id text NOT NULL,code text NOT NULL,name text NOT NULL,
 version_number integer NOT NULL CHECK(version_number>0),unit text NOT NULL,
 specification_ids text[] NOT NULL DEFAULT '{}',standard_reference text NOT NULL,
 reason text NOT NULL,actor_id text,request_id text,
 UNIQUE(factory_id,group_id,version_number)
);
CREATE INDEX recipe_code_lookup ON m03.recipe_metadata(factory_id,lower(code));
CREATE TABLE m03.recipe_state(recipe_version_id text PRIMARY KEY REFERENCES m03.recipe_version(id),enabled boolean NOT NULL DEFAULT true,version bigint NOT NULL DEFAULT 1);
CREATE TABLE m03.recipe_state_event(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,factory_id text NOT NULL,recipe_version_id text NOT NULL REFERENCES m03.recipe_version(id),enabled boolean NOT NULL,version bigint NOT NULL,actor_id text NOT NULL,request_id text NOT NULL,reason text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE m03.recipe_command_receipt(factory_id text NOT NULL,actor_id text NOT NULL,command_key text NOT NULL,payload_hash char(64) NOT NULL,response jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(factory_id,actor_id,command_key));
INSERT INTO m03.recipe_metadata(recipe_version_id,factory_id,group_id,code,name,version_number,unit,standard_reference,reason)
 SELECT r.id,r.factory_id,r.id,r.id,coalesce(r.source_metadata->>'name',d.name),1,d.unit,'历史演示配置；非已批准生产标准','RULE01接管既有版本，原快照保持不变' FROM m03.recipe_version r JOIN m03.metric_definition d ON d.code=r.metric_code;
INSERT INTO m03.recipe_state(recipe_version_id) SELECT id FROM m03.recipe_version;
GRANT SELECT,INSERT ON m03.recipe_metadata,m03.recipe_state_event,m03.recipe_command_receipt TO hy_runtime;
GRANT SELECT,INSERT,UPDATE ON m03.recipe_state TO hy_runtime;
GRANT USAGE,SELECT ON SEQUENCE m03.recipe_state_event_id_seq TO hy_runtime;
UPDATE m00.app_role SET permission_codes=array_append(permission_codes,'rules:write') WHERE code='admin' AND NOT ('rules:write'=ANY(permission_codes));
