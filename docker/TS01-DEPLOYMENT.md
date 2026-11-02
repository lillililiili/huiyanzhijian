# TS01 中心不圆度时序存储

仅OVALITY原始采样/测量值进入中心InfluxDB2.9.1；另两指标继续PG。任务/账号/规则/审计/报告/判定/去重索引也继续PG。不直接连接边缘库，沿用边缘鉴权上传HTTP契约。

从工程根执行（先备份PG与现有镜像，保留runtime凭据及数据卷）：

```powershell
node tools/prepare-ts01.cjs
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps ovality-timeseries
node tools/prepare-ts01.cjs authorize
```

需等待InfluxDB健康再authorize。管理凭据仅runtime/ts01/influx-init.env；backend仅挂载限制在ovality-samples桶的读写token。中心4206仅loopback，容器内部8086。桶默认不自动过期，生产保留期/容量待确认，不静默删历史。

新数据库运行平台db/migrate.ts应用全部迁移。已部署014的数据库可用下列015定向脚本。2026-10-30实际发现001/010/011旧迁移校验值与磁盘文件不同；本包没有修改旧校验值或重跑旧脚本，该历史漂移需另行核查。

迁移旧采样使用apps/platform/db/relocate-ovality.ts：仅运维角色，在核验备份后执行。工具逐批写入、回读hash/精确值比对后才把PG原文改为引用，值清空并标记INFLUXDB；绑定/时间/判定/快照不变。故障可重复运行，不重复生成业务记录。为避免旧后端读到引用，切换时停止backend，迁移成功后用新镜像和上述两个compose文件启动backend。边缘暂时保持待传，不清队列。对新部署先配置时序服务后启动backend；不能只使用旧b1.compose启动而丢失新增时序配置。

```powershell
# 在工程根；先完成并核验数据库备份，构建 apps/platform。
$env:TS01_BACKUP_CONFIRMED='yes'
$env:OVALITY_INFLUX_URL='http://127.0.0.1:4206'
$env:OVALITY_INFLUX_ORG='huiyan-center'
$env:OVALITY_INFLUX_BUCKET='ovality-samples'
$env:OVALITY_INFLUX_TOKEN_FILE=(Resolve-Path runtime/ts01/secrets/runtime.token).Path
node --env-file=runtime/b1/local.env tools/migrate-ts01.cjs
# 确认上一命令成功后：
node --env-file=runtime/b1/local.env apps/platform/dist/db/relocate-ovality.js
```

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build backend
```

健康接口保留database字段，新增ovality_timeseries UP/DOWN。时序不可用不关闭其他指标；涉及外置记录的查询/写入返回503 TIMESERIES_UNAVAILABLE，可重试，不伪造空数据。边缘200回执只在时序204与PG提交均成功后获得。PG失败而时序成功的孤立点不在PG索引，不会被页面展示，重试复用点身份。

备份必须覆盖PG、InfluxDB数据与组织/桶、凭据以及部署配置。仅恢复PG将留下不可读的时序引用。回退须先停写并从时序逐条回填PG原文/数值、核对后再恢复旧应用；禁止仅替换旧镜像导致将引用当原文。旧报告快照不需要重建。原备份不能直接覆盖升级后的新增业务数据。

本包不更新公式/单位，不增加护套厚度中心指标，不代表HW或客户MES已通过。高频长稳、存储容量及保留策略另行验证。

本地完成记录：2026-10-30迁移1000条OVALITY；SHIELD_OVERLAP_RATE 712条、WIRE_GAP 200条仍在PG。全部1912条原文/值/身份逐条hash对账一致；规则/判定/业务快照表一致。并发增加的一个登录会话和审计事件单独保留，备份恢复库对照确认旧行全部仍在。

备份在runtime/ts01/backup-20261030，含pg_dump、SHA256、前后manifest、Influx原生backup。PG备份已恢复到隔离hy_ts01_restore_20261030并回读1912条。Influx备份已生成，尚未演练完整双库灾备切换。后端原镜像保留为huiyan-backend:before-ts01-20261030；旧前端容器指向的镜像在执行前已不可被Docker检索，未取得该镜像的可用回退标签，不能宣称前端旧镜像已备份。此次前端仅追加时序健康状态显示，业务源文件保留现有同期变更。
