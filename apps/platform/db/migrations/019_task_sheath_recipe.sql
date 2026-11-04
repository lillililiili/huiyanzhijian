-- JDG01: explicit per-specification sheath recipe for future discovery tasks.
ALTER TABLE m02.discovery_profile ADD COLUMN sheath_recipe_version_id text REFERENCES m03.recipe_version(id);
