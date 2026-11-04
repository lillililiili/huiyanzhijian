# IMP03 部署

2026-11-04，仅业务前端4181更新到huiyan-web:imp03-20261104-final，healthy。保留REP06报告分页及IMP02 CSV限定；其余7容器不变。

候选runtime/imp03/release-web，来源最新已部署REP06；最终静态资源index-BKtfgIuL.js。runtime/imp03/deployment.json记录compose文件顺序、原镜像及8个源码文件哈希；runtime/imp03/containers-before.json为其他容器对照。

使用本地REP06镜像作基础、--pull=false构建；仅compose up -d --no-deps --no-build --pull never web。无API变更、数据库迁移或数据卷替换，不需拉包。

部署脚本deploy.cjs/deploy-final.cjs含基线与并发修改检查，只用于本轮发布审计，不直接重复运行。后续重发先核实当前服务/源码及其他agent发布，合并最新改动后重新构建。最终验证node runtime/imp03/verify-db.cjs；测试明细见临时文件夹/IMP03_业务关联导入与页面一致性/验收记录.md。
