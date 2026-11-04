# M09 边缘配置公开接口 · EDGE05

`synchronization.ts` 属于M09中心配置适配，持有`m09.edge_point_sync`表。仅依赖M00公开鉴权/command幂等/审计、M01公开设备查询和基础设施连接池；不跨模块写表。Go现场程序只调用HTTP契约，不链接平台实现。

- GET `/api/v1/admin/edge-sync`：当前工厂已安装目标及配置/回执；USER settings:write。
- POST `/api/v1/admin/edge-sync/:device`：CSRF、Idempotency-Key、If-Match；body为delay_ms、tolerance_ms、upstream_gauge、reason。参数无默认值，版本递增与审计同事务。
- 安装配置`EDGE_SYNC_TARGETS_FILE`为JSON数组，字段factoryId/deviceId/url/token；网页无法写地址或令牌。凭据不进入数据库配置/响应/审计。
- 主动推送`POST /edge/v1/sync-config`：设备ID、版本及毫秒参数；4秒超时，不跟随跳转；15秒重试/回读幂等ACK。库中保存期望/接收/本盘版本，区分PENDING、RETRYING、NEXT_RUN、ACTIVE；失败不冒充成功。
- 同设备配置更新与推送使用同一事务锁，避免乱序；边缘持久化拒旧版并冻结本盘。

012增量迁移已部署。用户要求不测试，本包仅构建/部署健康核查，业务和HW未验证。现场Go契约见外层`边缘设备/edge-app/EDGE05.md`。


## EDGE07（2026-10-30）
当前入口4182/#initialization。POST /admin/edge-sync/:device只接受distance_mm正整数（1～2147483647）与reason；机器推送deviceId/revision/distanceMm。旧delay_ms请求被拒绝，013仅新增距离并保留历史时间。计米器时间由边缘的SIMULATED采样路径获得，后台不填写、不换算。详细契约见边缘设备/edge-app/EDGE07.md。
