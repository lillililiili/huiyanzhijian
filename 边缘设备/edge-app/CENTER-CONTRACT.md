# 中心平台预留接口 edge.v1

> EDGE02当前增量：本机已启用现有中心 `/api/v1/measurements:ingest` 的OVALITY边缘网关路径，见EDGE02.md；下文 `/edge/v1/batches` 仍是独立预留协议，未因本次网关实现而自动完成。不得同时配置两个上行。订单选择器由扫码录入替代；下文历史手动订单界面描述不再作为当前操作步骤。

此接口已经在边缘端实现，中心平台适配器尚未实现/联调。不直接写中心数据库，不把现有4192成功响应当作数据接收确认。

## 安全与配置
`edge.env` 配置 EDGE_CENTER_URL、EDGE_CENTER_TOKEN（出站机器凭据）、EDGE_INBOUND_TOKEN（入站独立凭据，至少32字符）。默认都为空，禁止远程命令；凭据不在网页返回或日志记录。
正常Ubuntu默认仅监听127.0.0.1:4198。对接时由运维配置HTTPS反向代理/防火墙与机器认证，不能直接向公网暴露本地操作员界面。入站 `/edge/v1/*` 均要求 `Authorization: Bearer <EDGE_INBOUND_TOKEN>`。上行 HTTPS 使用系统根证书，不跳过校验。

## 上行：POST {EDGE_CENTER_URL}/edge/v1/batches
每秒检查队列，每批至多500条；网络/业务失败等待重试。本地数据先事务提交；停机后从持久化确认游标继续。

```json
{
 "contract":"edge.v1", "deviceId":"edge-01",
 "batchId":"<installationId>:1:500",
 "records":[{
   "id":1,"runId":"20261030T...","deviceId":"edge-01",
   "at":"2026-10-30T05:30:00.123456789Z", "received":"2026-10-30T05:30:00.123456789Z",
   "registers":[2,39800,40000,0,39600,0],"raw":"01030c...",
   "x":40,"y":39.6,"average":39.8,"ratio":0.99,
   "offsetX":0,"offsetY":0,"valid":true,"reason":"","verdict":"PASS",
   "method":"roundness-min-max.v1","source":"MODBUS"
 }],
 "runs":[{"id":"20261030T...","order":{"code":"WO-1","spool":"P-1","spec":"...","length":500},"config":{"lower":0.98},"method":"roundness-min-max.v1","state":"RUNNING"}]
}
```

`runs` 为完整实际结构（以上省略其余配置字段）。原始字段、有效性、方法、规则/工单快照须保存，不只取ratio。`at`是边缘主机收到完整仪器帧的时间，不伪称仪器硬件时间；未接计米器，不上报伪造米数。
`source=MODBUS`只表示输入协议，不证明HW验收；测试环境数据不得导入正式工厂。TCP raw含MBAP，RTU raw含CRC，按快照transport辨认。

中心应以 **installationId + record.id** 唯一幂等（installationId 为 batchId 前缀），相同ID相同内容返回已有接收结果，不重复入库；相同ID内容不同需拒绝并告警。设备编号可以修改，不能单以设备编号+流水作为全局唯一。

成功响应必须包含：
```json
{"batchId":"<installationId>:1:500","acceptedIds":[1,2,3]}
```
acceptedIds必须完整覆盖该批实际ID，不能省略、重复或多出ID；全部确认才推进游标。HTTP200空响应、只返回success、部分确认都不推进。中心可在幂等保存后重试完整确认。若重试时追加了数据，批次边界可能改变，记录唯一键仍相同。
尚未实现中心独立工单完成事件同步、设备心跳订阅、远程升级或权限管理；当前仅通过记录批次携带当时工单状态，以及下述主动状态查询。中心不要仅凭最后样本的RUNNING推断最终任务状态。

## 下行订单：PUT /edge/v1/orders/{externalId}
体：`{"code":"WO-1","spool":"P-1","spec":"110kV 1×800","length":500}`。
相同externalId+相同内容幂等接受；相同ID不同内容拒绝（需创建新版本ID），保存到本地orders。响应 `{"accepted":true,"orderId":"..."}`。
下发后在“开始新一盘检测”的中心订单选择器出现，由现场人员确认后开始，**下发不自动启动采集，不控制送料/PLC**。正在检测的快照不变。

## 查询状态：GET /edge/v1/status
返回state、connected、run、latest、frequency、stored、tsdb、tsPending、tsError、centerPending等；需要独立机器认证。`connected`仅代表近期Modbus读成功；有效性查看latest.valid。待命/暂停时不声称连接在线。

## 对接中心前的核对项
设备档案ID映射、工厂/产线权限、时间同步、ratio单位1与新下限配方、异常/无效处理、幂等接收、数据量/保留期、中心任务结束事件契约。中心现有百分比快照不能直接接收本方法。

EDGE04/1.3.0：新增机器认证轴值输入POST /edge/v1/gauges，A双轴、B一轴或双轴；具体字段/幂等/来源限制见EDGE04.md。GET状态新增gauges.A/gauges.B及配对窗；Sample新增gauge/mean/sheath，旧数据按A读取。本轮中心OVALITY通道仍仅A，护套厚度不伪装为OVALITY上传。
