# SC03 部署记录

2026-11-02；已部署，自测通过待用户验收。

## 1 应用与检查

更新4181前台、4192后端、4196模拟器及4198代理后的Go边缘1.8.0。三容器健康；边缘记录30400、待时序/中心队列0，已恢复WAITING_SCAN。PG采样17112、值17112、任务18，更新前后不变。

收尾前端包含慢查询完成后轮询及任务列表60秒读取超时；最终静态资源index-BhznkJqM.js、index-DwmIiFAv.css。其他请求仍20秒、离开页面仍取消。完整构建通过，新增2项SC03测试通过（定向集合共23项）；服务端摘要查询性能仍待优化。

## 2 构建与启动

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml build --pull=false backend
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build backend
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml build --pull=false simulator
docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps --no-build simulator
docker compose -f docker/compose.yaml build --pull=false web
docker compose -f docker/compose.yaml up -d --no-deps --no-build web
```

Go使用现有容器工具链测试并构建；runtime/sc03/huiyan-edge.release经现有supervisor替换应用进程。运行脚本runtime/sc03/install-edge.py包含备份和版本更新，未重启桌面容器。后续后端部署必须保留TS01双compose配置。

## 3 回退与范围

runtime/sc03/backup：platform.dump、旧边缘二进制、images.json、counts.json、edge-state.json。应用镜像before-sc03-20261102标签保留；边缘env备份/config/huiyan-edge/edge.env.before-sc03。无表迁移，不需恢复数据库；已有新采集执行不能因回退删除。回退前先停止采集并确认待传队列；只切应用，保留数据卷。

本轮未拉取新基础镜像，未更新PG/中心时序/4182/无关服务。浏览器证据和测试结果见临时文件夹/SC03_重复扫码分次采集/验收记录.md。
