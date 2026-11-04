# ODM03 整机扫码公开契约

2026-11-03；SIMULATED / TEST_ONLY。DG/JX是完整ODM整机，不调用Go边缘、不新增两项边缘程序。厂家未知比例、单位、地址、方式、鉴权仍须真机前确认。

## 中心HTTP（/api/v1）
- GET /devices/:device/odm-scan-preview/:barcode：DEVICE鉴权，device:ingest，设备及来源范围校验。返回当前assignment；不写数据。
- POST /devices/:device/odm-task-scan：command_id、barcode（HYT1任务码）、line_id、expected_task_id、expected_binding_id。expected两项同时为null或同一有效绑定。DEVICE凭据；不使用不圆度边缘token。
- POST /devices/:device/odm-task-stop：command_id、expected_task_id、expected_binding_id。
- GET /tasks/:task/odm-source：USER data:read，工厂范围，返回line_id/device_id/metric_code/created_at等绑定字段或null。

每次检测使用新的line_id（1～128字符，不含控制字符及首尾空格）。命令重复使用同一command_id及完全相同请求，返回原回执；同一设备订单号已用于另一命令则409 ODM_ORDER_ALREADY_BOUND。同码新订单建立独立执行。响应含label.assignment及label.order.deviceOrderNo。错设备、旧版本条码、取消任务、并发绑定变化均拒绝；不能先结束旧任务再报告订单冲突。

M02追加odm_order_binding；不改历史任务快照和规则。M04验证原始vendor_record_json.lineId必须等于绑定；篡改/缺失进入隔离，不归到当前新任务。

## 模拟器（/api）
- GET /scanner/state?device_id=...：ODM设备状态/订单/生成、确认、待确认、拒绝计数；不传device_id保持OVALITY旧路径。
- POST /scanner/scan：device_id、request_id（UUID）、barcode、line_id。会话及CSRF保护。网络不确定时持久化请求并禁止新命令抢占；恢复后重试同一request_id。
- POST /scanner/stop：device_id、request_id。待传点保留。

模拟订单可用SIM-UUID生成。扫码只绑定身份；去送料独立生成值。厂家query响应中lineId来自冻结绑定，字段与两份厂家文档相同；中心HTTP适配转为统一接入契约后入库。分页原文/无效值不补零；PITCH不当作GAP。旧未扫码模拟记录保留既有capture_session关联策略。

RAW厂家订单号和平台工单号并非同一个字段。厂家订单号与平台任务/线缆/工单通过绑定关联，不要求修改厂家字段。
