# SIM05 主平台与模拟器目录同步

2026-10-27，B类增量；已部署、自测通过，待用户验收。

## 权威数据与公开查询

- PostgreSQL M02：工单、主盘/成员、任务；M01：规格/设备；M04：已存储测量。模拟器只通过HTTP读取。
- GET `/api/v1/simulator/catalog`：仅DEVICE且SIMULATED凭据，按工厂和授权设备过滤。参数`page`(1..100000)、`limit`(1..100，默认20)、`q`(128字内盘号/工单/根ID)、`status=all|pending|tested`、`id`(主盘ID)。返回`items,total,page,limit,as_of,devices,factory_id`。人员会话/REAL拒绝403；未知ID为空，保存/运行明确404/409。
- M04公开`simulationSampledTasks(actor,db)`提供授权设备STORED模拟记录任务ID；M02公开`SimulationQueries.catalog`负责分页及任务关系；composition组合M01公开档案读取。同一只读REPEATABLE READ事务，不跨模块写表。
- 主盘含REAL任务时不进入模拟目录。其余主盘包含尚无任务线缆；关联任务仅返回凭据授权的模拟设备任务。每盘最多最新200任务并返回`tasks_truncated`；完整业务历史仍在主平台。
- `has_samples`按接收事实分类，不由任务ENDED或模拟运行COMPLETED推断。设备停用保留展示但禁止新送料。

## 模拟器本地接口与身份

- GET `/api/catalog`需既有模拟器会话；POST `/api/catalog/cables|detectors`需会话和CSRF，body=`source_id,version,data,reason`。保存前重新查询来源，服务端覆盖身份字段。
- 线缆预设ID=主盘UUID，`material_ref=platform:<UUID>`不可解除或换绑。设备预设ID由工厂+设备ID确定，避免本地重复模型。配置保存使用现有model_revision版本控制；无PG/SQLite迁移。
- 目录刷新只读，不生成模型/任务/样本。盘号更新同步展示；新运行使用最新盘号，已有run快照、补传和原始记录不改写。同名盘靠ID分开，不按名称合并。
- 开始送料必须明确任务ID与成员spoolID，设备、指标、根归属一致；BOUND要求RUNNING，AUTO要求CREATED/RUNNING；随后再次核对真实设备绑定。主平台发生变化则拒绝，不补猜ID。保留既有幂等重试。
- 预设真值/缺陷清单不作为检测输入上传；仍由设备模型计算观测值，通过原接收契约落PG。
- 原`/models`接口及历史保留兼容，已关联预设不能通过旧接口解除平台绑定。主目录不混入未关联旧模型。
- GET `/api/ui-config`返回可配置主平台URL，无凭据暴露。浏览器不会持有DEVICE_TOKEN。

## 部署与回滚

在项目根目录执行（先确认没有活动模拟采集，备份数据）：

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml build --pull=false backend
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml up -d --no-deps --no-build --pull never --wait backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml build --pull=false simulator
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps --no-build --pull never --wait simulator
```

单独停止/恢复模拟器使用`node tools/simulator.mjs stop` / `start`，保留卷。后端可用对应compose `stop backend` / `up -d --no-deps --no-build --pull never --wait backend`。本次保留回滚标签`huiyan-backend:before-sim05-20261027`及`huiyan-simulator:before-sim05-20261027`；需要回滚时先停止采集，将旧标签重新tag为原服务image后仅重建这两个容器，不回滚数据、不删卷。

备份：本地`runtime/sim05/backup-before-SIM05.dump`；模拟器卷`/data/backup-before-SIM05-20261027.sqlite`。前后业务表摘要相同；前端4181/管理4182/数据库容器身份不变。

## 证明范围与限制

隔离真实PG/HTTP、真实浏览器闭环通过；共享站点只读核查34盘、3授权设备、原数据保留。HW/MES未验证。目录为约5秒轮询，不是推送或跨浏览器同一时刻事务；断连显示同步失败并阻止新送料。平台新设备需要既有凭据授权，不在本包自动授予权限。
