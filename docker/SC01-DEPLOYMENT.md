# SC01 本地部署与验收

2026-11-02，已更新 4181、4192、4196、边缘应用4198；待用户验收。

## 应用构建与更新

在项目根执行：

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml build --pull=false backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml build --pull=false simulator
docker compose -f docker/compose.yaml build --pull=false web
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps --no-build simulator
docker compose -f docker/compose.yaml up -d --no-deps --no-build web
```

沿用原 env，不输出凭据。没有执行 docker pull，无数据库迁移。PG/中心时序/管理后台/其他项目容器未重启。

边缘仅替换 `/config/huiyan-edge/bin/huiyan-edge` 为1.6.0。构建使用现有 Go 工具链，先运行测试；部署前确认无运行采集、无待传、核对进程路径，原程序备份为 `huiyan-edge.before-sc01`。停止确切应用PID，由原 supervisor 启动新程序，不重启桌面容器。原 WAITING_SCAN 已通过网页恢复。

## 备份与版本

- `runtime/sc01/backup/`：PG custom dump、SQLite在线备份、边缘旧二进制、前后记录数和原镜像ID。
- 旧镜像标签：`huiyan-web:before-sc01-20261102`、`huiyan-backend:before-sc01-20261102`、`huiyan-simulator:before-sc01-20261102`。
- 本轮没有修改时序格式或历史数据；已有双库备份/恢复要求仍见 TS01-DEPLOYMENT.md。备份未在本轮做完整灾备恢复演练。
- 新镜像ID与源文件SHA256见验收目录清单；边缘SHA256为 `d8f5e2eeccce08b2d331872b1225952b267cf1430ba0ecbb02ade6f41259c39f`。

## 使用

1. 主平台为 OVALITY 任务分配设备并启动，下载该任务条码。
2. 边缘4198点击开始采集，保持等待扫码。
3. 模拟器4196进入扫码枪模拟，输入/上传条码，自动绑定并开始接收。
4. 线缆已配置预设后“去模拟送料”；送料产生数据，扫码本身不虚构仪器读数。
5. 在工单的任务检测页面查看结果和原始记录。护套需要后台下发间距配置，并在模拟设备中提供B读数和计米器延迟；缺项会显示原因。

当前站点没有为演示新增/修改用户任务；1912条原有测量及1912条测量值数量保持不变。完整输入验证使用独立测试数据库与时序桶。
