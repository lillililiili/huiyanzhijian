> EDGE05 / 1.4.0：最新取点同步、B连接及后台推送契约以 [EDGE05.md](EDGE05.md) 为准。旧EDGE04未补偿配对已取代。

# 慧眼智检边缘终端 1.4.0

2026-10-30 EDGE04：双测径仪数据、圆整度与护套厚度、多曲线双轴图及图例显隐已接入。A均值使用X/Y算术均值，B按输入数量识别；厚度按A均值减B均值，未补偿运行距离。B当前提供轴值接口，真实寄存器映射待确认；详见EDGE04.md。

2026-10-30 EDGE03：时序库已改为InfluxDB OSS 2.9.1，安装包1.4.0；存储、配置和迁移说明见EDGE03.md。按用户要求仅构建部署，不追加测试。

2026-10-30 EDGE02：开始采集改为等待扫码；模拟器不圆度数据由本终端接收、重新计算、本地保存再转发4192。此增量按用户要求仅构建部署，未执行功能、浏览器或性能测试。新流程和部署说明见 `EDGE02.md`。原有其他指标不经过本终端。

Go现场采集端 + InfluxDB时序库 + 本地bbolt原始账本 + Chromium独立App。蓝白大字趋势界面，围绕测径仪A/B展示圆整度与护套厚度。源码在本目录，独立于中心平台与旧TS设备端。

## 安装包
`artifacts/huiyan-edge-1.4.0-ubuntu-amd64-arm64.tar.gz`。
解压后 `cd package && sudo ./install.sh`。已有Chromium/Chrome及中文字体的Ubuntu桌面可以离线安装核心应用，无Go、Node、Java或数据库服务依赖；二进制和时序库都在包内。
缺浏览器时安装器会明确停止，不留下半安装服务。联网运行 `sudo ./install.sh --install-browser`，通过Ubuntu官方软件源安装Chromium及Noto中文字体（Ubuntu22/24的Chromium通常依赖snapd；需正常systemd与网络）。无网且未装浏览器的裸系统须预装对应架构Ubuntu浏览器依赖，不能把此包当作完整离线操作系统镜像。

支持检测Ubuntu22.04/24.04/26.04、amd64/arm64、Linux5.x及以后内核。服务CGO_ENABLED=0静态编译，无glibc版本绑定，不自带/替换内核驱动。实际安装/运行验证以EDGE01验收记录为准，其他版本不能称已实测。
USB-RS485须由内核识别为/dev/ttyUSB*或/dev/ttyACM*，服务账号在dialout组；优先填 `/dev/serial/by-id/...` 稳定路径。不添加未经核实的专有内核模块。

## 使用
1. 从应用菜单打开“慧眼智检边缘终端”；可选桌面快捷方式。
2. 设置中填写串口/Modbus TCP地址、从站、波特率、周期、直径缩放。下限为空时只测量、不判定。
3. 点击开始采集，等待扫码。使用扫码枪扫描已登记送检条码（键盘模式、回车结束），自动显示工单、盘号、规格、计划长度。当前中心联通使用模拟器登记的条码；具体步骤见EDGE02.md。
4. 运行中可以暂停/继续。结束本盘后可修改设置/换盘；结束不表示整盘合格。
5. 检测记录查看历史曲线、完整原始精度并导出CSV。全屏按钮/F11切换，Esc退出网页全屏。

## 计算及通信
主值 `min(X,Y)/max(X,Y)`，单位1，越接近1越圆。读取0x0200起连续6个保持寄存器：状态、仪器平均直径、X、X有符号偏移、Y、Y有符号偏移；直径除数默认1000，来自用户指定demo，不把其他型号/固件倍率混入。EDGE04界面A平均直径使用(X+Y)/2；仪器平均寄存器另存原始average字段，不覆盖历史。
正常状态0x0002；0x4442无被测物、0x2222测量错误；其他状态无效。无效数据为空，不补零、不计符合；异常原值永久保留。没有计米硬件时，计划长度仅订单信息，不虚构检测位置或覆盖率。
RTU只读FC03，校验CRC/地址/功能/长度，TCP校验事务号/协议/单元/长度。连接失败重试，采集写库失败/磁盘不足512MB停止采集并提示；重启时中断中的盘标记中断，不暗自续采。暂停期间不生成数据。
界面显示的比率/直径有显示精度，精确比率单列，历史/CSV保留float64原始值和寄存器，判定前不舍入。双轴圆整度不是全周圆度测量。

## 存储
- bbolt `edge.db`：meta(配置/安装ID/确认游标)、runs(冻结订单/规则/通信参数)、samples(原始帧/有效性/完整计算/时间)、runIndex(盘索引)、events(操作与错误日志)、orders(中心下发)。每条采样同步事务落盘后才显示；进程中止时尚未完成的硬件读帧不算已保存。
- InfluxDB：huiyan_measurement保存双轴、平均直径、圆整度和有效性；批量纳秒精度写入，默认不自动删除。独立游标从原始账本补写；接收时间索引和原始采样时间分开保存，详见EDGE03.md。旧VictoriaMetrics目录保留但不再运行。
- 数据 `/var/lib/huiyan-edge`，设置 `/opt/huiyan-edge/edge.env`。备份须先停止本应用后复制整个数据目录；不得仅复制运行中的bbolt文件。
- 日志edge.log/tsdb.log与数据库事件。生产部署需设置日志轮转/磁盘容量与备份策略；安装包提供logrotate配置。
- 50Hz约432万采样/日，原始账本不是无限容量；保留期/归档策略必须按现场硬盘安排。

## 服务操作
```bash
sudo systemctl status huiyan-edge
sudo systemctl restart huiyan-edge
sudo systemctl stop huiyan-edge
sudo journalctl -u huiyan-edge
```
升级再次运行install.sh，停止本应用并备份原数据库，保留配置/历史。安装器不删除数据。
完整中心契约见CENTER-CONTRACT.md。当前安装已配置EDGE02中心接入；安装包不包含机器凭据，迁移安装须单独配置。

## 当前Webtop容器
在已有 `huiyan-edge-ubuntu-desktop-1` 的 `/config/huiyan-edge` 部署，复用原持久卷，不删除其他内容；Chromium桌面App，启动器在Desktop及应用菜单。服务由桌面会话自动启动并加flock单实例锁。
Webtop容器限制嵌套PID/网络命名空间；即使补装chromium-sandbox仍报Operation not permitted。容器专用launch-webtop.sh因此使用Chromium --no-sandbox（非root、关闭扩展/同步/后台联网，只打开本机页面），依赖外层容器隔离。不可在该浏览器访问不可信网站，正式现场Ubuntu的launch-app.sh保留浏览器默认沙盒。若需要容器内完整浏览器沙盒，应另行审核Docker命名空间/seccomp配置，而非认为本轮已具备双层沙盒。
远程桌面 http://127.0.0.1:3000 ，本机操作预览 http://127.0.0.1:4198 。本机访问代理由compose.access.yaml管理，仅绑定127.0.0.1，不开放局域网。
```powershell
docker compose -f apps/device-edge/compose.yaml up -d
docker compose -f 边缘设备/edge-app/compose.access.yaml up -d
docker stop huiyan-edge-ubuntu-desktop-1
docker start huiyan-edge-ubuntu-desktop-1
```
不使用 `down -v`。单独停止代理不会停止桌面App。4199仅为独立验收环境，交付后应关闭，不是业务入口。

## 依赖与证据
Go1.27.3工具链（官方SHA256校验）、bbolt1.4.3、go.bug.st/serial1.6.4、InfluxDB OSS 2.9.1（官方归档SHA256校验）、项目现有ECharts6.0.0/Tabler图标及Logo。源码、go.sum/vendor与许可证随包。
Go工具链 https://go.dev/dl/ ，时序库 https://docs.influxdata.com/influxdb/v2/ 。
算法单测、真实协议仿真压测、时序持久化与浏览器操作分开记录。HW真机、实际50Hz串口能力、真实中心联调尚未验证；不将软件测试替代这些验收。
