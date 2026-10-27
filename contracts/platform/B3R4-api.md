# B3R4 工单与采集状态查询契约
2026-10-26｜已实现、自测，待用户验收。API前缀 `/api/v1`，沿用统一响应及登录Cookie；只允许人员 `data:read`，按工厂隔离。无新增表、迁移或写入命令。

## 1 工单查询
完成情况：实现。
- `GET /production/work-orders`：page默认1、limit默认20/最大100；q搜索编号/ID（字面量）；state、specification_id、from含/to不含（带时区）；id用于精确查询。未知/重复参数400。
- 排序created_at DESC,id DESC；返回items,total,tasks,page,limit,as_of。跨请求实时分页，不保证并发写入时冻结。
- 每项包含work_order原字段、registered_spools、physical_spools、task_count、waiting_count、running_count、ended_count、cancelled_count、state。
- state优先级：无任务NO_TASK→存在运行RUNNING→全取消CANCELLED→结束+取消覆盖全部COMPLETED→存在结束PARTIAL→WAITING。仅执行状态，不是质量结论。
- `GET /work-order-summaries/{id}`：同字段及as_of；不存在/越权404。两接口各自使用只读可重复读事务。
- 登记身份按本工单原始盘登记记录统计；物理盘按canonical_spool_id或自身ID去重；任务按当前work_order_id统计。跨工单同盘不能将各单physical_spools直接相加。
- `GET /production/spools?work_order_id=...`：任一成员登记在本工单就返回主盘一次；返回计数是该物理盘全部当前任务。任务页复用 `/production/tasks?work_order_id=...`，只取当前本工单任务。明示两者范围差异。
验收：23单分页、空单、当前关联更正、组盘、非法参数/工厂/设备凭证边界；两盘两任务浏览器闭环。

## 2 采集监控
完成情况：实现。`GET /operations/overview` 返回as_of、connections、当前RUNNING任务及activity；同一只读快照，由M02任务查询和M04公开批量接口组合。`GET /task-activity/{id}` 校验任务工厂并返回activity；单次状态观察，不声明多个查询与设备现场原子同步。`/production/tasks` 当前页附带activity，与列表/摘要同一只读快照。

activity：task_state、communication（ONLINE/OFFLINE/UNKNOWN）、last_heartbeat_at、observation_seconds=30、sampling、latest、received_age_seconds、sample_age_seconds、as_of。
latest来自当前任务按ingest_order倒序首条：record_id、received_at、sample_time（微秒UTC字符串）、value（精确小数字符串/null）、unit、data_status、receipt_status、quality_result。以接收顺序选末条，不能用max(sample_time)冒充最后到达。

| sampling | 显示依据 |
|---|---|
| NO_DATA | 无记录 |
| CLOCK_UNVERIFIED | 时间不可解析、接收时间在未来、采样时间超过服务器未来30秒 |
| NO_RECENT_DATA | 距接收超过30秒 |
| DELAYED_DATA | 30秒内收到但来源采样早于30秒 |
| RECENT_DATA | 其余近期收到记录；有效性/隔离/判定另列 |

30秒为显示观察窗，不是生产断流、时钟容差或停线批准值。近期收到无效数据仍显示无效；离线不结束任务；已结束任务可查迟到记录，默认不自动刷新。此包不提供设备控制/报警生成。
验收：无数据、离线运行、无效、迟到、未来及无效时间、已结束、跨工厂与设备凭证负例；原始事实不变。

## 3 管理边界
完成情况：业务API已运行；管理界面/写接口未交付。当前鉴权、目录、工单盘任务、计划/自动发现、绑定心跳、接收回执、历史/采样、审计诊断属于平台业务服务。账号编辑、角色维护、默认参数及日志管理前端是后续admin-web范围，共用M00，不取代业务API。
验收：管理操作服务端授权、版本与原因；默认修改不覆盖既有任务/报告快照；完整目标见第17份第3章。
