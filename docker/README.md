# 本地 Docker 部署

运行入口及版本边界见 [运维说明](../docs/OPERATIONS.md)。本目录不是只有前端的演示工程，中心 API、数据库和时序服务已启用。

| 配置 | 服务 |
|---|---|
| compose.yaml | 4181 业务前端 |
| b1.compose.yaml + ts01.compose.yaml | 4192 后端、4193 PG、4206 中心时序 |
| ../apps/admin-web/compose.yaml | 4182 管理后台 |
| ../tools/simulator/compose.yaml | 4196 模拟器 |

后端必须组合 b1 与 ts01，不单独启动 b1 覆盖现有时序配置。模拟器及 Go 边缘使用各自部署脚本。

- [中心时序与迁移](TS01-DEPLOYMENT.md)
- [管理前端与地址配置](AD02-DEPLOYMENT.md)
- [扫码驱动任务](SC02-DEPLOYMENT.md)
- [重复扫码分次采集](SC03-DEPLOYMENT.md)
- [当前联调阻塞与资源问题](../docs/HW-READINESS.md)

升级前核对目标服务、镜像、配置、迁移和备份，只更新已授权服务。不删除数据卷、不重启未知容器。当前 PG 默认 64 MiB shm 已在并发查询中报不足，需专项验证后调整；本轮未修改配置。
