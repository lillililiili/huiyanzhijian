# DB01 部署与迁移

2026-11-02：4192已更新，自测待验收。生产数据保留，其他服务未重建。

1. 先备份PG并恢复验证；只以hy_migrator执行迁移。运行服务仍使用hy_runtime。
2. 在apps/platform执行npm run build，再运行node dist/db/migrate.js --check --through 016a_startup_views.sql。需要外部安全注入MIGRATION_DATABASE_URL，不将凭据提交Git。
3. 确认只补016a后，移除--check应用。再次--check应pending=[]。001/010/011精确恢复；历史登记不得改写。LF/CRLF等价，其余内容漂移必须失败。
4. 017属于未部署设备接口工作，不在本次范围。不能使用无截止参数的迁移命令替代上述命令。
5. 本轮使用DB01.backend.Dockerfile基于已核对的PERF02镜像增量构建，替换6个编译文件与4份迁移，不夹带其他agent未部署源码。完整重建时应重新核对共享源码和已批准迁移。
6. docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build --pull never backend。
7. 检查health/ready、日志API_READY、无启动权限错误；核对PG原卷、采样数量和其他容器未重启。

当前镜像：huiyan-backend:db01-20261102，sha256:bfbe8f7312d810e4a106b89f3d53de5a6f153da35869e948448114aa988bd2e9。
回退：确认无人更新后，将huiyan-backend:db01-base-20261102重新标记为huiyan-backend:b1，按同一Compose命令只更新backend。四个追加视图向后兼容，不删表、不删除迁移记录、不恢复覆盖生产数据。

启动缺视图或权限时会明确失败，由supervisor重试；必须完成迁移，不得给运行角色DDL权限来绕过。视图只有SELECT权限。数据库测试与备份路径见临时文件夹/DB01_数据库启动与迁移修复/验收记录.md。
