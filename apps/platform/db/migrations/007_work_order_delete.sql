-- Only unused work orders may be removed by the M02 command; facts and audits stay protected.
GRANT DELETE ON m02.work_order TO hy_runtime;
