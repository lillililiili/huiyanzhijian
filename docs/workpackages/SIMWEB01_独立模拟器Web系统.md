# SIMWEB01 独立模拟器Web系统

2026-10-21，A类G01/DP09.03模拟器控制子范围，开发2执行；用户明确要求模拟器具有Web，独立系统与独立Docker Compose。实现及本轮验证完成，待用户验收，未冻结。

基线：实际内层Git docs/project-definition / da956002eb58d75e2df67daad6766bb8b6c239ee，外层源码仍未Git纳管；保留B1与全部既有改动。现有后端4192、PG4193、旧前端4181，模拟器CLI无Web。开工摘要另存临时文件夹/SIMWEB01。

允许修改：tools/simulator（既有Node/TypeScript与静态Web，不安装新框架）、tools/simulator.mjs启动工具、docker/B1.simulator.Dockerfile必要静态资源复制、tests/simulator、相关工作包/模块/页面台账、runtime/simulator私有本机配置、临时文件夹本包证据和交接。既有主前端、平台后端、PG迁移、设备线协议、原Compose和B1兼容CLI入口保持。本包不是27页平台新增第28页。

公开依赖：模拟器仅HTTP调用M04的profile/session/ingest/heartbeat/receipt与M02设备assignment/ack；不得使用人员权限创建工单/盘号/任务或直写PG。三项测试场景沿B1。SQLite保存生成队列及新增Web执行/日志；PG无新增表。输入/回执与已入库历史不得因暂停/停止/容器重建清除。

Web页面：独立登录；上游连接与三项设备/任务分配；场景、数量、速率、种子；启动/暂停/继续/停止、补传、原键重放；运行历史、真实计数、逐条样本与收据、趋势、执行日志。无任务/后端离线/凭据失效显示真实状态并禁用新采集；保留本地历史。浏览器无设备密钥，不暴露任意命令执行或任意URL代理。

运行设计：Node HTTP服务提供同源网页/API，启动独立CLI子进程，受控参数与同设备排他；Web状态与CLI样本同一SQLite。Web重启将未完成执行标中断，不自动续采；用户可选择继续或补传。登录Cookie/CSRF/Origin校验、局域网访问需显式配置，默认只发布127.0.0.1:4196。

Compose在tools/simulator/compose.yaml，独立project、镜像入口、volume、health/logging，不声明backend/database或依赖其Compose网络。API_URL通过环境指向现有后端；本机用host.docker.internal:4192。后端停机时模拟器网页仍可访问。旧B1模拟器队列不擅自迁移覆盖。

验证计划：编译、独立Compose构建/启动；隔离PG/后端/模拟器API用例（登录、权限、CSRF、非法ID/参数、同设备并发、无任务、离线、暂停/继续/停止/补传/重放与重启）；真实浏览器操作和回读、截图；对账模拟器样本/平台记录，主验收库不新增业务。UI与API分别记录，HW/MES未执行。

## 实现与验证结果

- 源码：`tools/simulator/src/web-manager.ts`、`web-server.ts`，`tools/simulator/web/*`，`tools/simulator/compose.yaml`、`.env.example`，`tools/simulator.mjs`；Dockerfile只增加Web静态目录复制。复用原CLI、设备接口和Logo，不新增框架依赖。
- 数据结构：仅模拟器SQLite新增 `web_execution` 和 `web_log` 及索引；原样本/回执/重试队列复用。PostgreSQL及公开设备契约无改动。Web控制API属于模拟器自身，不属于平台人员API。
- Docker构建包含TypeScript编译，独立容器健康通过，日常Web4196 / 后端4192 / PG4193。主前端4181保持原状。
- API真实业务：`node tests/simulator/web-acceptance.mjs` 通过鉴权、CSRF、Origin、无效输入、无分配、同设备排他、请求幂等、无效值不补零、暂停/继续/停止、后端停机、本地历史、Web重启不续采、恢复补传、重放去重和数据库对账。证据 `临时文件夹/SIMWEB01/hy_simweb_1792573213977/result.json`。
- UI真实浏览器：登录、无任务禁用、搭盖率100条、另一运行暂停计数保持5条/继续增长/停止保留9条、原键重放；第二台同指标设备HY-DG-02使用自身任务并存储4条，不圆度设备4条；样本分页和退出登录另有浏览器记录。API和UI合计143条，数据库逐设备统计BY01=4、DG01=109、DG02=4、JX01=26；33条无效值仍为NULL。浏览器文本及截图在 `临时文件夹/SIMWEB01/`。
- 日常环境独立Web队列0条，默认库工单/盘号/任务/检测记录均0条；固定档案未清空。证据 `default-environment.json`。测试用独立数据库及卷保留，测试容器停止后可追溯。
- HW真机、MES、主平台前端接真实API、正式定位/长度/成品率算法均不在本包，未验证。测试阈值不得作为生产批准。

已知边界：单实例SQLite与本机独立operator账号；最近100次运行、50条样本分页、最近50项日志；异常进程遗留设备租约最多等待30秒。速率受现有后端限流及资源约束，配置间隔不等于性能保证。未新增管理后台、组织权限、长期存储清理策略或多副本支持。
