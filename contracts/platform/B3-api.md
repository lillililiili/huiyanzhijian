# B3 批量计划与自动发现契约

2026-10-26；路径前缀`/api/v1`。B1人员/设备测量1.0保持兼容；新增003迁移，旧任务号与历史快照不改。

## 1 人员接口

沿用Cookie、CSRF、工厂范围。读取data:read，命令task:write；所有POST携带Idempotency-Key。同键同体返回原结果，异体409。配置与盘更正另需If-Match。

| 方法 / 路径 | 输入 | 返回 / 规则 |
|---|---|---|
| GET /production/tasks | page≥1、limit 1～100；q、state、device_id、metric_code、specification_id、data_environment、creation_source、work_order_id、plan_id、line_id、spool_id、from/to | items/total/running/ended/waiting/spools/page/limit/as_of；工厂范围；当前页和计数同一读事务；created_at倒序＋id倒序。跨请求为实时分页，不承诺历史快照；时间含时区，左闭右开 |
| GET /task-details/{id} | 任务ID | task、plan、transitions、encounter、measurements。M02/M04由入口组合；样本摘要包含隔离数，不输出整盘合格率 |
| POST /plans | name非空≤128；items 1～50个B1创建任务对象 | id/name。计划先持久化；同计划同spool_id/device_id不得重复；业务适用性在生成时逐项核验 |
| GET /plans | 无 | 最近500计划及盘数、项数、运行、结束、失败、移除数；不含未来报表结果 |
| GET /plans/{id} | 无 | 计划与items（稳定id、request、task、last_error、removed_at/remove_reason） |
| POST /plans/{id}:generate | {}或{item_id} | 持久生成独立任务；已有任务不重复生成；逐项results，FAILED带code/message；请求成功不代表所有项成功 |
| POST /plans/{id}:start | {}或{item_id} | 同设备冲突逐项反馈；已运行/已结束项不重复启动；不自动排队、停线或改派 |
| POST /plans/{id}:remove | item_id、reason非空≤1000 | 仅未开始项；已生成任务转CANCELLED并留履历，原记录不删除。运行/历史拒绝 |
| GET /discovery-profiles | 无 | 本工厂设备配置；无配置等同关闭 |
| POST /discovery-profiles/{device} | enabled布尔、specification_id、recipe_version_id（可null）；If-Match初次0 | 设备适用性与配方重验，版本递增；不修改已有任务快照 |
| POST /spools/{id}:edit | spool_code非空≤128、canonical_spool_id可null、reason；If-Match | 修改显示编号/同盘分组；原始ID和快照不变；归并同规格同环境、无运行任务、不成环；成员不能作为新任务对象，须用主盘 |

新任务task_code按工厂时区日期＋至少4位流水生成，日内工厂唯一；手动与自动共用。旧UUID任务编号保持。task_id/spool_id仍为稳定内部ID。计划完成=非移除项非空且全部ENDED，与质量无关。

## 2 设备进出料事件

POST `/production-events`，Bearer，device:ingest与设备/环境范围；组合入口先验证当前connection_id。自动发现配置仅人员可修改。

```json
{
  "schema_version":"1.0",
  "event_id":"event-001",
  "encounter_id":"physical-pass-001",
  "device_id":"HY-DG-01",
  "connection_id":"当前设备连接ID",
  "phase":"ENTER",
  "occurred_at":"2026-10-26T08:00:00.123456Z",
  "meter":{"counter_id":"calibration-segment-001","value_m":"100.1234567891"},
  "material_ref":"customer-material-001"
}
```

必填schema_version/event_id/encounter_id/device_id/connection_id/phase/occurred_at/meter。phase=ENTER或EXIT；meter可null，数值为非负十进制字符串（14位整数、10位小数以内）。选填material_ref、spool_id、task_id；material_ref≤128，同工厂同环境唯一。标识应使用扫描/生产系统可靠值，不得用临时显示盘号冒充。

回执：event_id、encounter_id、task_id、task_code、spool_id、state、reported_length_m、length_status、duplicate。事件、任务/绑定、身份映射、回执同事务提交。

- event_id去重范围工厂＋设备；摘要不含可更新的connection_id。换连接沿用原event_id与其他原文；异体EVENT_PAYLOAD_CONFLICT。新event_id重放同encounter同阶段，除event_id/connection_id外内容必须完全一致。
- 新事件时间限定服务器前后5分钟；重复成功事件可跨时段重放。未上线离线自动派工；B1已绑定任务的测量补传仍独立支持。
- ENTER要求配置启用。task_id优先，必须设备/盘/规格匹配；否则按已知盘＋设备寻找唯一CREATED/RUNNING任务，歧义TASK_SELECTION_REQUIRED；无候选才建任务。已关联另一次过料的任务不可复用。
- material_ref跨设备共用同一spool_id；无身份则自动临时盘。自动工单AUTO按工厂/本地日期/产线/规格/环境分组。自动任务planned_length_m=null。
- EXIT必须关联已知encounter，来源时间不能早于ENTER；只结束关联任务。事件先前手工结束的任务可补登记出料。平台结束时间取接收事务时间，来源时间另存；不宣称精确硬件切断时刻。
- 计米同counter_id且末值≥初值，差值为REPORTED_UNVERIFIED；无计米UNKNOWN；换段/倒退COUNTER_CHANGED并null。计米差值不是覆盖长度、合格长度或校准后的真实长度。
- 设备占用409且整次事件回滚，不遗留临时盘/工单；未知出料409；格式400，时间/规格422，来源403。失败修正后沿原事件键重试；成功键不能改原文。

## 3 同盘展示与审计

归并只记录canonical_spool_id；历史task.spool_id、测量、冻结context_snapshot不修改。查询主盘包含自身与成员；解除归并恢复原查询分组。改显示号不触发归并；跨工序计米不直接对齐，不累加多次检测为整盘长度。

## 4 持久化、并发与验证

M02拥有daily_task_number、batch_plan、plan_item、discovery_profile、material_identity、production_encounter、production_event及既有表增量。生产身份/任务变更按工厂事务锁串行，同设备仍有唯一运行索引；批量每项savepoint，业务错误逐项保留，未知错误整笔回滚。M01/M03公开只读查询允许传入当前事务执行器，SQL仍只在所属模块，避免连接池嵌套占满。

验收脚本tests/backend/b3-cases.ts：计划部分失败、重试/取消、并发编号、自动事件幂等、手动优先、跨设备同盘、准确小数/换段未知、改号/可逆归并、越权/版本、筛选分页。实际执行结果以B3验收记录为准；设备硬件协议和计米校准待HW。
