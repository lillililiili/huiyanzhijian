-- M02 / ODM03: append-only vendor production order to capture binding.
CREATE TABLE m02.odm_order_binding(
 factory_id text NOT NULL,
 device_id text NOT NULL,
 line_id text NOT NULL CHECK(length(line_id) BETWEEN 1 AND 128),
 task_id text NOT NULL UNIQUE REFERENCES m02.inspection_task(id),
 binding_id text NOT NULL UNIQUE REFERENCES m02.task_device_binding(id),
 metric_code text NOT NULL CHECK(metric_code IN ('SHIELD_OVERLAP_RATE','WIRE_GAP')),
 created_at timestamptz(6) NOT NULL DEFAULT now(),
 PRIMARY KEY(factory_id,device_id,line_id)
);
GRANT SELECT,INSERT ON m02.odm_order_binding TO hy_runtime;
