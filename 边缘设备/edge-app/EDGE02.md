# EDGE02 使用与部署

仅修改 OVALITY。搭盖率、铜丝间隙仍由原模拟器链路接中心。业务4181、管理4182不替换。

## 操作

1. 业务平台登记工单、线缆并创建不圆度任务；选择设备和配方，然后开始任务。条码要求一个明确的运行中任务；不自动挑第一条。
2. 模拟器4196进入送料模拟，选择同一线缆、设备及任务。该线缆和设备应已保存模拟预设；任务方式选“使用平台已开始的任务”。
3. 点击“生成并下载条码”，保存PNG。条码为Code128，包含不带凭据的登记号；文字区显示订单、盘号、规格。
4. 边缘4198点击“开始采集”，显示“等待扫码录入”。现场使用键盘模式扫码枪，扫描后以回车提交。
5. 用模拟器代替扫码枪时，在送料页上传第3步图片，页面显示识别到的工单和盘号；点击“开始送料”，系统先向边缘提交扫码，再生成数据。
6. 边缘显示圆整度、X/Y直径、仪器平均直径、趋势、订单和采集时间。中心检测/历史仍使用原入口查询同一任务；来源仍为模拟数据，不能据此声称是真机。
7. 暂停边缘会阻止新增采样进入；模拟器轮询边缘状态停止生成。恢复后继续。结束边缘本盘不会清空历史，也不会自动判整盘合格或结束中心业务任务；中心任务结束仍在业务平台执行。

上传其他任务条码会提示不匹配；过期绑定须重新生成。未点边缘开始采集时，送料不启动。条码下载不会自动录入或启动采集。刷新边缘后可再点“等待扫码”打开输入框。重启服务不自动恢复采集，需重新开始扫码。

## 数据与计算

模拟器 → 带机器认证的HTTP封装Modbus-RTU原始帧 → Go边缘计算和bbolt事务落盘 → 中心现有接入API → PostgreSQL。另由本地游标投影到InfluxDB（EDGE03/1.2.0替换，历史EDGE02为VictoriaMetrics）。

模拟器SIM02寄存器倍率是100（0.01mm），与物理串口配置/demo默认1000分开，不修改用户硬件参数。模拟器原始X/Y几何量可能比寄存器预览精细：先校验其按0.01mm投影与CRC帧一致，再保留原值计算min/max。平均直径保留帧中平均直径；原始几何量和整帧全部留存。真实串口/TCP适配器保留：通过原orders接口预登记的externalId可由扫码枪直接输入，走本机RTU/TCP采集。新Code128+中心网关路径限定SIMULATED；硬件记录的生产身份和中心适配仍需单独配置与联调。

新配方按冻结的ratio下限判定。旧百分比任务继续按其快照向中心提供百分比，边缘主显示仍为圆整度，不将旧百分比阈值当ratio下限。历史记录不迁移、不重算。

边缘新增barcodes、gatewayRecords、gatewayPending、gatewayRejected桶；无中心SQL迁移。原始记录+归属+转发内容同事务写入。中心逐条回执确认后移出待传；永久拒收单独保留并显示数量，不冒充成功。不圆度接入在中心增加独立机器密钥检查，设备原有工厂、指标、任务权限依然生效。中心记录raw.data.edge_gateway保存边缘设备、运行、条码、算法和模拟来源。

## 配置

边缘edge.env：EDGE_PLATFORM_URL（中心根地址）、EDGE_PLATFORM_DEVICE_TOKEN（现有设备范围凭据）、EDGE_INBOUND_TOKEN（独立入站凭据，至少32字符）、OVALITY_EDGE_TOKEN（中心边缘通道密钥，至少32字符）、EDGE_GATEWAY_ID。不要同时启用旧EDGE_CENTER_URL批次预留通道。安装包不含秘密。

中心环境OVALITY_EDGE_TOKEN与边缘相同。模拟器OVALITY_EDGE_URL指向边缘，OVALITY_EDGE_INBOUND_TOKEN与EDGE_INBOUND_TOKEN相同。密钥不传浏览器、不写条码、不入Git。中心仍保留原设备身份认证；一个额外请求头不能替代设备授权。

本机Docker下模拟器加入huiyan-edge_default网络，访问容器DNS；边缘通过host.docker.internal:4192访问中心。正式Ubuntu应改为实际内网地址并配置HTTPS/访问隔离。4198本机代理继续绑定127.0.0.1。

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml up -d --no-deps backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps simulator
```

上述命令使用已构建镜像。边缘应用由原Ubuntu桌面容器内监督进程启动；升级用install-webtop.sh，保留/config/huiyan-edge/data。普通Ubuntu使用安装包install.sh。

## 本轮状态

按用户要求不执行测试。构建、包文件和部署状态与功能验收分别记录；未做真实扫码枪、真机、断网恢复或新增性能测试。旧EDGE01性能记录不是此次新增链路的性能证明。用户使用前可按上方步骤验收，异常不要清库，保留记录定位。

条码浏览器依赖：JsBarcode3.12.1（MIT，https://github.com/lindell/JsBarcode）、ZXing JS0.21.3（Apache2.0，https://github.com/zxing-js/library）。库本地随模拟器部署，不依赖页面外部CDN。
