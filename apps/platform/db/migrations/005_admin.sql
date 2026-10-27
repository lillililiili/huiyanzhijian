ALTER TABLE m00.user_session ADD COLUMN active_factory text;
UPDATE m00.app_role SET permission_codes=ARRAY['data:read','task:write','audit:read','users:manage','settings:write','logs:read'] WHERE code='admin';
CREATE TABLE m00.admin_receipt(factory_id text NOT NULL,actor_id text NOT NULL,command_key text NOT NULL,payload_hash text NOT NULL,response jsonb NOT NULL,PRIMARY KEY(factory_id,actor_id,command_key));
CREATE TABLE m00.platform_config(factory_id text PRIMARY KEY,platform_name varchar(128) NOT NULL,organization_name varchar(128) NOT NULL,default_page_size integer NOT NULL CHECK(default_page_size IN(20,50,100)),version bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE m00.user_preference(user_id text PRIMARY KEY REFERENCES m00.app_user(id),page_size integer CHECK(page_size IN(20,50,100)),density text NOT NULL CHECK(density IN('comfortable','compact')),version bigint NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ops.runtime_log(id uuid PRIMARY KEY,factory_id text NOT NULL,service text NOT NULL DEFAULT 'platform-api',occurred_at timestamptz(6) NOT NULL DEFAULT now(),level text NOT NULL,request_id text NOT NULL,method text NOT NULL,route text NOT NULL,status integer NOT NULL,code text NOT NULL,duration_ms integer NOT NULL);
CREATE INDEX runtime_scope_time ON ops.runtime_log(factory_id,occurred_at DESC,id);
CREATE INDEX runtime_request ON ops.runtime_log(factory_id,request_id);
GRANT SELECT,INSERT ON m00.admin_receipt,ops.runtime_log TO hy_runtime;
GRANT SELECT,INSERT,UPDATE ON m00.platform_config,m00.user_preference TO hy_runtime;
GRANT DELETE ON m00.user_role TO hy_runtime;
CREATE FUNCTION ops.rotate_runtime_log() RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,ops AS $$
 DELETE FROM ops.runtime_log WHERE occurred_at<now()-interval '7 days' OR id IN(SELECT id FROM ops.runtime_log ORDER BY occurred_at DESC,id DESC OFFSET 100000);
$$;
REVOKE ALL ON FUNCTION ops.rotate_runtime_log() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ops.rotate_runtime_log() TO hy_runtime;
