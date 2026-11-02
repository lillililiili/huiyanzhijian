# SC02 部署与回退

2026-11-02；4181/4192/4196及Go边缘1.7.0已部署，自测通过待用户验收。

## 1 更新（完成）

沿用现有环境文件，未拉取新镜像，无数据库迁移。

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml build --pull=false backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml build --pull=false simulator
docker compose -f docker/compose.yaml build --pull=false web
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps --no-build simulator
docker compose -f docker/compose.yaml up -d --no-deps --no-build web
```

边缘使用既有Go工具链构建，先通过go test -race ./...。只替换/config/huiyan-edge/bin/huiyan-edge；原edge.env增加EDGE_SCAN_DEVICE_ID=HY-BY-01，备份为edge.env.before-sc02。检查无采集和待传后停止确切应用PID，由原supervisor恢复；不重启桌面容器。原监督脚本同时恢复本地Influx服务，数据目录与卷保持不变。

## 2 验证（通过）

4192健康检查：PG/中心Influx正常，已启用分析进程有心跳；不表示分析业务全部实现。4181/4192/4196健康。边缘1.7.0、历史30000条、时序待写与中心待确认均0。中心16912条记录/16912条值/14个任务与更新前一致。

## 3 回退准备（已保留）

- runtime/sc02/backup/platform.dump：更新前PG custom备份。
- runtime/sc02/backup/huiyan-edge：旧边缘二进制。
- huiyan-web:before-sc02-20261102、huiyan-backend:before-sc02-20261102、huiyan-simulator:before-sc02-20261102：旧镜像标签。
- 验收目录“部署与源码校验.json”：新镜像、源文件与边缘二进制SHA256。
- 无结构迁移，应用回退不需要恢复或覆盖数据库。只有边缘无采集、无待同步意图且待传安全时才回退；回退前核对中心当前任务，避免恢复旧人工流程导致重复启动。
- 本轮没有执行完整灾备恢复演练。

## 4 使用（待用户验收）

中心新建不圆度任务并下载任务码→边缘开机→扫码枪扫描→自动开始→模拟器独立送料→再次扫同设备新任务码完成换盘→关机同步结束。扫码本身不生成读数。已结束/取消任务码不能重新启动；复检应新建任务。护套辅助结果仍依赖已配置同步参数及实际B读数。
