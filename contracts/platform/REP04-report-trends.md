# REP04 归档趋势增量

2026-11-04：沿用REP03六类报告HTTP、权限、采样范围与幂等契约。schema=REP04.1，新增taskSeries数组（task_id/metric_code/unit/method_id/points），points含原record id、UTC微秒字符串at、有效数值value或null、原result。series_method=TIME_BUCKET_FIRST_MIN_MAX_LAST_V1。

每任务等时长分桶，桶内选真实首、末、最小、最大记录并按id去重；共享点预算约80000，最多160桶/任务，至少1桶。统计继续基于完整范围，不从选点重算；taskStats追加first_failed_at/last_failed_at。查询只读M04既有PG投影，无时序服务逐条水合。M06同一repeatable-read事务归档并参与摘要；历史快照不补写。前端按采样先后排列并标注非等时距、任务间断开，不将首末异常跨度当作连续缺陷。
