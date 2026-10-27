# B3R1 同盘汇总与历史查询

2026-10-26｜在B3基础上增量实现，无表迁移；人员Cookie及data:read权限，工厂范围沿M00。

## 1 同盘汇总

`GET /api/v1/spool-summaries/{spool_id}`

| 返回字段 | 语义 |
|---|---|
| requested_id / root_id | 请求身份与当前主盘；成员入口解析到同一主盘 |
| members | 主盘及直接成员；当前盘号、版本、工单、规格。仅当前工厂 |
| tasks | 关联各身份的全部任务；保留spool_id、创建时context_snapshot、规则、状态与各次长度，不改挂或去掉复检 |
| measurements | 按task_id统计；无记录任务无该行，前端显示数量0、值/时间未知 |
| scope_hash / as_of | 当前身份/任务范围摘要、查询时点；仅用于追溯，不等于报告发布快照 |

M02.spoolScope与M04.taskSummaries由HTTP入口在同一REPEATABLE READ只读事务装配；各自只查所属表。

统计字段：total、valid、invalid（包含MISSING）、passed、failed、unevaluated、quarantined、first_sample_at、latest_sample_at、minimum、maximum、mean、unit。极值/均值只采用VALID且STORED的非空数值；十进制以字符串返回，均值为PostgreSQL numeric除法结果。数量按已核实task_id关联，未绑定隔离记录只能在全局历史查询，不凭原文task_id强行归属。不同任务/指标/单位/规则不合成一个均值、合格率或盘长。

错误：未知/跨工厂盘404；非人员或无data:read为403；ID格式错误400。不提供写入口。

## 2 历史查询增量

`GET /api/v1/measurements`新增：

| 条件 | 规则 |
|---|---|
| spool_id | 由M02解析主盘及成员全部任务；无前端200任务ID拼接限制。空盘为空结果；未知盘404 |
| process_id | M02解析工序任务范围；未知工序为空，不扩为全量 |
| data_status | VALID、INVALID、MISSING |
| receipt_status | STORED、QUARANTINED |

与原task_id、task_ids、metric_code、device_id、from/to、quality、environment全部取交集；原task_ids≤200保持兼容。响应新增scope（root_id、members、task_count、scope_hash）；无盘条件为null。scope.task_count是关联任务总数，不是当前测量筛选后任务数。

游标绑定全部筛选、工厂、盘身份版本和任务集合，沿用接收水位。改盘号、归并/解除、新增任务后旧游标返回400 REQUEST_INVALID，提示范围变化、刷新查询；不静默采用新范围，也不承诺保留旧归并关系供长期查询。普通测量追加不改变任务集合，已验证的迟到追加不会进入旧水位。每次请求内使用一致只读快照；长时间并发/容量指标未做生产验收。

## 3 前端及导出

盘详情分工序×指标×环境显示执行与采样计数，逐任务显示有效值统计及原始身份。盘列表可按成员当前/创建盘号搜索，结果仍为一个主盘。盘→任务→盘、盘→历史→任务→历史保留范围。

CSV增加任务编号、当前来源盘号，保留创建时盘号、原始十进制/时间；有盘范围时当前盘号取首屏scope，JSON附scope。导出沿首屏游标遍历完整筛选，失败不输出部分文件。范围切换清理旧抽屉并忽略迟到请求；查询错误时禁用导出和下一页，刷新后重试。

## 4 未改变的业务边界

未实现单任务关联更正、复检采用、位置映射、正式质量/覆盖、图像、报告或HW。B3自动发现策略、进出料协议及未决客户规则不因本轮查询增强而批准。
