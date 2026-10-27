# 平台后端：B1基础包

Node/TypeScript 模块化平台，使用 PostgreSQL 保存业务数据。本目录是 API 实际源码；已交付能力和未实现范围按根目录模块台账、页面台账及工作包记录，不将规划中的全部 M00–M07 能力都视为完成。

从项目根运行`node tools/b1.mjs init`初始化本地隔离环境，之后`node tools/b1.mjs start`启动；`node tools/b1.mjs status`看状态。API http://127.0.0.1:4192/api/v1/health/ready 。固定档案保留，不自动生成工单、任务或检测数据。

详见[后端与数据库工作包](../../docs/workpackages/B1_后端数据库与设备模拟器.md)、[数据库及日志方案](../../docs/workpackages/B1_数据库物理设计与日志方案.md)、[字段字典](../../docs/workpackages/B1_数据库字段字典.md)、[人员API](../../contracts/platform/B1-api.md)。设备契约和已实现版本以 `contracts/devices/` 为准。

本地开发：先准备runtime/b1配置与PG容器；在本目录`npm ci --ignore-scripts`、`npm run build`，再`node --env-file=../../runtime/b1/local.env dist/composition/supervisor.js`。4192被Docker占用时不要同时起本地进程。迁移仅显式`npm run migrate`（须注入迁移凭据），运行进程无DDL权限。

在本目录`npm test`会创建独立测试数据库，API端口4194，先构建tools/simulator；不会改验收库。根目录`node tests/backend/docker-smoke.mjs`验证隔离容器及备份恢复。

源码在模块各自 `api.ts`，依赖公开服务而非其他模块表；基础SQL/事务在 `infrastructure/`，组合路由/worker在 `composition/`。数据库变更使用 `db/migrations/` 中新增的编号迁移。包内 `package-lock.json` 固定构建依赖，运行凭据只从本机 `runtime/b1/` 读取，不提交到仓库。
