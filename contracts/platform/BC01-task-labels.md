# BC01 检测任务条码

2026-10-30。M02拥有任务身份及解析，M10生成标签；无新增业务表、账号或权限。

## 1. 标识与描述

Code128内容：`HYT1{32位大写任务UUID}V{association_version}`。每个原子检测任务独立，工单/盘号/规格/工序名称不参与编码。工单和盘号编辑后重新下载说明；任务改挂导致版本变化，旧标签不可采集。打印标签不代表任务已开始或检测已合格。

PNG说明：任务编号、工单编号、线缆/盘号、工序、检测项、设备、规格、数据来源、下载时任务状态、归属版本。不含凭据或会话信息。

## 2. 工单任务清单

`GET /api/v1/work-orders/{id}/task-labels`

要求USER会话、`data:read`、当前工厂。返回`order{id,external_code}`、`as_of`、`items[]`。每项包含`barcode/task_id/task_code/work_order_id/order_code/spool_code/process_id/metric_code/device_id/state/data_environment/association_version/specification`。

读取当前任务归属，规格使用任务冻结快照。独立于页面分页/筛选，包含全部状态。只读可重复读事务；工单不存在或跨厂404；未登录401；无权限403。单工单超过1000任务明确拒绝，不静默截断。下载前重新请求；所选任务移出工单则阻止导出并提示刷新。

## 3. 边缘解析

`GET /api/v1/task-labels/{barcode}`：凭设备Token解析任务，设备必须在凭据授权范围内。

`GET /api/v1/devices/{device}/task-labels/{barcode}`：另校验指定设备与任务相同。

要求当前工厂、device:ingest、设备/数据环境范围、设备启用、任务RUNNING、当前binding匹配、归属版本匹配。本期仅OVALITY + SIMULATED支持实际边缘扫码适配，保留当前边缘流程要求的有效计划长度；无长度不补默认。

成功返回既有HYOV1绑定码、task_id/device_id/binding_id/snapshot_hash及当前工单/盘号和任务规格。沿用既有边缘saveLabel与扫码校验，查询不会启动采集。边缘空闲配置的默认deviceId不作为扫码目标，目标从中心授权任务取得；不同设备和环境仍由中心凭据范围限制。既有HYOV1条码兼容。

格式错误422；归属过期/任务未开始或结束/绑定变化/适配未启用/缺计划长度409；凭据越权403；服务不可达提示失败，不使用缓存替代新HYT1解析。

## 4. 文件与验收

单张PNG；批量为勾选PNG与`任务清单.json`组成的UTF-8 ZIP。只下载所选任务，全选覆盖本工单全部任务；无选择禁用，生成期间禁用重复提交。文件名替换非法字符。

验收：文件数量与数据库一致；PNG可被现有ZXing解为准确身份；ZIP的CRC和中文文件名正确；任务改挂不沿用旧标签；下载不改变任务状态、不生成采样；三检测项描述与任务对应。物理扫码枪、纸张尺寸/打印清晰度另行现场验收。
