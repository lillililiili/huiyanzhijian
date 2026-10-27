# B3R2 单任务盘号关联更正

2026-10-26｜兼容B1/B3/B3R1｜完成情况：接口已实现、自测通过，待用户验收。

## 1 命令
`POST /api/v1/tasks/{id}:reassociate`
人员身份、`data:read`＋`task:write`、CSRF、`Idempotency-Key`、任务版本`If-Match`。
```json
{"target_spool_id":"target-id","target_spool_version":"1","reason":"核对盘号后更正误关联"}
```
返回`{task,change}`。只改所选任务`spool_id/work_order_id`，`version/association_version`各加1；当前工单跟随目标盘。`original_spool_id/original_work_order_id/context_snapshot`不变。
CREATED/ENDED允许；RUNNING/CANCELLED或已进料未出料拒绝。目标为同工厂同规格主盘；组内环境必须一致；允许跨工单。无需目标盘空闲，其他任务不改。原计划request、物料识别映射、过料事件、设备绑定/回执、测量/判定均不重写。
错误：400字段/空原因；403权限/混合环境；404任务或目标不可见；409状态/过料未闭合/目标已归并/幂等冲突；412任务或目标版本过期；422同盘/规格不符；428缺If-Match。网络未知结果沿用原键、原体、原版本重试，成功后只产生一次履历。
验收：T2从A到B，T1仍在A；并发更正仅一次成功；失败没有部分写入。

## 2 履历
`GET /api/v1/task-associations/{id}`：人员`data:read`，工厂隔离。只读事务返回`{task,changes}`，按association_version降序。
每条：id、task_id、factory_id、association_version、task_version、before_context/after_context（盘/工单ID、显示号、盘版本、规格、归并状态）、reason、actor_id、request_id、occurred_at。
再次更正回原盘仍追加新版本。普通数据库角色无履历UPDATE/DELETE权限；创建原始归属及context_snapshot由触发器防覆盖。
验收：更正两次两条履历；改盘名称后履历中的旧名称仍保留；只读用户可读不可写。

## 3 查询与兼容
- M02 `spoolScope`按当前归属解析；签名纳入每个任务spool_id/association_version，移出后移回也不复用旧签名。
- M02 `associationRevision`、`businessContexts`为M04公开读接口；后者按已验证task_id读取当前归属和原创建标识，不跨模块SQL。
- M04历史条目新增`task_id`（已验证）和`business_context`（查询时task_code、spool_id/spool_code、work_order_id/external_code、original_spool_id/original_work_order_id/original_spool_code、association_version）；`raw_payload`原样。
- 查询在同一REPEATABLE READ事务读取；工厂关联履历数量纳入游标签名。该工厂任一任务关联更正后，旧历史游标统一拒绝，需刷新。保守失效换取跨页一致性。
- 已显示或单页导出使用行上的查询时归属；工作区5秒刷新不能替换旧行归属。JSON包含原文与独立business_context；CSV明确查询时盘号/工单/关联版本/创建时盘号。
- 计划request为原申请；任务对象为当前归属；展示分别标注申请盘数、当前盘数及已更正标识。
验收：旧页留旧关联；新查B包含原T2数据；迟到补传按原绑定验证后进入T2，在当前B范围可查询；原任务ID/采样内容/规则不变。

## 4 数据迁移和部署
004_task_association.sql只增加M02字段、触发器和task_association_change；原有任务回填首次归属，关联版本1。001～003不改；迁移可重复执行（既有迁移校验不重放）。先备份、构建、迁移，再替换web/backend；保留卷。
验收：原数据不丢，旧绑定和快照一致，四个容器健康；HW/正式报告/MES不在本轮。回滚优先旧镜像保留新增表，不能删除更正履历；旧版本不能继续执行更正命令。
