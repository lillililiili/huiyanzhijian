-- HT03: two independent result tasks, one physical acquisition/binding.
INSERT INTO m03.metric_definition(code,name,unit,display_scale)
VALUES('SHEATH_THICKNESS','护套厚度','mm',6) ON CONFLICT(code) DO NOTHING;
ALTER TABLE m02.inspection_task ADD COLUMN acquisition_source_task_id text REFERENCES m02.inspection_task(id);
ALTER TABLE m02.inspection_task ADD CONSTRAINT sheath_task_source CHECK
 ((metric_code='SHEATH_THICKNESS')=(acquisition_source_task_id IS NOT NULL));
CREATE UNIQUE INDEX one_sheath_task_per_acquisition ON m02.inspection_task(acquisition_source_task_id)
 WHERE acquisition_source_task_id IS NOT NULL;
DROP INDEX m02.one_running_task;
CREATE UNIQUE INDEX one_running_task ON m02.inspection_task(device_id)
 WHERE state='RUNNING' AND acquisition_source_task_id IS NULL;
ALTER TABLE m04.measurement_record ADD COLUMN derived_from_record_id text REFERENCES m04.measurement_record(id);
CREATE UNIQUE INDEX one_sheath_result_per_sample ON m04.measurement_record(derived_from_record_id)
 WHERE derived_from_record_id IS NOT NULL;
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='m04.measurement_record'::regclass AND contype='u'
 AND pg_get_constraintdef(oid) LIKE '%capture_sequence%' LOOP
 EXECUTE format('ALTER TABLE m04.measurement_record DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
CREATE UNIQUE INDEX source_capture_sequence ON m04.measurement_record(factory_id,device_id,capture_session_id,capture_sequence)
 WHERE derived_from_record_id IS NULL;
ALTER TABLE m04.measurement_value DROP CONSTRAINT measurement_value_metric_code_check;
ALTER TABLE m04.measurement_value ADD CONSTRAINT measurement_value_metric_code_check
 CHECK(metric_code IN('SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY','SHEATH_THICKNESS'));
