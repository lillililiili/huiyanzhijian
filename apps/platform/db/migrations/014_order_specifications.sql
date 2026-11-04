-- Order owns an allowed specification set; every cable has exactly one.
ALTER TABLE m02.work_order ADD COLUMN specification_ids text[];
UPDATE m02.work_order SET specification_ids=ARRAY[specification_id];
ALTER TABLE m02.work_order ALTER COLUMN specification_ids SET NOT NULL;
ALTER TABLE m02.work_order ADD CONSTRAINT work_order_specs_nonempty CHECK(cardinality(specification_ids)>0);
ALTER TABLE m02.cable_spool ADD COLUMN specification_id text REFERENCES m01.product_specification(id);
UPDATE m02.cable_spool s SET specification_id=w.specification_id FROM m02.work_order w WHERE w.id=s.work_order_id;
ALTER TABLE m02.cable_spool ALTER COLUMN specification_id SET NOT NULL;
CREATE FUNCTION m02.order_specs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.specification_ids IS NULL THEN NEW.specification_ids:=ARRAY[NEW.specification_id]; END IF;
 IF cardinality(NEW.specification_ids)=0 OR EXISTS(SELECT 1 FROM unnest(NEW.specification_ids) x WHERE x IS NULL OR NOT EXISTS(SELECT 1 FROM m01.product_specification p WHERE p.id=x AND p.factory_id=NEW.factory_id)) THEN RAISE EXCEPTION 'invalid order specifications'; END IF;
 IF EXISTS(SELECT 1 FROM m02.cable_spool s WHERE s.work_order_id=NEW.id AND NOT(s.specification_id=ANY(NEW.specification_ids))) THEN RAISE EXCEPTION 'specification used by cable'; END IF;
 NEW.specification_id:=NEW.specification_ids[1];
 RETURN NEW;
END $$;
CREATE TRIGGER order_specs_guard BEFORE INSERT OR UPDATE ON m02.work_order FOR EACH ROW EXECUTE FUNCTION m02.order_specs_guard();
CREATE FUNCTION m02.spool_spec_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE specs text[];
BEGIN
 SELECT specification_ids INTO specs FROM m02.work_order WHERE id=NEW.work_order_id AND factory_id=NEW.factory_id FOR KEY SHARE;
 IF NEW.specification_id IS NULL AND cardinality(specs)=1 THEN NEW.specification_id:=specs[1]; END IF;
 IF NEW.specification_id IS NULL OR specs IS NULL OR NOT(NEW.specification_id=ANY(specs)) THEN RAISE EXCEPTION 'cable requires an explicit order specification'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER spool_spec_guard BEFORE INSERT OR UPDATE ON m02.cable_spool FOR EACH ROW EXECUTE FUNCTION m02.spool_spec_guard();
CREATE INDEX cable_spool_specification ON m02.cable_spool(factory_id,specification_id);
CREATE INDEX work_order_specifications ON m02.work_order USING gin(specification_ids);
