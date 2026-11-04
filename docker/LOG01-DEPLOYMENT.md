# LOG01 管理后台日志部署

2026-11-02：4182/4192已更新且健康，自测通过待验收。保留DB01/PERF02、中心时序配置和业务数据。

数据库升级使用迁移身份，先备份。运行完整预检并显式截止 `016b_runtime_log_context.sql`，只允许本次日志迁移；017设备接口迁移不在本包。运行账号不增加DDL权限。

```powershell
# 在apps/platform，以私有环境注入MIGRATION_DATABASE_URL后
node dist/db/migrate.js --check --through 016b_runtime_log_context.sql
node dist/db/migrate.js --through 016b_runtime_log_context.sql
node dist/db/migrate.js --check --through 016b_runtime_log_context.sql
```

本次使用已核对运行镜像为底的增量镜像：只覆盖main/runtime-log/structured-log/db/M00 api五个编译文件及016b迁移；admin镜像替换静态dist。不要用未审核的全目录重构建夹带017或其他未上线改动。

```powershell
docker tag huiyan-backend:log01-20261102 huiyan-backend:b1
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build --pull never backend
docker tag huiyan-admin-web:log01-20261102 huiyan-admin-web:local
docker compose -f apps/admin-web/compose.yaml up -d --no-deps --no-build --pull never admin-web
```

缺省LOG_LEVEL=INFO。只在有时限的排查窗口通过后台服务环境设置LOG_LEVEL=DEBUG；会记录普通成功查询与心跳，应及时恢复。WARN/ERROR默认始终记录。慢请求阈值1000ms。JSON单行输出；PG7天/约100000行，Docker json-file 10m×5。匿名/启动故障、PG写日志失败时按request_id查容器输出；不经网页读取Docker文件或socket。

PG日志独立2连接、1秒连接/语句超时、64挂起上限；过载保留stdout、汇总RUNTIME_LOG_UNAVAILABLE，未实现持久补写。运行日志不是不可篡改审计档案，原业务审计单独保存。

回退前确认没有后续部署。恢复 `huiyan-backend:log01-base-20261102` 与 `huiyan-admin-web:log01-base-20261102` 到对应运行tag，再按上述命令只更新对应服务。016b为向后兼容追加字段，保留字段与迁移登记，不删除/覆盖现有数据。备份在runtime/log01/logs-before.dump，含私有日志，不发布。

完整证据与最终镜像SHA：[验收记录](../临时文件夹/LOG01_管理后台日志整改/验收记录.md)。
