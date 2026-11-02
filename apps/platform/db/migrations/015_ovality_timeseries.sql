-- TS01: keep relational identities/evaluations; only OVALITY samples may be external.
ALTER TABLE m04.measurement_value ADD COLUMN sample_storage text NOT NULL DEFAULT 'POSTGRESQL'
 CHECK(sample_storage IN ('POSTGRESQL','INFLUXDB'));
DO $$ DECLARE c record; BEGIN
 FOR c IN SELECT conname FROM pg_constraint WHERE conrelid='m04.measurement_value'::regclass AND contype='c'
 AND pg_get_constraintdef(oid) LIKE '%value IS NOT NULL%' LOOP
 EXECUTE format('ALTER TABLE m04.measurement_value DROP CONSTRAINT %I',c.conname);
 END LOOP;
END $$;
ALTER TABLE m04.measurement_value ADD CONSTRAINT measurement_value_storage_valid CHECK (
 (sample_storage='INFLUXDB' AND metric_code='OVALITY' AND value IS NULL)
 OR (sample_storage='POSTGRESQL' AND ((data_status='VALID' AND value IS NOT NULL) OR (data_status<>'VALID' AND value IS NULL)))
);
-- Runtime retains SELECT/INSERT only: storage relocation uses migration credentials.
