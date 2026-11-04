# IMP02 部署记录

2026-11-04。仅4181 web发布，已健康，自测待用户验收。

- 基线：huiyan-web:rep05-20261104；源码来自已核实REP05工程，仅覆盖IMP02导入文件，哈希见runtime/imp02/source-manifest.json。
- 新镜像：huiyan-web:imp02-20261104；候选工程runtime/imp02/release-web；部署脚本runtime/imp02/deploy.cjs。
- 发布复用当前容器的完整Compose文件与环境，通过覆盖文件仅更新web；使用--no-deps --no-build --pull never。发布前检查当前容器ID、镜像和环境未被并行会话修改。
- 4192仍为huiyan-backend:rep04-20261104；其余7容器ID/镜像/启动时间不变。无迁移、卷删除或后端重启。
- 回退仅web镜像至REP05基线，沿用当前完整Compose链及环境，不执行down、不更改数据卷。
- 验收见临时文件夹/IMP02_业务CSV导入与字段校验/验收记录.md。后续发布应从当前源码构建并保留IMP02和其他会话修改。
