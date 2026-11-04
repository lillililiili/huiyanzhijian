# REP04 本地部署记录

2026-11-04：4181 huiyan-web:rep04-20261104-r2；4192 huiyan-backend:rep04-20261104。自测通过待用户验收，未冻结。

以本次运行中的IMP01前端、REP03后端为基底，前端完整dist，后端仅覆盖两个报表模块JS；compose沿用容器标注的全部配置文件（含b1、ts01），追加runtime/rep04/backend.override.yaml和web.override.yaml。只对backend/web执行--no-deps --no-build --pull never。环境键逐一核对不变。无迁移，不重建数据库/时序/边缘/模拟器。

回退镜像为huiyan-web:imp01-20261103和huiyan-backend:rep03-20261103；新REP04快照字段是追加，旧读取保留兼容。回退只切相应镜像，不回滚数据库或报告记录。当前有效配置与证据见runtime/rep04/deploy-plan.json、deployment-verification.json及临时文件夹/REP04_报告样式一致与自适应分页。
