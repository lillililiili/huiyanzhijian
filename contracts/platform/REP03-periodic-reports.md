# REP03 报表公开接口

所有接口均在 `/api/v1` 下，用户会话、工厂隔离；POST校验CSRF。

| 接口 | 权限 | 结果 |
|---|---|---|
| POST `/reporting/preview` | reports:read | 一致性只读统计快照，不归档 |
| POST `/reporting/reports:generate` | reports:write | 保存快照，返回id；Idempotency-Key必填8–128字 |
| GET `/reporting/reports?page=1&kind=DAILY` | reports:read | items/total/page；每页20，kind可空 |
| GET `/reporting/reports/:id` | reports:read | 固定报告内容与snapshot_hash |

请求：kind为DAILY/WEEKLY/MONTHLY/QUARTERLY/YEARLY/WORK_ORDER；周期必填anchor YYYY-MM-DD，工单必填order_id；environment为空/REAL/SIMULATED。presentation含supplier/recipient/title（各最多40字），trends/details布尔值。

周期按北京时间自然日、周一开始周、自然月/季度/年，范围左闭右开。按sample_time取数。工单按当前关联的所有线缆、各次任务汇总，保留无线缆采样/无记录项，不补造数据。

快照：scope、presentation、captured_at、orders、spools、tasks（冻结规则/生产上下文）、totals、metrics、taskStats、timeline、exceptions、trace。numeric统计只包括STORED+VALID+有投影值的记录；passed/failed仅此范围。invalid包括隔离/无效/缺投影，unevaluated为有效值但无明确判定，四类互斥合计total。

数值按metric_code/unit/method_id分组。日小时、周/月按日、季/年按月；工单约60个等时宽桶，保留桶内最小/最大/平均及全部记录数量。exceptions最多24条按任务轮选，优先超限，再近期记录；完整异常数不截断。

生成采用REPEATABLE READ。幂等请求在获取连接内串行锁定，相同键与内容返回原id，不同内容409。M06新表运行角色仅SELECT/INSERT，无更新或删除权；生成写M00公开审计接口。哈希采用报告专用键排序JSON SHA-256，保持显示时间/原文规则值，不套用采样入库规范化器。

空范围可预览，归档422；工单/报告不可访问404；权限403；查询过大422 REPORT_SCOPE_TOO_LARGE。M02/M04公开接口接收调用者现有事务连接，避免事务内再次借池。
