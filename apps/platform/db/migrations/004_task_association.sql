-- Business association is mutable; creation identity and acquisition facts are not.
ALTER TABLE m02.inspection_task ADD COLUMN original_spool_id text REFERENCES m02.cable_spool(id);
ALTER TABLE m02.inspection_task ADD COLUMN original_work_order_id text REFERENCES m02.work_order(id);
ALTER TABLE m02.inspection_task ADD COLUMN association_version bigint NOT NULL DEFAULT 1;
UPDATE m02.inspection_task SET original_spool_id=spool_id,original_work_order_id=work_order_id;
ALTER TABLE m02.inspection_task ALTER COLUMN original_spool_id SET NOT NULL;
ALTER TABLE m02.inspection_task ALTER COLUMN original_work_order_id SET NOT NULL;
CREATE FUNCTION m02.protect_task_origin() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  NEW.original_spool_id:=NEW.spool_id;
  NEW.original_work_order_id:=NEW.work_order_id;
 ELSIF NEW.original_spool_id IS DISTINCT FROM OLD.original_spool_id
    OR NEW.original_work_order_id IS DISTINCT FROM OLD.original_work_order_id
    OR NEW.context_snapshot IS DISTINCT FROM OLD.context_snapshot THEN
  RAISE EXCEPTION 'Task creation identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_origin BEFORE INSERT OR UPDATE ON m02.inspection_task
 FOR EACH ROW EXECUTE FUNCTION m02.protect_task_origin();
CREATE TABLE m02.task_association_change(
 id text PRIMARY KEY, factory_id text NOT NULL,
 task_id text NOT NULL REFERENCES m02.inspection_task(id),
 association_version bigint NOT NULL,task_version bigint NOT NULL,
 before_context jsonb NOT NULL,after_context jsonb NOT NULL,
 reason varchar(1000) NOT NULL CHECK(length(trim(reason))>0),
 actor_id text NOT NULL,request_id text NOT NULL,
 occurred_at timestamptz(6) NOT NULL DEFAULT now(),
 UNIQUE(task_id,association_version));
GRANT SELECT,INSERT ON m02.task_association_change TO hy_runtime;
