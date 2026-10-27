# Docker 部署

本文说明仓库内业务运行栈。命令从仓库根目录执行；Compose 不会自动拉取基础镜像。

## 本机首次启动

需要 Docker Desktop 和 `node:22-bookworm`、`postgis/postgis:16-3.5`、`nginx:1.27-alpine` 镜像。先按环境策略准备基础镜像，再执行：

```powershell
node tools/b1.mjs init
docker compose -f docker/compose.yaml up -d --build --pull never web
docker compose -f apps/admin-web/compose.yaml up -d --build --pull never admin-web
node tools/simulator.mjs init
```

`tools/b1.mjs init` 会在本机 `runtime/b1/` 生成随机凭据，启动 PostgreSQL，构建平台 API 与 CLI 模拟器，执行数据库迁移和初始档案引导。之后启动业务前端、管理前端和独立模拟器 Web。API 数据库密码、设备令牌和模拟器登录密码都在本机配置中，不要提交到 Git。

| 服务 | 地址 | Compose 文件 |
|---|---|---|
| PostgreSQL | 127.0.0.1:4193 | `docker/b1.compose.yaml` |
| 平台 API | http://127.0.0.1:4192/api/v1 | `docker/b1.compose.yaml` |
| 业务前端 | http://127.0.0.1:4181/ | `docker/compose.yaml` |
| 管理前端 | http://127.0.0.1:4182/ | `apps/admin-web/compose.yaml` |
| 模拟器 Web | http://127.0.0.1:4196/ | `tools/simulator/compose.yaml` |

## 日常运行

```powershell
node tools/b1.mjs start
node tools/simulator.mjs start
docker compose -f docker/compose.yaml start web
docker compose -f apps/admin-web/compose.yaml start admin-web
```

分别停止服务：

```powershell
node tools/simulator.mjs stop
docker compose -f apps/admin-web/compose.yaml stop admin-web
docker compose -f docker/compose.yaml stop web
node tools/b1.mjs stop
```

这些命令保留 PostgreSQL 命名卷和模拟器 SQLite 卷。不要用 `docker compose down -v` 清理含业务数据的卷。数据库备份运行 `node tools/b1.mjs backup`，备份写入本机忽略目录 `runtime/b1/backups/`。

## 构建边界

业务前端由根 `docker/Dockerfile` 构建 `apps/web/`；管理前端由 `apps/admin-web/Dockerfile` 构建。API 和 CLI 模拟器使用 `docker/B1.backend.Dockerfile`、`docker/B1.simulator.Dockerfile`，PostgreSQL 表字段通过 `apps/platform/db/migrations/` 的编号 SQL 管理。4196 Web 模拟器独立构建 `tools/simulator/`，状态保存在它自己的命名 SQLite 卷，检测记录只经设备 API 写入平台数据库。

依赖由各包的 `package-lock.json` 固定，`node_modules/`、`dist/` 和本地运行状态不入库。Docker 构建需要能访问 npm registry，除非已配置可用的本地缓存。服务默认绑定回环地址，适合本机联调；部署到局域网或公网时应按实际域名配置 HTTPS、API 上游和访问策略。

## 演示前端

`web/` 中的 localStorage 演示前端单独保留，不连正式 API。需要运行该演示时使用 `docker/demo.compose.yaml` 和 `docker/Demo.Dockerfile`；默认业务入口 `docker/compose.yaml` 部署的是 `apps/web/` 正式业务前端。

业务和管理端的地址配置、独立更新和回滚方法见 [AD02 部署说明](AD02-DEPLOYMENT.md)。
