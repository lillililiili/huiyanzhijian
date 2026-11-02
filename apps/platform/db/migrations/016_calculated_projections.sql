-- PERF01: derived data only. Original facts, evaluations and reports are immutable.
CREATE TABLE m04.measurement_projection (
 record_id text PRIMARY KEY REFERENCES m04.measurement_record(id),
 numeric_value numeric, sheath_result jsonb,
 calculation_version text NOT NULL,
 calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE m04.task_statistics (
 factory_id text NOT NULL, task_id text NOT NULL,
 total bigint NOT NULL, valid bigint NOT NULL, invalid bigint NOT NULL,
 passed bigint NOT NULL, failed bigint NOT NULL, unevaluated bigint NOT NULL, quarantined bigint NOT NULL,
 first_sample_at timestamptz NOT NULL, latest_sample_at timestamptz NOT NULL,
 metric_code text NOT NULL, unit text NOT NULL,
 value_count bigint NOT NULL, value_sum numeric NOT NULL, minimum numeric, maximum numeric,
 all_value_count bigint NOT NULL, all_value_sum numeric NOT NULL, all_minimum numeric, all_maximum numeric,
 updated_at timestamptz NOT NULL DEFAULT now(), calculation_version text NOT NULL,
 PRIMARY KEY(factory_id,task_id)
);
CREATE FUNCTION m04.accumulate_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; usable boolean; all_usable boolean;
BEGIN
 SELECT m.*,v.metric_code,v.unit,v.data_status AS value_status,e.quality_result INTO STRICT r
 FROM m04.measurement_record m JOIN m04.measurement_value v ON v.record_id=m.id
 JOIN m04.measurement_evaluation e ON e.record_id=m.id AND e.version=1 WHERE m.id=NEW.record_id;
 IF r.task_id IS NULL THEN RETURN NEW; END IF;
 all_usable := r.value_status='VALID' AND NEW.numeric_value IS NOT NULL;
 usable := all_usable AND r.receipt_status='STORED';
 INSERT INTO m04.task_statistics AS s(factory_id,task_id,total,valid,invalid,passed,failed,unevaluated,quarantined,
 first_sample_at,latest_sample_at,metric_code,unit,value_count,value_sum,minimum,maximum,
 all_value_count,all_value_sum,all_minimum,all_maximum,calculation_version)
 VALUES(r.factory_id,r.task_id,1,(r.value_status='VALID')::int,(r.value_status<>'VALID')::int,
 (r.quality_result='PASS')::int,(r.quality_result='FAIL')::int,(r.quality_result='NOT_EVALUATED')::int,
 (r.receipt_status='QUARANTINED')::int,r.sample_time,r.sample_time,r.metric_code,r.unit,
 usable::int,CASE WHEN usable THEN NEW.numeric_value ELSE 0 END,
 CASE WHEN usable THEN NEW.numeric_value END,CASE WHEN usable THEN NEW.numeric_value END,
 all_usable::int,CASE WHEN all_usable THEN NEW.numeric_value ELSE 0 END,
 CASE WHEN all_usable THEN NEW.numeric_value END,CASE WHEN all_usable THEN NEW.numeric_value END,NEW.calculation_version)
 ON CONFLICT(factory_id,task_id) DO UPDATE SET
 total=s.total+1,valid=s.valid+EXCLUDED.valid,invalid=s.invalid+EXCLUDED.invalid,
 passed=s.passed+EXCLUDED.passed,failed=s.failed+EXCLUDED.failed,unevaluated=s.unevaluated+EXCLUDED.unevaluated,
 quarantined=s.quarantined+EXCLUDED.quarantined,
 first_sample_at=LEAST(s.first_sample_at,EXCLUDED.first_sample_at),latest_sample_at=GREATEST(s.latest_sample_at,EXCLUDED.latest_sample_at),
 value_count=s.value_count+EXCLUDED.value_count,value_sum=s.value_sum+EXCLUDED.value_sum,
 minimum=LEAST(s.minimum,EXCLUDED.minimum),maximum=GREATEST(s.maximum,EXCLUDED.maximum),
 all_value_count=s.all_value_count+EXCLUDED.all_value_count,all_value_sum=s.all_value_sum+EXCLUDED.all_value_sum,
 all_minimum=LEAST(s.all_minimum,EXCLUDED.all_minimum),all_maximum=GREATEST(s.all_maximum,EXCLUDED.all_maximum),updated_at=now();
 RETURN NEW;
END $$;
CREATE TRIGGER projection_accumulated AFTER INSERT ON m04.measurement_projection
 FOR EACH ROW EXECUTE FUNCTION m04.accumulate_projection();
GRANT SELECT,INSERT ON m04.measurement_projection TO hy_runtime;
GRANT SELECT,INSERT,UPDATE ON m04.task_statistics TO hy_runtime;
