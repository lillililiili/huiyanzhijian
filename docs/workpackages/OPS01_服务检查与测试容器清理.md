# OPS01 服务检查与测试容器清理

日期：2026-10-26。B类运维修复；用户要求检查服务并删除当前项目多余容器。范围为既有B1数据库启动配置、容器运行状态及已退出测试容器；无页面、业务接口或数据库结构变更。

基线：内层docs/project-definition / da956002eb58d75e2df67daad6766bb8b6c239ee，外层工程尚未Git纳管。保留已有全部修改；仅在原工作区修复部署配置并记录证据，不切换分支、不提交推送。当前实际服务已包含B1后端/数据库和SIMWEB01模拟器；根README中的“只有前端”属于旧状态，不能据此删除后端服务。

## 1 故障与修复

初查huiyan-b1-database-1已退出，退出码255，重启策略为no；后端容器虽运行，但就绪检查503/DEPENDENCY_UNAVAILABLE，worker报告数据库不可用。数据库退出与本次Docker恢复时间接近，日志不足以确认最初退出原因；已确认未自动恢复与缺失重启策略有关。

在docker/b1.compose.yaml的database服务增加restart: unless-stopped，通过Compose config --quiet校验；使用docker update将相同策略应用于既有数据库容器，再docker start恢复。没有重新初始化数据库、迁移、重建镜像或重新创建日常容器。API和worker随后自行恢复数据库连接。

## 2 清理范围

删除前核对精确名称、容器ID、Compose归属、退出状态及测试脚本来源。实际执行docker rm，不使用-f、-v或全局prune。

| 删除的测试容器 | 来源 |
|---|---|
| huiyan-b1-proof-1792571759897 | B1隔离容器验证 |
| huiyan-b1-proof-1792571806647 | B1隔离容器验证 |
| huiyan-b1-proof-1792572240042 | B1隔离容器验证 |
| huiyan-b1-proof-1792572329477 | B1隔离容器验证 |
| simweb-backend-1792573213977 | SIMWEB01隔离测试后端 |
| simweb-test-1792573213977-simulator-1 | SIMWEB01隔离测试Web |

测试数据库、SQLite测试卷、日常数据卷、镜像和其他项目容器均保留。删除容器不等于删除数据库内测试库。前后清单比对确认仅上述6个容器移除，所有数据卷名称不变，其他项目容器ID和运行状态不变。

## 3 验证与完成情况

| 检查 | 结果 | 验收边界 |
|---|---|---|
| 4个日常容器 | web、backend、database、simulator均running/healthy | 本次运行检查通过 |
| 前端4181 | 首页及healthz返回200，Nginx配置检查通过 | 静态服务可访问；未执行页面业务回归 |
| 后端4192 | ready返回200、database=UP、analysis_worker.healthy=true | worker仍为health-only，不表示分析算法实现 |
| 数据库4193 | pg_isready接受连接，原数据卷挂载保留 | 未执行数据写入或恢复演练 |
| 模拟器4196 | 首页和health返回200，auto_capture=false | 未触发采集或生成业务数据 |
| 模拟器到后端 | 从模拟器容器用既有设备凭据只读查询ingestion/profile，200/OK | 验证网络和凭据；不将其计作完整采集验收 |
| 删除范围 | 6个测试容器移除，卷与无关容器保留 | 已完成用户授权清理 |

证据位于外层临时文件夹/服务检查_OPS01_2026-10-26，包含脱敏前后容器清单、删除目标、HTTP回读、原Compose备份及清理比对。未读取或输出运行凭据内容。

重启策略已配置并在当前容器生效；未为测试策略而重启整个Docker Desktop。unless-stopped保留人工停止意图，不会自动拉起用户明确停止的数据库。UI/API完整业务、HW和MES验收状态不因本次运维检查升级。
