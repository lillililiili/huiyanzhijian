# 中心系统统一分组（2026-11-04）

本机当前使用 `center.compose.json`，Docker Desktop 仅显示以下三个慧眼智检分组：

| 分组 | 服务 | 入口 |
|---|---|---|
| huiyan-center | web、admin-web、backend、database、ovality-timeseries | 4181、4182、4192；数据库4193、时序4206 |
| huiyan-simulator | simulator | 4196 |
| huiyan-edge | Ubuntu边缘终端、app-access代理 | 4198；Ubuntu桌面3000 |

分组可整体启动/停止，各容器仍独立。中心合并不改变账户、数据库和接口。模拟器与边缘分组保留原配置和容器。

## 本机启动和停止

在工程根目录执行：

```powershell
# 启动中心（使用现存镜像，不构建、不拉取）
docker compose -f docker/center.compose.json up -d --no-build --pull never

# 停止中心，保留容器和数据
docker compose -f docker/center.compose.json stop

# 检查，包括停止的容器
docker compose -f docker/center.compose.json ps -a
```

也可以在 Docker Desktop 点击 `huiyan-center` 分组的启动/停止按钮。使用时先启动中心，再启动边缘和模拟器；停止前先停止送料/采集并确认待传队列，再停止模拟器、边缘和中心。

## 配置与数据保护

- 现行镜像：web/backend `bc02-20261104`，admin-web `ui01-20261103`，沿用原PostGIS16和InfluxDB2.9.1。
- 沿用已有 `huiyan-b1_b1-database`、`huiyan-b1_ovality-timeseries-data`、`huiyan-b1_ovality-timeseries-config`，声明为外部卷，不创建替代空库。
- 复用原网络，保留服务名及旧容器名DNS别名。网络名称仍包含b1/local/admin，不代表额外容器分组。
- 各服务原环境参数保存在被Git忽略的 `runtime/center-group-20261104/*.env`；Compose使用raw格式读入，避免令牌中的特殊字符被替换。不要提交或公开这些文件。
- 保留原edge-sync、时序凭据挂载和PG初始化脚本路径。移动工程后需要校正绑定路径；本配置针对当前本机。
- 不执行 `down -v`、删除卷或初始化数据库。

## 后续更新与历史配置

本机不再使用 `docker/compose.yaml`、`apps/admin-web/compose.yaml` 或旧b1+ts01覆盖链创建中心服务，否则会再次出现旧分组和端口冲突。它们作为历史/工程参考保留。

更新中心某服务时，在当前配置修改对应镜像，再定向执行：

```powershell
docker compose -f docker/center.compose.json up -d --no-deps --no-build --pull never web
```

其他服务将末尾web替换为admin-web/backend等；数据库升级须另行确认迁移与备份。之前的BC02等部署命令及 `tools/b1.mjs start/init` 不应用于覆盖本机当前分组。

用户先前生成的离线打包文件未自动改写；若需要交付也显示三个分组，应将本次配置变更纳入下一次打包，并按交付流程处理凭据和外部卷。

## 本次验证范围

中心5容器已重建为huiyan-center，未启动；保持原停止意图。镜像ID、环境、入口命令、端口、挂载卷/绑定、健康检查、用户、shm和日志策略逐项一致。原中心5容器已删除且未删卷；其他17容器（含模拟器/边缘及14个其他项目容器）ID、镜像、启动时间和状态不变；全部卷清单一致。

本次仅验证配置和资源，不声称已完成启动后业务健康检查。证据见 `runtime/center-group-20261104/result.json`。
