> 2026-11-02 SC03修订：下文“重复当前码不重新开始”和“已结束码拒绝”已被重复扫码独立采集替代；网络重试仍幂等。当前规则见 contracts/simulator/SC03-repeat-scans.md。其余为SC02历史验收记录。

# SC02 扫码任务生命周期契约

2026-11-02；实现于4192/4198/4196；自测通过待用户验收。取代SC01中“中心先手动启动、边缘开始采集”的不圆度模拟流程。

## 1 状态（已实现）

| 当前状态 | 操作 | 结果 |
|---|---|---|
| 已关机 | 开机 | WAITING_SCAN；不启动中心任务 |
| WAITING_SCAN | 扫描CREATED任务码 | 中心RUNNING，边缘RUNNING；无需确认 |
| RUNNING | 重扫当前码 | 保持同任务/同绑定/同运行，不重复开始 |
| RUNNING | 同设备另一CREATED码 | 旧任务ENDED、新任务RUNNING，同事务提交 |
| RUNNING | 关机 | 停止接收新采样，中心ENDED；后台继续补传 |
| 任意 | 错设备/失效归属/已结束或取消的码 | 拒绝；不切换当前任务 |
| 同步结果未知 | 网络恢复或进程重启 | 同一持久命令重试；期间SYNC_PENDING，不接收新采样、不接受另一换码 |

设备匹配是具体device_id，不只是相同检测类型。当前支持OVALITY、SIMULATED，护套为同一任务的辅助结果；其他检测项需独立适配。HYT1+任务UUID去横线大写+V+归属版本，支持既有Code128以及编码相同文本的QR；文件名不参与身份验证。

## 2 API（已实现）

- GET /api/v1/devices/:id/scan-preview/:code：设备凭据；只读返回任务、盘号、当前assignment，不启动任务。
- POST /api/v1/devices/:id/task-scan：设备Bearer凭据＋X-Huiyan-Edge-Token。JSON含command_id、barcode、expected_task_id、expected_binding_id。
- POST /api/v1/devices/:id/task-stop：相同鉴权；JSON含command_id、expected_task_id、expected_binding_id。
- 无当前任务时预期两字段同时为null。存在时必须同时匹配当前设备任务/绑定。
- 响应：label（HYOV1绑定、assignment、工单/盘号/规格/长度）、ended_task_id、command_id；关机label为null。
- 同一command_id同内容返回原回执；改内容409。工厂/设备隔离由服务端校验。M02事务同时写状态、绑定、命令回执和既有操作审计。
- 边缘POST /api/start现为开机，POST /api/end现为关机，地址兼容；/edge/v1/scan与/api/scan支持直接扫码切换。

## 3 数据与异常（已实现）

边缘先持久化切换意图和截止时间，再调用中心。中心失败回滚旧/新任务；明确4xx恢复原采集状态，未知/5xx保留意图自动重试。边缘确认中心成功后原子结束旧运行并新建运行，清空当前视图缓存。

旧队列任务ID、绑定ID、采样时间不重写。切换前已采样数据迟到时写旧运行；切换后仍发旧绑定的新样本拒收，上游原文保留以诊断。模拟送料与扫码独立，换码不会凭空生成新盘读数；4196扫码成功后停止同设备旧送料，用户选择新盘送料。若旧送料队列尚未送达边缘，保留在模拟器运行记录，可使用补传；不可强行改挂新任务。

采样先写边缘本地持久队列和Influx，原始点每秒批量转发、等待中心逐条回执。中心OVALITY原文/值在Influx，PG保留索引/判定/任务，沿用TS01。无结构迁移，不改算法/规则/历史结论。关机不关闭计算机、不删除待传记录。

## 4 验收（自测通过，待用户验收）

首次启动、换码原子性、错码不影响旧任务、重复码幂等、并发唯一运行、断网重试/重启、关机同步、旧样本不串盘、浏览器与PG/TS对账。证据见SC02验收记录。真机扫码枪及真仪器未验证。
