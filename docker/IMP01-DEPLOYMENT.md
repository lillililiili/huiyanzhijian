# IMP01 数据导入配置部署

2026-11-03，已部署4181，自测通过待用户验收。

- 基线：huiyan-web:rep03-20261103-r2，已含REP03/UI03/NAV02/UI02/MON01。
- 新镜像：huiyan-web:imp01-20261103；仅替换web静态资源，健康检查通过。
- 后端继续huiyan-backend:rep03-20261103；无API、迁移、凭据、数据卷或时序配置变更。
- 发布前后另外7个运行容器ID、镜像、启动时间一致。

构建源码：以runtime/rep03/release-web/src为已发布基线，在_worktrees/UI02-clean-content/web叠加IMP01文件；共享入口只增加导入页路由、导航名称、按需加载设置。未用文档Git提交号代表应用源码。

构建/部署记录：runtime/imp01/rebase.cjs、deploy.cjs、deploy-plan.json、containers-before.json。部署沿用当前web容器标签里的全部Compose文件与env文件，再叠加runtime/imp01/web.override.yaml；使用up -d --no-deps --no-build --pull never web。两次检查运行镜像/容器ID，发现其他会话发布即停止重新合入；不得直接重跑旧基线脚本覆盖后续版本。

未拉取新基础镜像；本地FROM当前已部署镜像。回退仅web镜像，保留已有Compose组合，不执行down -v。验收文档见临时文件夹/IMP01_数据导入配置/验收记录.md。
