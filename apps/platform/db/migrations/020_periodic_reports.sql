-- REP03: immutable customer report snapshots; existing reports and facts remain intact.
CREATE TABLE m06.periodic_report(
 id uuid PRIMARY KEY, factory_id text NOT NULL, report_code text NOT NULL,
 kind text NOT NULL CHECK(kind IN('DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','WORK_ORDER')),
 scope jsonb NOT NULL, snapshot jsonb NOT NULL, snapshot_hash char(64) NOT NULL,
 generated_by text NOT NULL, command_key text NOT NULL, request_hash char(64) NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(factory_id,report_code), UNIQUE(factory_id,generated_by,command_key)
);
CREATE INDEX periodic_report_list ON m06.periodic_report(factory_id,created_at DESC,id);
GRANT SELECT,INSERT ON m06.periodic_report TO hy_runtime;
