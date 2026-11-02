-- EDGE05: M09 owns desired synchronization and delivery receipts. No measurement rewrite.
CREATE SCHEMA IF NOT EXISTS m09;
CREATE TABLE m09.edge_point_sync (
 factory_id text NOT NULL,
 device_id text NOT NULL,
 delay_ms double precision NOT NULL CHECK(delay_ms>=0 AND delay_ms<=3600000),
 tolerance_ms double precision NOT NULL CHECK(tolerance_ms>=0 AND tolerance_ms<=5000),
 upstream_gauge text NOT NULL CHECK(upstream_gauge IN('A','B')),
 version bigint NOT NULL DEFAULT 1,
 updated_at timestamptz NOT NULL DEFAULT now(),
 delivered_version bigint,
 active_version bigint,
 delivery_state text NOT NULL DEFAULT 'PENDING',
 last_attempt_at timestamptz,
 delivered_at timestamptz,
 last_error text,
 PRIMARY KEY(factory_id,device_id)
);
GRANT USAGE ON SCHEMA m09 TO hy_runtime;
GRANT SELECT,INSERT,UPDATE ON m09.edge_point_sync TO hy_runtime;
