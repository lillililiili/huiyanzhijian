# 本地运行与部署

> 2026-11-04 当前本机中心部署已合并为 `huiyan-center`，使用 `docker/center.compose.json`。模拟器与边缘分别保持 `huiyan-simulator` / `huiyan-edge`。具体命令和数据卷保护见 [中心分组部署说明](../docker/CENTER-GROUP-DEPLOYMENT.md)；下方旧b1/ts01命令保留作历史参考，不覆盖当前配置。

端口与服务：4181 业务前台、4182 管理后台、4192 平台 API、4193 PostgreSQL、4196 模拟器、4198 边缘访问代理、4206 中心 InfluxDB。具体端口以 Compose 为准；3000 桌面容器不等于生产现场部署。

## 已配置环境的只读检查

```powershell
docker ps
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml ps
Invoke-RestMethod http://127.0.0.1:4192/api/v1/health/ready
```

健康接口需要同时检查 `database` 和 `ovality_timeseries`；HTTP 200 或容器 healthy 不能证明所有依赖、分析业务及真机已通过。

## 新环境与升级

1. 使用各子工程 lockfile 安装依赖；镜像与版本以 Dockerfile/Compose 为准。
2. 本地生成 `runtime` 配置，不能复制仓库中的历史测试密码作生产账号。令牌、数据库密码、Cookie 和备份不得提交。
3. 阅读 [TS01 部署](../docker/TS01-DEPLOYMENT.md)、[管理前端部署](../docker/AD02-DEPLOYMENT.md)及模拟器/Go 边缘各自说明。
4. 新环境必须配置中心时序后启动后端；后端 Compose **同时使用 b1 与 ts01**。旧 `node tools/b1.mjs start/init` 仅使用 b1，不适合直接替代当前完整部署步骤。
5. 当前库 001/010/011 校验漂移未解决。先在隔离库验证升级方案，不可通过改 checksum 或反复 bootstrap 绕过问题；017 在本次检查时未部署。
6. 更新某服务时只构建/重建该服务，保留数据卷；禁止 `down -v` 清空业务数据。审查报告发布不要求重启运行平台。

## 数据恢复

备份 PostgreSQL、中心 InfluxDB、边缘持久队列/本地时序及所需受控配置。恢复应在隔离环境核对记录 ID、采样时间、精确值、任务归属、判定与原文 hash，再验证重复补传不增加业务行。PG 单独恢复不足以恢复 OVALITY 原文。当前联合灾备切换尚未验收。

上线前确认设备数、频率、网络、磁盘、保留期和恢复目标；完成 shm/连接池修复及权限审查。详细门槛见 [HWREADY01](HW-READINESS.md)。


2026-11-02 DB01：启动权限及迁移漂移已修复并部署4192；迁移须显式截止016a，未部署017保持不动。见[部署说明](../docker/DB01-DEPLOYMENT.md)。STAB01隔离恢复首轮通过，不代表真机或长期容量验收。
