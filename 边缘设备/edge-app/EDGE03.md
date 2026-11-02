# EDGE03：InfluxDB 时序存储

2026-10-30，应用1.2.0，InfluxDB OSS 2.9.1。替换1.1.0的VictoriaMetrics，仍使用Go、bbolt原始账本及既有扫码/中心上报流程。

## 数据与恢复

- 本地InfluxDB仅监听127.0.0.1:8086，组织huiyan-edge、数据桶measurements。默认不自动删除历史；初次创建桶的保留期可用EDGE_INFLUX_RETENTION_SECONDS设置，0为无限，已有桶不自动改策略。
- 每条原始记录先提交bbolt，然后每250ms批量投影（最多1000条）到InfluxDB `/api/v2/write?precision=ns`。仅204确认后将记录ID和索引时间同一次持久化；部分写入、超时或断网均不推进游标，重发相同点身份。
- measurement为huiyan_measurement，tags为device、run；fields包括record_id、x_mm、y_mm、average_mm、roundness、valid、verdict、reason、method、source、偏移及原始sample_time_ns/received_time_ns。无效直径不补0。
- InfluxDB `_time` 使用本地接收时间，遇到同刻/时钟回拨则递增1ns，避免同一series覆盖不同原始记录。两个原始时间字段保持不变；按采样时间分析时使用sample_time_ns。界面、历史和CSV继续读原始账本采样时间，未改变时间口径。
- 新游标按InfluxDB地址、组织ID和桶ID隔离；首次部署从bbolt第一条补写，不继承旧vmCursor。保留原VictoriaMetrics的data/tsdb和旧可执行文件供回退，不再启动旧数据库。
- 新库目录data/influxdb，凭据data/influx-credentials.json（0600，首次启动随机生成）。不得删除凭据后重建数据库；整机迁移需一起备份。安装包不含凭据和业务数据。
- 原始账本和中心待传队列继续持久化；InfluxDB暂时不可用不阻断采集，界面显示时序待写/错误，独立重启时序服务。时序库未恢复时不要清理原始记录。

## 安装与配置

安装包huiyan-edge-1.2.0-ubuntu-amd64-arm64.tar.gz包含两架构Go服务和InfluxDB二进制；普通Ubuntu解压后 `cd package && sudo ./install.sh`。安装器保留现有配置/数据；升级停止服务后备份原始账本。Webtop升级仍使用install-webtop.sh和start-desktop.sh。

新增变量EDGE_INFLUX_URL、EDGE_INFLUX_ORG、EDGE_INFLUX_BUCKET、EDGE_INFLUX_RETENTION_SECONDS；本机默认值可直接使用。旧EDGE_TSDB_URL/EDGE_TSDB_RETENTION不再读取。InfluxDB外部服务需事先建立桶并配置HTTPS及EDGE_INFLUX_TOKEN（需桶读写权限）；本机随包服务仍由监督脚本管理。

本机凭据用于本机InfluxDB管理员初始化，保存到数据卷并受文件权限保护。边缘API不返回它，日志不输出它；不得写入Git或发送到浏览器。端口8086未映射到宿主/局域网。

状态API新增tsdb=InfluxDB、tsPending、tsError；旧vmPending/vmError暂作相同值兼容别名，不表示仍运行VictoriaMetrics。中心接入契约、生产阈值、PostgreSQL表均未改变。

## 交付边界

按用户要求仅构建与部署，不运行功能/浏览器/性能/HW测试。构建amd64/arm64不代表ARM64真机或所有Ubuntu内核已验证。原EDGE01吞吐数据不作为InfluxDB版本性能证明。当前实时/历史查询仍以bbolt为原始事实来源，InfluxDB承担可查询的持久时序投影。

官方下载及校验值：https://github.com/influxdata/influxdb/releases/tag/v2.9.1
写入契约：https://docs.influxdata.com/influxdb/v2/api/quick-start/
