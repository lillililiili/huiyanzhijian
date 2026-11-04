# ODM03 本地部署记录 · 2026-11-03

本次使用独立镜像标签，未覆盖其他agent原有镜像标签。后续部署应重新构建最新源码，避免只运行旧默认镜像造成回退。

- 4181：huiyan-web:odm03-20261103
- 4192：huiyan-backend:odm03-20261103
- 4196：huiyan-simulator:odm03-20261103
- PG新增018订单绑定表，017厂家原文版本注册已执行；无OVALITY时序结构/Go改动。

工程根执行：
```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml -f runtime/odm03/backend.override.yaml up -d --no-deps --no-build backend
docker compose -f docker/compose.yaml -f runtime/odm03/web.override.yaml up -d --no-deps --no-build web
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml -f runtime/odm03/simulator.override.yaml up -d --no-deps --no-build simulator
```

必须保留ts01覆盖文件、现有环境及数据卷。三服务部署前逐项对照现有容器环境，差异键为0。未改变端口绑定或扩大鉴权范围。

备份：runtime/odm03/backups/before-018.dump（PostgreSQL完整自定义格式），simulator-before.sqlite（VACUUM INTO一致备份）。源码覆盖前备份runtime/odm03/source-backup；逐文件SHA256清单integrated.json。备份含内部数据，不对外分发。

回退应用时参考containers-before.json中原镜像ID，生成相应镜像覆盖文件再只更新指定服务；旧镜像标签仍在。保留新增表和SQLite追加表，不删历史、不自动恢复整库覆盖新数据。若需数据库恢复，单独确定维护窗口与增量数据处理。

验证证据：runtime/odm03/migration-check.log、migration-apply.log、deployment-result.json。隔离模拟API/SQLite在44692/44696，预览44681；这些不是正式服务端口，测试数据不进入正式PG。


### 并行部署补记（2026-11-03 收尾核查）
ODM03部署完成后，UI01又更新4181/4192为huiyan-web:ui01-20261103、huiyan-backend:ui01-20261103；4196仍为huiyan-simulator:odm03-20261103，三者healthy。本次只读核查确认新中心镜像保留设备订单面板、查询接口、扫码冲突和原文核验；真实GET odm-scan-preview返回200并对应原任务/设备。未反向覆盖UI01。前述36容器不变仅指ODM03自身部署时点，不含UI01后续部署。后续不要重跑旧ODM03中心覆盖命令导致UI01回退，应基于最新源码和当前部署。证据runtime/odm03/final-concurrent-deployment.json。
