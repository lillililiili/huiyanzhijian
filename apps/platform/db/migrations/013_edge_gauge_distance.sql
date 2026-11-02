-- EDGE07: distance is a new physical quantity; never convert historical time values.
ALTER TABLE m09.edge_point_sync ADD COLUMN distance_mm integer CHECK(distance_mm>0);
ALTER TABLE m09.edge_point_sync ALTER COLUMN delay_ms DROP NOT NULL;
ALTER TABLE m09.edge_point_sync ALTER COLUMN tolerance_ms DROP NOT NULL;
ALTER TABLE m09.edge_point_sync ALTER COLUMN upstream_gauge DROP NOT NULL;
UPDATE m09.edge_point_sync SET delivery_state='REQUIRES_DISTANCE',last_error=NULL WHERE distance_mm IS NULL;
