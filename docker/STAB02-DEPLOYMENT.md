# STAB02 · Go边缘故障恢复部署

状态：1.9.1源码、amd64/arm64二进制和隔离Docker部署完成，自测通过待用户验收。当前4198仍运行原1.9.0；未替换共享业务服务。

## 1 变更

- 凭据先写临时文件并同步，再以不覆盖方式发布；初始化前同步目录。ENOSPC不会留下半个正式凭据文件。已有无效凭据不自动覆盖，仍须恢复备份。
- bbolt事务提交成功后才返回新样本编号和计数；创建桶失败关闭数据库句柄。
- 识别InfluxDB 5xx中的ENOSPC，显示精简错误，不回传原始响应。仅在明确受管且URL匹配时写本地恢复请求。
- `run-influx.sh`仅管理自己启动的InfluxDB子进程。磁盘恢复到默认512MiB可用后重启该进程，保留数据、账本和采集进程。远程/外部时序服务不自动重启。
- 安装器纳入新脚本；shell文件固定LF，避免Windows检出后无法运行。

## 2 隔离部署

```powershell
docker build --pull=false -f docker/STAB02.edge.Dockerfile -t huiyan-edge:stab02-1.9.1 runtime/stab02/release
docker compose -f docker/stab02.compose.yaml --profile release up -d edge
docker compose -f docker/stab02.compose.yaml ps
docker exec huiyan-stab02-edge-1 curl -fsS http://127.0.0.1:4198/api/state
```

构建目录包含本轮编译的`huiyan-edge`及`packaging/run-services.sh`、`packaging/run-influx.sh`。Go以Linux、CGO_ENABLED=0构建；arm64另有二进制。Go模块版本未改变。

`huiyan-stab02-edge-1`使用独立`huiyan-stab02_edge-data`卷、无网络、无宿主端口、无中心凭据。容器内4198是隔离进程，不是用户当前4198。健康检查同时验证Go HTTP与InfluxDB。未挂Docker socket。

## 3 故障验证复跑

在Linux/Go环境，从`边缘设备/edge-app`执行：

```sh
go test -race -count=1 -v ./...
go vet ./...
CGO_ENABLED=0 go test -c -o /输出目录/edge-fixed.test
CGO_ENABLED=0 go build -trimpath -o /输出目录/huiyan-edge .
```

将测试二进制放入`runtime/stab02/bin`后：

```powershell
docker compose -f docker/stab02.compose.yaml up -d lab
docker exec huiyan-stab02-lab-1 /bin/sh -c '/test/edge-fixed.test -test.v -test.run TestSTAB02 -test.timeout 12m'
docker compose -f docker/stab02.compose.yaml stop lab
```

三项真实故障测试要求`STAB02_FAULT_LAB=isolated-tmpfs`且校验tmpfs类型，否则跳过。32MiB本地故障盘、256MiB时序故障盘仅属于lab，最大2GiB内存、1.5CPU；禁止移到业务卷执行。复跑使用全新lab容器以重置测试tmpfs，保留证据文件。

本轮复用了已有Go工具链、依赖和InfluxDB镜像，无docker pull。`runtime/stab02`中的工具链、依赖、私有基线及测试库不入Git。

## 4 当前服务切换与回退

用户要求不影响当前服务，本轮不执行共享4198的停机安装。安装包构建脚本已更新1.9.1，旧1.9.0归档未覆盖；本轮交付Docker镜像和双架构二进制，不将旧归档标为新包。

以后维护窗口先停止本应用、完整备份边缘数据和配置，再安装同版二进制及所有启动脚本；不得删除或重建原InfluxDB数据桶。此版本没有数据库格式迁移。回退时恢复旧程序与启动脚本，保留原数据，不降级InfluxDB。

磁盘不足512MiB导致硬件采集停止时，不自动续开已中断任务；释放空间后按现场流程开机扫码。自动恢复针对已经持久保存的数据补写，不代表能补造未接收的设备读数。
