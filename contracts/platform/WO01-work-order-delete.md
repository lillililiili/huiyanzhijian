# WO01 工单删除

2026-10-27。M02拥有工单和关联检查；M00拥有追加审计。保留现有任务/采样契约。

## 查询

GET /api/v1/production/work-orders、GET /api/v1/work-order-summaries/{id}新增：
- can_delete:boolean：业务数据是否符合删除条件；仍须task:write权限。
- delete_block_reason:string|null：不可删除原因。
- has_spools / has_task_history / has_plan_reference：M02关联事实。

只有source_system=PLATFORM、没有登记线缆、当前及原始归属任务、任何计划项引用才可删除。计划已移除项和任务取消履历也保留。NO_TASK不是充分条件；其他执行状态均不可删。

## 命令

POST /api/v1/work-orders/{id}:delete

请求：`{"reason":"重复录入"}`，原因非空、最多1000字符；禁止额外字段。人员身份、data:read与task:write、当前工厂、CSRF、Idempotency-Key沿用现有体系。

返回data：`{id,external_code,deleted:true}`。同一账号/工厂/幂等键及相同规范化原因返回原结果，不重复审计。不同内容同键409。

错误：401未登录/会话失效；403权限或CSRF；400字段/幂等键非法；404不存在或跨厂；409 WORK_ORDER_NOT_DELETABLE或幂等冲突；503依赖失败，客户端保留原键核对重试。

执行：工厂production事务锁→本厂工单FOR UPDATE→新语句复查关联→删除空工单→追加审计→保存幂等回执→提交。登记线缆先取工单FOR KEY SHARE；创建计划在相同production锁下验证并锁定工单，防止JSON引用悬空。

## 审计与数据库

删除、成功审计和回执同事务；审计失败则全部回滚。
WORK_ORDER_DELETED：resource_type=WORK_ORDER、resource_id、actor_id、occurred_at、request_id、factory_id、result=SUCCESS；details含before完整工单快照、after=null、reason。
进入删除服务后的失败尝试记录WORK_ORDER_DELETE_REJECTED及错误码，不含敏感请求原文。身份/CSRF等在路由前置拒绝的请求沿用HTTP运行日志，不伪造已认证操作人。
查询入口：4182操作审计；GET /api/v1/admin/audits?action=WORK_ORDER_DELETED。需要audit:read，本厂范围，审计不可修改/删除。

007迁移只增加hy_runtime对m02.work_order的DELETE权限，不新增字段、不授予其他表DELETE。删除仅面向无业务关联的空工单；关联线缆、任务、采样和计划不级联删除。没有网页恢复入口；删除确认框明确对象和原因，审计保留原工单信息。
