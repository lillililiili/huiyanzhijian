# EDGE03 InfluxDB 时序库替换

2026-10-30；B 类 M09 已有存储替换；已构建、打包、部署，待用户验收，未冻结。

用户指定时序库使用 InfluxDB。当前 Go 边缘端使用 VictoriaMetrics，改为 InfluxDB OSS 2.9.1、本机认证写入、Ubuntu amd64/arm64 安装包及 huiyan-edge 容器部署。继承用户“不需要测试”的要求：构建、安装与部署状态核查，不执行自动化、浏览器、性能或业务写入测试。

基线：内层文档 Git docs/project-definition / 72bbdf5c40df25c588b01ee9adfed269c79634b8；外层边缘源码没有 Git 基线。保留现有未提交修改，修改前备份本应用源码。

允许范围：边缘设备/edge-app 的时序投影、运行脚本、安装打包、依赖下载、对应说明；EDGE03 工作包与交接记录；台账追加本增量。不改圆整度计算、扫码绑定、中心接口、平台表和另外两项检测。

实现约束：
- bbolt 继续保存原始帧、采样、任务快照及中心待传队列；InfluxDB 为独立时序投影。
- 使用 InfluxDB /api/v2/write、line protocol、Token 认证，只有完整 HTTP 204 才推进新游标；失败可幂等重试。
- 新库独立目录和游标，从原始账本重建，旧 VictoriaMetrics 目录保留。凭据在目标机器生成、权限0600，不放源码或安装包。
- 保留原始采样与接收纳秒时间。时序索引用接收时间并以纳秒单调化消除同刻记录覆盖，修正值与原始时间分开；原始记录查询/CSV继续使用bbolt中的采样时间。
- 默认不自动删除时序历史；容量与保留期交由明确运维配置。安装器不清空原数据。

依据：InfluxDB 官方 v2.9.1 发布页及 SHA256；官方 v2 setup/write API。构建与部署成功不等于业务/HW验收。

## 完成记录

- 应用1.2.0、InfluxDB OSS2.9.1已在huiyan-edge-ubuntu-desktop-1运行，原VictoriaMetrics进程已停止。8086仅容器内loopback，用户入口仍4198。
- Go模块校验、amd64/arm64编译、安装包生成及归档SHA256核对完成。InfluxDB二进制为两架构静态PIE，amd64实际版本输出v2.9.1；未验证其他Ubuntu版本/ARM64机器。
- 部署只读核查：InfluxDB health=pass；边缘state=IDLE、stored=0、tsdb=InfluxDB、tsPending=0、tsError为空、centerPending=0。此环境无已有采样可重建，没有执行业务写入或迁移测试。
- 原安装（含原数据库、配置及可执行文件）备份在容器持久卷 `/config/huiyan-edge-backups/EDGE03-20261030-145042/installation-before.tar.gz`。旧data/tsdb仍原位保留。
- 安装包：边缘设备/edge-app/artifacts/huiyan-edge-1.2.0-ubuntu-amd64-arm64.tar.gz；SHA256 `225a395cbcdca521ca96cd67386abb45dd5852dd8fef2e37bfb348d25f266200`。
- UI/API/HW/性能验收均未新增通过结论。未重建或重启4181/4182/4192/4196及PostgreSQL。
- 细节与回退见 `临时文件夹/项目开发学习/2026-10-30_EDGE03_InfluxDB替换/交接记录.md`。
