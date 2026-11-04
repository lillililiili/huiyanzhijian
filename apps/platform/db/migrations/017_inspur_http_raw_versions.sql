-- ODM01 / M01: register the two vendor HTTP raw formats; preserve every existing capability.
-- Does not approve hardware transport, units, formulas or REAL data sources.
UPDATE m01.device SET raw_schema_versions=array_append(raw_schema_versions,
 CASE metric_code WHEN 'SHIELD_OVERLAP_RATE' THEN 'inspur-overlap-http.v1' ELSE 'inspur-gap-http.v1' END)
WHERE metric_code IN ('SHIELD_OVERLAP_RATE','WIRE_GAP') AND NOT
 (CASE metric_code WHEN 'SHIELD_OVERLAP_RATE' THEN 'inspur-overlap-http.v1' ELSE 'inspur-gap-http.v1' END=ANY(raw_schema_versions));
