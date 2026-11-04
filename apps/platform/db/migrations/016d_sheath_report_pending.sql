-- HT03: unapproved sheath limits must not become a pass/fail verdict.
ALTER TABLE m06.quality_report DROP CONSTRAINT quality_report_final_result_check;
ALTER TABLE m06.quality_report ADD CONSTRAINT quality_report_final_result_check CHECK(final_result IN('PASS','FAIL','CONDITIONAL','NOT_EVALUATED'));
