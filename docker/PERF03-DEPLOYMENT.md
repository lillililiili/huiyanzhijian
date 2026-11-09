# PERF03 部署与恢复

保持Node.js唯一中心后端。镜像 huiyan-backend:perf03-20261109。

设置 SPLIT_WORKLOADS=true 时，supervisor在单容器内启动online/ingest/reports三个独立Node进程及原心跳进程，统一4192入口，内部4193/4194/4195仅回环监听。业务连接池分别6/4/2，各进程日志池仍独立；共享数据库与磁盘并未物理隔离。

网关不重试写请求；超载/子进程恢复返回503和Retry-After，客户端保留来源键/命令键。报告并发2、采集12、在线40。子进程退出2秒后重新启动。关闭SPLIT_WORKLOADS可退回单API进程。

时序每组最多50点预写，线协议按1MiB/100点拆分，成功后才进入PG逐条事务；不改变逐条回执/去重/护套事务。已存在源键无需依赖时序即可回读重复回执。新引用带sample_ns限定读取区间，旧引用保持兼容。TS成功PG失败可能留下未引用点，保留源键重放可修复业务投影；本包不自动删除孤立点或原始数据。

现行部署以 docker/center.compose.json 为准，保留其环境文件及两项已有只读挂载（包括中心时序凭据）。仅执行backend服务up，不执行down或删卷。上一个镜像bc02-20261104保留；回退镜像并移除SPLIT_WORKLOADS环境覆盖，新增引用字段旧版读取器可忽略，无数据库迁移。

验证工具：tools/verify-perf03-load.cjs、tools/verify-perf03-recovery.cjs。依赖runtime/perf03独立环境与模拟模板；禁止改向中心业务数据库。负载采用模拟报文回放而非模拟器UI/Go边缘全链路，新点仅写入隔离PG/Influx。完整参数、耗时与错误见验收记录。
