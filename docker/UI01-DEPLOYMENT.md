# UI01 联调界面文案部署

2026-11-03，已部署，自测通过待用户验收。应用镜像基于ODM03运行版本追加编译产物，不包含数据库迁移。

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml -f runtime/ui01/backend.override.yaml up -d --no-deps --no-build --pull never backend
docker compose -f docker/compose.yaml -f runtime/ui01/web.override.yaml up -d --no-deps --no-build --pull never web
docker compose -f apps/admin-web/compose.yaml -f runtime/ui01/admin-web.override.yaml up -d --no-deps --no-build --pull never admin-web
```

镜像：huiyan-web:ui01-20261103、huiyan-admin-web:ui01-20261103、huiyan-backend:ui01-20261103。构建目录runtime/ui01/{web,admin-web,backend}。实际构建来源_worktrees/UI01-production-copy已合入共享ODM03源码；共享工程只集成本轮文案差异，见临时文件夹/UI01_联调界面文案整理/UI01-only.patch。

边缘4198保持正在运行的Go1.9.0；packaging/nginx.conf只对HTML精确替换旧说明，nginx -t后nginx -s reload。源web/index.html已更新，下一次正常原生打包生效后可移除sub_filter。不要因本轮文案发布替换正在采集的Go程序。

回退：中心使用runtime/odm03的web/backend覆盖文件，管理后台恢复huiyan-admin-web:local；边缘恢复runtime/ui01/nginx.before.conf并先校验再reload。回退前核对其他会话是否有更晚发布，不直接覆盖后续变更。数据库无需回退。
