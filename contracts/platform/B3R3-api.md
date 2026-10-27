# B3R3 服务端列表与任务摘要

2026-10-26｜完成情况：接口已实现、自测并部署，待用户验收；后端42项、前端154项通过。人员data:read，工厂隔离；设备凭证禁止访问。

## 1 批量计划查询
GET /api/v1/production/plans
参数：page（1～100000，默认1）、limit（1～100，默认20）、q（最长128字，按文字匹配，%和_不作为通配符）、state、specification_id、device_id、process_id、environment、has_errors=true/false、from/to（带时区，含起不含止）。未知参数/重复参数、非法枚举、日期倒置400。
返回：items、total、active_items、failed_items、page、limit、as_of；total是完整筛选结果，不受分页影响。
每项：原计划字段及item_count/active_count/removed_count/failed_count/ungenerated_count/waiting_count/running_count/ended_count、spool_count（有效原申请盘ID数）、current_spool_count（有效当前主盘ID数）、state。
状态按优先级：EMPTY无有效项→RUNNING存在运行→FAILED存在失败→COMPLETED全部有效项结束→PARTIAL部分结束→READY全部已生成→DRAFT尚有未生成。状态是执行进度，不是质量。
对象条件须同一有效计划项匹配。生成后按任务当前属性/关联筛选，未生成按request；来源环境只匹配已生成任务，不推测。关键词匹配计划名/ID及有效项的当前任务号/盘号/工单/创建盘号。移除项不影响有效项筛选。
验收：超过500计划可完整分页，失败项及部分结束状态正确，当前盘随B3R2更正/归并变化，原申请不改。

## 2 线缆列表
GET /api/v1/production/spools
参数：page/limit/q/state/from/to同上，另有specification_id、device_id、metric_code、process_id、line_id、environment。
仅返回主盘（包含没有任务的盘），关联成员只计身份，不重复返回。q匹配主/成员当前盘号/内部ID/工单及任务创建盘号/任务号；规格与日期以主盘档案为准。
任务条件在同一关联任务上取交集；命中后展示该盘全部任务计数，不将筛选后的部分任务假作整盘总数。环境筛选不会命中空盘。
返回items、total、tasks、running_tasks、page、limit、as_of；每项含主盘和当前工单/规格、identity_count、task_count、waiting/running/ended/cancelled_count、metrics、environments及state。
状态：NO_TASK无任务→RUNNING存在运行→CANCELLED全部取消→COMPLETED剩余任务全部结束→PARTIAL部分结束→WAITING待检测。COMPLETED不表示整盘合格。
验收：成员关键词返回唯一主盘；更正单任务后计数随当前归属；空盘可查；组合条件不会跨不同任务拼凑命中。

## 3 摘要与一致性
GET /production/tasks兼容新增每项measurements及current_order_code；GET /plans/{id}每个已生成task新增measurements。
measurements复用M04.taskSummaries：total/valid/invalid/passed/failed/unevaluated/quarantined、first_sample_at/latest_sample_at（微秒字符串）、minimum/maximum/mean（十进制字符串）、unit。无采样计数0，时间/极值/均值/单位null；有效已存值参与数值统计，隔离单列。
组合层在同一REPEATABLE READ只读事务读取M02页/计数与M04摘要，每页最多100任务，计划最多50项；一次批量摘要查询，不逐行请求、不跨模块SQL。
计划/线缆排序created_at DESC,id DESC；计数和当前页同快照。跨请求为实时页码分页，不承诺并发写入时跨页冻结；新增/改挂/归并后刷新。页超界返回空items和真实total，不悄悄扩大条件。
旧GET /plans（最近500）与旧/tasks、/spools列表兼容保留；新版界面使用production分页接口。旧详情/创建选择器按需全量加载暂保留，普通列表启动与轮询不加载全库。
验收：摘要与原记录/逐任务详情一致，未采样不显示合格；筛选切换迟到响应不污染新页，出错不显示旧行，URL保留条件及返回位置。

## 4 实施边界
无数据库迁移/新增依赖；检测阈值、设备协议、历史测量、状态命令与修改履历不变。客户/批次/负责人、统一选择器分页、旧物料标识映射、长离线/排队、复检/报告/HW仍未交付。
