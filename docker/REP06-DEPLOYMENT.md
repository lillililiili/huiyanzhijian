# REP06部署

2026-11-04，仅4181 huiyan-web:rep06-20261104。基底为当时运行的imp02-20261104，完整源码比较匹配后集成单文件reporting/render.ts，编译dist；镜像FROM当前运行IMP02。沿用全部现存compose配置，追加runtime/rep06/web.override.yaml，环境逐项核对不变，--no-deps --no-build --pull never仅更新web。其他7运行容器不变，无迁移。回退只切huiyan-web:imp02-20261104，不回退数据库/报告。提交0547c1d；自测通过待用户验收，未冻结。证据见临时文件夹/REP06_实际大范围报告分页复核。
