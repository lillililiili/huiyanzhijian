# PAR01 部署

2026-11-03；4192和4196已部署，自测通过待用户验收。无迁移，不重启边缘/PG/InfluxDB/中心页面。

镜像：huiyan-backend:par01-20261103（基于sc04）；huiyan-simulator:par01-20261103（基于sim12）。仅覆盖本轮11个构建文件，保留其他会话功能。构建目录runtime/par01/images；部署配置与原环境逐字段核对一致。

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml -f runtime/par01/backend.override.yaml up -d --no-deps --no-build --pull never backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml -f runtime/par01/simulator.override.yaml up -d --no-deps --no-build --pull never simulator
```

更新前确认4196无STARTING/RUNNING/STOPPING送料，不终止他人执行。原46290样本保留，两服务healthy；其他37个既有容器ID/镜像/启动时间不变。

回退至部署前：backend使用runtime/sc04/backend.override.yaml；simulator使用runtime/sim12/simulator.override.yaml。执行前核对后续发布，不能覆盖其他会话新版本。数据库无回退操作。
