# B1 人员与只读API契约

2026-10-21，随B1基础包实现。统一前缀/api/v1，成功code/message/request_id/data；失败沿设备契约结构。仅测试环境；2026-10-26 B2前端已接入，兼容原人员/设备命令。

POST /auth/login：username/password字符串；返回user/csrf_token，设置HttpOnly人员会话Cookie，8小时过期。GET /auth/me恢复身份；POST /auth/logout撤销会话。人员写入需X-CSRF-Token；角色来自数据库。admin/operator可创建业务，viewer只读。设备Bearer身份不能使用人员命令。

GET /catalog：当前工厂基础档案及规则，保持旧设备/规格ID；不包含测试任务。GET /work-orders、/spools、/tasks：工厂隔离，有界分页limit 1—100、after_id，返回items/has_more/next_cursor。

POST /work-orders：external_code/specification_id；POST /spools：work_order_id/spool_code。POST /tasks：work_order_id/spool_id/specification_id/process_id/device_id/metric_code/recipe_version_id/planned_length_m，长度为十进制字符串；recipe_version_id允许null，此时只校验记录不判合格。三项单指标、规格工序设备相容。所有创建带Idempotency-Key，键绑定人员/工厂及完整命令内容，同内容重试原结果，异内容409。

POST /tasks/{id}:start、:end：Idempotency-Key及If-Match为当前版本字符串，结束必填reason；开始原快照、同设备唯一RUNNING。返回任务、version。GET /tasks/{id}返回快照，不将结束当合格。暂停/取消本期未实现。设备取得/确认绑定沿I03/I04；人员start不替代端侧APPLIED。

GET /measurements：device_id/task_id/metric_code可选，limit默认50上限100，cursor为不透明游标。固定入库序号上界及过滤器摘要，后续插入不混入当前分页；返回items/next_cursor/has_more/as_of。值为十进制字符串，源微秒保留；记录含raw_payload/evaluation/qualification，position_eligibility为UNVERIFIED。GET /measurements/{id}为同范围详情。

GET /device-status：连接心跳和采样时间分别返回。GET /audit-events与/ingestion-batches仅admin可读，有界分页；/ingestion-batches/{id}返回逐条状态与错误，不泄露凭据。GET /health/live只证明进程活；/health/ready检查数据库，返回analysis_worker健康及capabilities，分析未实现须明确列出。

不实现的报告、分析、源报警、文件与1.1接入返回501/FEATURE_NOT_IMPLEMENTED或400/SCHEMA_VERSION_UNSUPPORTED，不返回模拟成功。默认不预置工单/盘/任务/测量。原始数据不提供PUT/DELETE接口。

## B2 查询增量（2026-10-26）

- `GET /auth/me`：`data.user`包含`id/username/name/permissions/factory_id`，同级`csrf_token`。权限来自当前服务端身份。
- `GET /catalog`：新增`specification_applicability[]`，字段`specification_id/process_id/metric_code`；仅当前工厂规格。原目录字段保留。
- `GET /measurements`：新增`task_ids`（逗号分隔，最多200个ID）、`from/to`（ISO采样时间，左闭右开）、`quality`（PASS/FAIL/NOT_EVALUATED）、`environment`（SIMULATED/REAL）、`order`（asc默认/desc）。所有条件取交集；task_id与task_ids同时传入时也取交集。
- DET01（2026-10-27）：测量查询响应增加`total`，为相同筛选条件和固定`as_of`入库序号上界内的匹配记录总数；计数不受当前游标位置影响。每页继续返回`items/next_cursor/has_more/as_of`，过滤或排序变化必须重新从首游标查询。
- 排序按入库序号，不承诺迟到数据的采样时间顺序；游标绑定全部条件及排序，变化后必须从首页查询。时间倒置、枚举非法、游标不匹配返回400/REQUEST_INVALID。
- 前端历史每页25条，检测窗口最近入库100条；历史导出从首个快照遍历完整游标，不只导当前页。值/位置/源时间保留字符串；图表转换为数值只用于绘图。
- 批量登记/创建由前端顺序调用已有命令，逐项展示结果。当前弹窗内已成功项不再提交，未知结果重试沿用原键；刷新或重新打开任务表单不保证延续该批去重状态，重复检测需明确新建。持久批量计划、服务端任务筛选仍属B3。
- 前端开发/预览代理与Nginx均把`/api`转到本地4192；不在浏览器保存设备令牌或数据库凭据。

示例：`GET /api/v1/measurements?task_id=<task_id>&quality=FAIL&environment=SIMULATED&order=desc&limit=25`。下一页附原`cursor`并保持筛选不变。
