"""Build the standalone HWREADY01 report from this audit's bounded observation."""
from pathlib import Path
import json, html

root=Path(__file__).resolve().parents[1]
evidence=root/'临时文件夹/HWREADY01_真机联调准备度'
ob=json.loads((evidence/'read-only-observation.json').read_text(encoding='utf-8'))
esc=html.escape
findings=[
('P0','01','并发查询：先修共享内存与连接借用','已复现',
 '任务列表 5 并发失败 2/5、10 并发失败 8/10；PG 同期报 could not resize shared memory / No space left on device。容器 shm 只有 64 MiB。明细 10 并发出现约 5.2 秒等待及 1 次 503。',
 '优化 taskActivity 的扫描和最新点查询；测量计划与共享内存峰值后配置 shm。querySnapshot 已持有事务连接，hydrateMeasurementRows 又通过默认 pool 查询投影：应贯穿同一连接，或明确在事务外装配外部原文，避免连接池耗尽。',
 '同样 1/5/10 并发重复 3 轮，再扩到 20 并发；0 个 5xx、0 个连接饥饿、0 个 shm 错误；记录 P50/P95/P99、池等待和 SQL 计划。不能只扩大 pool。',
 'apps/platform/infrastructure/db.ts；modules/m04-measurements/api.ts querySnapshot/taskActivity；storage-api.ts hydrateMeasurementRows；docker/b1.compose.yaml'),
('P0','02','真机身份与扫码闭环','源码限定模拟',
 'ScanLifecycle.check/command 仅接受 OVALITY + SIMULATED。Go 扫码生成 Run.Source="SIMULATED"。真实 Modbus 读取代码存在，但扫码到中心任务的 REAL 全链路仍未完成验证。',
 '设备登记、凭据、来源标识、方法版本及扫码绑定增加 REAL 路径；明确关机、重扫、换码、断网与旧任务迟到边界。任务切换仍使用事务和幂等命令，不复制模拟记录改标签。',
 '真实单机首扫启动、同设备换码结束旧任务、同码分次、重试幂等、错误设备拒绝；逐点核对设备/盘/任务/序号，不串任务。',
 'apps/platform/modules/m02-tasks/scan-lifecycle.ts；边缘设备/edge-app/lifecycle.go、gateway.go'),
('P0','03','方法、单位与护套配对','待签认 + 待开发',
 '不圆度百分比采用 |X−Y|/平均直径×100；另有 roundness-min-max.v1 轴比、仪器 OvAL 差值 mm。护套当前 A 均径−B 均径，并且中心 verifySheath 只核验 edge_simulation / SIMULATED 证据。',
 '用实际型号/固件签认公式、单位、缩放、无物体/故障码和校准；明确“护套厚度”当前直径差与物理厚度的业务定义。新增真实 A/B 时间戳、同步质量、允许配对误差和缺配对状态。',
 '黄金样本逐值复算、阈值等号、无效/缺失/负值、时钟偏差均通过；正式规则审批后方可判质量。TEST_ONLY 不直接用于 REAL；不以 8% 等历史模拟值替代批准标准。',
 'apps/platform/modules/m03-rules/api.ts；m04-measurements/api.ts validateOvalityObservation；sheath.ts；边缘设备/edge-app/point_sync.go'),
('P0','04','迁移可重复性与版本一致性','已核实漂移',
 '当前数据库登记 001–016；源码已有 017。001、010、011 的源码 SHA256 与已应用登记不同，通用 migrate.ts 会拒绝继续执行。三个关键后端构建 JS 与容器 hash 相同，不代表所有新源码已部署。',
 '找回已部署迁移原件，冻结旧版本，差异写入新的前向修复迁移；记录构建来源清单、镜像 digest 和部署迁移版本。不得更新登记 hash 来绕过核查。',
 '隔离空库全安装、现库副本升级、重复执行、失败回滚均通过；表结构和数据约束一致，业务记录/快照不变。',
 'apps/platform/db/migrate.ts、db/migrations/001、010、011、017；public.hy_schema_migration；docker/TS01-DEPLOYMENT.md'),
('P0','05','写操作权限与工厂隔离','静态代码风险',
 'POST /mes/outbox/process 进入公共 data:read 分支后直接调用 processOutboxBatch；函数没有 actor/工厂参数，查询全局待发队列。其进程内 isProcessing 也不等同多实例数据库抢占。',
 '增加专用写权限、工厂范围、输入上限及审计；后台消费采用租约/行锁及外部业务幂等。设备密钥独立、可撤销；生产部署启用受控 TLS 和安全 Cookie。',
 '只读、未登录、跨工厂及越界 batch_size 均拒绝；两实例同时消费不得重复业务发送。此次未调用该写端点，避免向外部 MES 发送数据。',
 'apps/platform/composition/main.ts MES 路由；modules/m07-mes/service.ts processOutboxBatch'),
('P1','06','接收吞吐与锁占用','结构瓶颈待压测',
 '每批 ≤500 条且请求 ≤1 MiB；接收循环逐条串行。在设备级 PG 事务锁内进行单点 InfluxDB HTTP 写入，时序超时 8 秒；PG 池仅 10 个连接。',
 '设计持久接收账本/有界队列或批量时序写入；收窄数据库事务时间，保留逐条身份、冲突和回执；明确接收确认、时序确认与业务可见三个状态。',
 '按目标设备数×实际峰值频率做持续与 2 倍突发混合负载；断开响应后重试不重复，提交前绝不回 STORED；持续输入时队列不单调增长。',
 'apps/platform/modules/m04-measurements/api.ts ingest；timeseries.ts write；边缘设备/edge-app/gateway.go gatewayLoop'),
('P1','07','限流、重试与背压','预算未按设备规划',
 '设备凭据 actor.id 共用 120 请求/分钟，IP 600 请求/分钟；秒级上传、心跳、绑定查询、补传共享配额。当前代理转发 IP 与 Express 信任配置也需核实。',
 '按独立凭据/设备配置额度，上传、心跳和管理查询分开预算；429/503 带重试指示，指数退避加抖动；设备积压、最旧待传年龄和磁盘水位可观察。',
 '正常上传+心跳不被误限流；10 台共享网关仍按授权正确区分；断网恢复中保留全部待传点，补传不会挤掉控制消息。',
 'apps/platform/composition/main.ts rate；infra/middleware/nginx/frontend.conf.template；边缘设备/edge-app/gateway.go'),
('P1','08','双库一致性与灾备','有幂等基础，缺联合演练',
 '时序先写、PG 后提交；PG 失败时可能留下孤立点。PG 唯一键和 payload hash 能防止重复业务事实，但没有跨库事务。InfluxDB 单独损坏会让 PG 中引用不可读。',
 '增加双库对账、孤立点处理、引用缺失报警和批次 PROCESSING 恢复；受控备份 PG/Influx/边缘队列/配置，建立恢复手册。',
 '在隔离环境分别故障注入时序成功后 PG 失败、提交后回执丢失、进程强停；重放后逐点身份/原文 hash/值一致。联合恢复达到签认 RPO/RTO。',
 'm04-measurements/api.ts ingest；timeseries.ts；docker/TS01-DEPLOYMENT.md'),
('P1','09','数据库容量、索引与保留','小规模可用，长期容量未验',
 '35,279 点已有 35,279 投影；当前 PG 约 227 MiB（含业务及索引）。PG 每点仍写多张表。measurement_record 无分区；任务统计触发器每点更新同一任务汇总行。',
 '按目标查询检查 EXPLAIN；评估 factory/task/ingest_order 索引、最新点缓存、热点行、autovacuum、WAL与备份。定义冷热分层、保留期、归档及删除审批；分区需兼容全局去重。',
 '以目标保留量或代表性生成数据验证查询与写入；保留期边界不破坏去重/报告引用；磁盘增长、膨胀率和恢复耗时进入容量表。',
 'apps/platform/db/migrations/001_b1_modules.sql、016_calculated_projections.sql；m04-measurements/storage-api.ts'),
('P1','10','时序模型与完整趋势读取','需要规模验证',
 '每点唯一 point tag；原文 JSON 转 base64 存字段；读取每组 50 个 point，并查询全时间范围。前台首次每页 100 条拉完整原文，25 条响应本次约 181 KiB。',
 '验证 tag 基数、批量写、时间范围与字段拆分；新增仅返回时间/数值/状态的趋势接口。完整时间跨度仍保留，缩放加载局部原始点；任何抽稀必须保留首末和异常极值并注明粒度。',
 '百万级任务测试首屏、缩放、异常定位；图和全局轴范围一致，原始事实不删不覆盖；原始 CSV 独立分页导出，取消请求释放资源。',
 'apps/platform/modules/m04-measurements/timeseries.ts read；apps/web/src/live/taskTrend.ts'),
('P1','11','分析、报警和进程生命周期','源码与运行职责待闭环',
 'analysis-worker 只写 health-only 心跳；MES worker 启动函数存在但主入口未调用。M05/M06/M07 有服务实现，不能等同持续自动处理已运行。supervisor 关闭等待约 1 秒。',
 '划清同步接收与异步分析，落实持久任务、租约、重试、失败队列、幂等结果版本；增加优雅关机、在途请求排空和重启恢复。',
 '进程重启、任务重复领取、队列堵塞、算法失败可重试可追溯；分析故障不阻止原始采样保存；健康状态明确显示能力而非仅进程活着。',
 'apps/platform/composition/analysis-worker.ts、supervisor.ts、main.ts；modules/m05-alarms、m06-quality、m07-mes'),
('P1','12','可观测性与现场运维','已有日志，缺容量指标闭环',
 '已有请求号、耗时、状态日志与后台诊断；当前 ready 即使时序 DOWN 仍可能 HTTP 200。配置、依赖版本、备份、队列和时钟质量尚无统一联调面板。',
 '记录接收点率、端到端延迟、重复/拒绝/隔离率、池等待、锁等待、时序延迟、积压年龄、磁盘与时钟偏差；区分存活与就绪。无需先引入完整日志平台。',
 '设备断连、时序故障、PG满、权限撤销、时间漂移均产生可定位的诊断；日志不含密码、Token、Cookie或敏感原文。',
 'apps/platform/infrastructure/runtime-log.ts；composition/main.ts health/ready；infra/observability'),
('P2','13','现场安装与多端接入交付','待现场确认',
 'Windows Docker / Webtop 是当前联调环境，真实采集程序为 Go。容器 healthy 不证明串口带宽、USB 重连、线缆物理顺序、设备固件和现场网络可用。',
 '形成每台设备型号/固件/接口/频率/时间来源/采样身份矩阵；独立部署受控服务账号、自动启动、日志轮转、串口权限、证书与版本回退。',
 '真实仪器通电/断电/拔插/网络恢复、跨班次换盘、重新扫码和重启测试通过；客户签认真实协议与黄金样本后进入长稳。',
 '边缘设备/edge-app/packaging；modbus.go、gauges.go；adapters/inspur/http/collector.cjs'),
]
rows=''
for x in ob['http']:
 vals=sorted(r['ms'] for r in x['results']);ok=sum(r['status']==200 for r in x['results']);name='任务列表' if '/production/' in x['route'] else '采样明细（25 条）'
 rows+=f'<tr><td>{name}</td><td>{x["concurrency"]}</td><td>{ok}/{len(vals)}</td><td>{min(vals)}–{max(vals)} ms</td><td><span class="pill {"bad" if ok<len(vals) else "good"}">{"出现 503" if ok<len(vals) else "本轮成功"}</span></td></tr>'
cards=''
for p,n,title,status,fact,work,accept,source in findings:
 cards+=f'<article class="finding" id="f{n}"><div class="finding-head"><span class="priority {p}">{p} · {n}</span><h3>{esc(title)}</h3><span class="status">{esc(status)}</span></div><p><b>现状</b>{esc(fact)}</p><p><b>开发</b>{esc(work)}</p><p><b>验收</b>{esc(accept)}</p><div class="source">代码依据：{esc(source)}</div></article>'
css='''*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:#f3f6fb;color:#193049;font:15px/1.75 "Segoe UI","Microsoft YaHei",sans-serif}a{color:#1867c0;text-decoration:none}header{background:#102b46;color:white;padding:56px max(6vw,24px) 36px}header small{color:#83ceca;letter-spacing:2px}h1{font-size:38px;line-height:1.25;margin:18px 0}header p{max-width:880px;color:#d3e0ed}nav{position:sticky;top:0;background:#fffffff5;backdrop-filter:blur(10px);border-bottom:1px solid #dce5ef;padding:12px max(6vw,24px);z-index:2;display:flex;gap:24px;flex-wrap:wrap;font-size:14px}main{max-width:1280px;padding:32px 28px 70px;margin:auto}section{margin:0 0 44px;scroll-margin-top:100px}h2{font-size:25px;margin:0 0 18px}h2 em{font:12px monospace;color:#6a899f;margin-right:12px}h3{font-size:18px;margin:0}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.card,.panel,.finding{background:white;border:1px solid #dce5ef;border-radius:14px}.card{padding:22px}.card strong{display:block;font-size:31px;color:#12375a}.card small,.muted{color:#60788f}.callout{padding:22px 26px;border-left:4px solid #d75353;background:#fff4f2;border-radius:10px;margin:20px 0}.panel{padding:26px}.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.flow>div{background:#eaf2fb;padding:18px;border-radius:8px}.flow b{display:block;color:#1e638e}.flow small{display:block;color:#596e83}.pill{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px}.good{background:#e4f5ee;color:#17725a}.bad{background:#ffeded;color:#b62e41}.warn{background:#fff2d9;color:#926319}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;background:#edf3fa;color:#456783}td,th{padding:13px 14px;border-bottom:1px solid #e4ebf4;vertical-align:top}.finding{padding:24px;margin-bottom:16px;break-inside:avoid}.finding-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap}.priority{font:700 12px monospace;padding:6px 10px;border-radius:5px}.P0{background:#ffeded;color:#bb3650}.P1{background:#fff1d8;color:#947019}.P2{background:#e9effd;color:#4568b0}.status{margin-left:auto;color:#657c93;font-size:12px}.finding p{margin:12px 0}.finding p b{display:inline-block;margin-right:18px;color:#244d72}.source{color:#6e8196;font:12px/1.7 monospace;border-top:1px dashed #dce5ef;padding-top:13px;overflow-wrap:anywhere}.bar{display:flex;height:18px;background:#e8edf5;border-radius:12px;overflow:hidden;margin:10px 0 18px}.bar span{display:block;background:#2875c8}.bar .red{background:#d85465}.steps{counter-reset:step;display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.steps div{padding:20px;background:#fff;border:1px solid #dce5ef;border-radius:12px}.steps b{display:block;margin-bottom:9px}.steps small{color:#526e86}code{background:#edf2f8;border-radius:4px;padding:2px 5px;overflow-wrap:anywhere}ul{padding-left:22px}.footer{border-top:1px solid #d5e0eb;padding-top:22px;color:#697f94;font-size:13px}button{border:1px solid #4f7394;border-radius:7px;background:transparent;color:inherit;padding:9px 15px;cursor:pointer}header .meta{font-size:12px;color:#9db7cf}svg{max-width:100%;height:auto}@media(max-width:800px){.grid,.flow,.steps{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}h1{font-size:28px}main{padding:24px 16px}nav{gap:14px}.finding{padding:18px}}@media(max-width:480px){.grid,.flow,.steps{grid-template-columns:1fr}}@media print{body{background:white;font-size:11px}header{padding:20px;color:#102b46;background:white}header p,header small,header .meta{color:#40586e}h1{font-size:26px}nav,button{display:none}main{max-width:none;padding:10px}.finding{box-shadow:none}.two{grid-template-columns:1fr}section{margin-bottom:24px}a{color:inherit}}'''
doc='''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>慧眼智检 · 真机联调准备度报告</title><style>'''+css+'''</style></head><body>
<header><small>HUIYAN · ENGINEERING READINESS / HWREADY01</small><h1>从模拟闭环，到真实设备联调</h1><p>后端、传输、数据库与并发专项审查。结论依据当前源码、运行容器和真实查询；页面可见、容器健康、历史测试通过，均不能替代真机与容量验收。</p><div class="meta">2026-11-02 · 当前工作区快照 · 受控只读审查 · 未修改业务代码或部署</div></header>
<nav aria-label="报告章节"><a href="#summary">结论</a><a href="#chain">现有链路</a><a href="#measure">实测结果</a><a href="#work">开发与验收</a><a href="#capacity">容量与性能</a><a href="#route">实施顺序</a><a href="#evidence">证据边界</a></nav>
<main><section id="summary"><h2><em>01 / DECISION</em>先解决基础可靠性，再进入生产真机</h2><div class="grid"><div class="card"><small>数据库实际采样</small><strong>35,279</strong><small>全部为 SIMULATED</small></div><div class="card"><small>已持久化计算投影</small><strong>35,279</strong><small>数量覆盖，不等于逐值 HW 核验</small></div><div class="card"><small>本轮有界 GET 请求</small><strong>21 / 32</strong><small>成功 / 总请求；11 次 503</small></div><div class="card"><small>优先阻塞项</small><strong>5 组 P0</strong><small>其余 8 项按 P1 / P2 推进</small></div></div>
<div class="callout"><b>当前可做：</b>继续模拟验证、受控单机协议读数验证。<br><b>当前不能宣称：</b>真实扫码与护套链路完成、稳定多设备并发、正式质量放行、长期容量与双库灾备通过。</div><p class="muted">本次检查不引入新中间件，不重写业务，不改模拟来源或历史判定；提出可独立派工的改进项。</p></section>
<section id="chain"><h2><em>02 / CURRENT SYSTEM</em>已有可靠性基础，但关键处仍受模拟限制</h2><div class="flow"><div><b>① 设备 / 模拟器</b><small>原始测量、状态、稳定来源 ID<br>实际仪器协议需现场核对</small></div><div><b>② Go 现场端</b><small>bbolt 原始账本 → 本地时序<br>每秒触发上传，保留全部采样点</small></div><div><b>③ 中心 API + 双库</b><small>鉴权、任务绑定、幂等回执<br>Influx 原文 + PG 判定 / 投影</small></div><div><b>④ 网页 / 报告</b><small>时间趋势、任务、历史与统计<br>护套复用 OVALITY 配对结果</small></div></div><div class="two" style="margin-top:20px"><div class="panel"><h3>已具备的能力</h3><ul><li>设备范围、工厂范围、用户角色与 CSRF 校验基础。</li><li>来源键 / 采集序号唯一约束、原文 hash 冲突检查。</li><li>逐条回执、失败保留、断网补传与重复扫码分次模型。</li><li>PG 保存计算投影与任务统计，避免摘要反复读取全部原文。</li><li>时间、值、无效、隔离、未判定、正式结论分别保留。</li></ul></div><div class="panel"><h3>已确认的边界</h3><ul><li>扫码自动启停只启用 OVALITY 模拟任务。</li><li>护套中心复核只接受模拟 A/B 配对证据。</li><li>分析进程目前只有健康心跳。</li><li>原三指标有服务代码不等于客户设备/MES 已联调。</li><li>数据库当前无 REAL 采样；本轮没有操作真机。</li></ul></div></div></section>
<section id="measure"><h2><em>03 / OBSERVED</em>低并发已暴露故障，不能只看单次响应</h2><div class="panel"><div class="table-wrap"><table><thead><tr><th>接口</th><th>同时请求数</th><th>成功数</th><th>本轮耗时范围</th><th>结果</th></tr></thead><tbody>'''+rows+'''</tbody></table></div><p class="muted">2026-11-02 15:07 北京时间；localhost:4192，现有 21 个任务，选用 15,000 条采样任务。每档一轮，样本很小，仅用于复现；不是稳定 P95、极限吞吐或正式 SLA。登录仅新增会话/审计，GET 不修改业务数据。</p><div class="two"><div><b>任务列表：10 并发</b><div class="bar"><span style="width:20%"></span><span class="red" style="width:80%"></span></div><small>2 成功 / 8 失败 · 同期 PG 共享内存报错</small></div><div><b>采样明细：10 并发</b><div class="bar"><span style="width:90%"></span><span class="red" style="width:10%"></span></div><small>9 成功 / 1 失败 · 5,164–5,331 ms</small></div></div><p><b>核验：</b>PG 容器 shm=64 MiB；池 max=10，借用超时=5 秒。查询持有事务时再次借池的代码路径与约 5 秒等待一致，仍需修复前后对照确认。PG 日志直接确认了共享内存故障。</p></div></section>
<section id="work"><h2><em>04 / ACTIONABLE BACKLOG</em>逐项开发与验收</h2><p class="muted">P0：真机联调门槛；P1：连续多设备运行门槛；P2：现场交付门槛。状态描述为当前完成情况，不是已批准验收。</p>'''+cards+'''</section>
<section id="capacity"><h2><em>05 / CAPACITY</em>一秒一批，不是一秒一个点</h2><div class="two"><div class="panel"><h3>容量示例 · 仅数学推算</h3><div class="table-wrap"><table><tr><th>配置</th><th>每日采样</th></tr><tr><td>1 台 × 10 Hz</td><td>864,000 点</td></tr><tr><td>1 台 × 50 Hz</td><td>4,320,000 点</td></tr><tr><td>10 台 × 50 Hz</td><td>43,200,000 点</td></tr></table></div><p>假设序列化原文平均 2 KiB/点，1 台 50 Hz 单原文约 8.24 GiB/天；不含 base64 膨胀、索引、WAL、PG 多表、边缘副本及备份。该大小是预算假设，不能替代实测。</p></div><div class="panel"><h3>建议验证线 · 待确认</h3><ul><li>输入：设备数 N、频率 F、平均/最大报文、同步用户数、保留周期。</li><li>混合负载：持续采集 + 10/20 个页面查询 + 导出 + 补传。</li><li>健康网络建议 P95 页面摘要 &lt;1 秒、采样到可见 &lt;3 秒；须与客户签认。</li><li>2 倍峰值突发 10 分钟；断网 30 分钟后可持续追平积压。</li><li>72 小时长稳：已确认点丢失 0，重复业务行 0，无错误任务归属；拒绝记录有原因。</li></ul></div></div><p class="muted">限制条件：1 MiB 可能先于 500 条批量上限触发；按字节拆批，保持每点 ID。当前 HTTP 响应 25 条约 181 KiB，因此全量原文趋势也必须纳入网络/内存预算。</p></section>
<section id="route"><h2><em>06 / DELIVERY GATES</em>建议实施顺序</h2><div class="steps"><div><b>第一阶段 · 基础修复</b><small>P0-01/04/05：共享内存与连接、迁移、权限。验证同负载无 503，并保存升级演练证据。</small></div><div><b>第二阶段 · 单机 REAL 闭环</b><small>P0-02/03：身份、扫码、A/B、时间和正式方法。真实单机原文→中心→页面逐点核对。</small></div><div><b>第三阶段 · 吞吐与恢复</b><small>P1-06～12：批量、限流、双库、容量、趋势、分析、诊断。持续与故障场景通过。</small></div><div><b>第四阶段 · 现场验收</b><small>P2-13：实机参数、安装、拔插、断电、长稳。客户确认记录数、准确性、操作与恢复。</small></div><div><b>暂不必增加</b><small>Redis、消息队列、微服务、专用分析库。先量化瓶颈并完成现有持久化链路。</small></div><div><b>待用户 / 厂商提供</b><small>实际型号固件、黄金报文、峰值频率、时钟来源、设备数、阈值审批、保留期和恢复目标。</small></div></div></section>
<section id="evidence"><h2><em>07 / EVIDENCE</em>验证结果与发布范围</h2><div class="panel"><ul><li><b>本轮通过：</b>canonical、time01、sc01-sheath、bc01 共 14 项 Node 定向测试；实际数据库只读计数与投影覆盖核对。</li><li><b>本轮未通过：</b>32 次有界查询中 11 次 503，问题完整保留，不计入验收成功。</li><li><b>未执行：</b>真机、写入压力、断电/断网故障注入、长期存储和联合灾备。Windows 主机无可用 go 命令，未运行 Go 测试。</li><li><b>运行基线：</b>后端镜像 c6096dbe8390…；api.js、storage-api.js、main.js 本地构建与容器 SHA256 一致。当前 PG 16.9、中心 InfluxDB 2.9.1；016 已登记、017 未部署。</li><li><b>版本边界：</b>内层 Git 基线 cd9d746；外层应用另按文件快照发布。此次不修改数据库、设备接口或运行服务。</li><li><b>证据：</b>本地 HWREADY01 目录内 read-only-observation.json、postgresql-errors.txt、验收记录.md。测试详情保留本地，不公开运行凭据和客户原件。</li></ul><p>GitHub 使用独立 codex/hw-readiness-20261102 分支；最终推送状态以交付说明和远程提交核对为准。公开发布源码与说明不代表本轮所有源码已重新构建或部署。</p></div></section><div class="footer">慧眼智检 · HWREADY01 / 2026-11-02<br>审查完成 ≠ 修复完成 ≠ 真机验收。报告内容仅以本次核对证据为准。</div></main></body></html>'''
repair='''<section id="perf02"><h2><em>PERF02 / 2026-11-02</em>03项修复补记 · 已部署，自测通过待验收</h2><div class="panel"><p><b>修复：</b>M04明细投影复用事务连接，消除连接池二次借用等待；任务摘要先聚合末次入库序号，再关联少量记录，避免全量原文排序与并行Hash。</p><div class="table-wrap"><table><tr><th>场景</th><th>本轮修复前</th><th>部署后（三轮）</th></tr><tr><td>任务列表 · 10并发</td><td>3/10成功 · 394–866ms</td><td>30/30成功 · 189–268ms</td></tr><tr><td>采样明细 · 10并发</td><td>9/10成功 · 5345–5503ms</td><td>30/30成功 · 242–392ms</td></tr><tr><td>两接口 · 20并发</td><td>未测</td><td>120/120成功 · 193–718ms</td></tr></table></div><p>部署后1/5/10/20并发各三轮共216次全部200；隔离环境另216次全部200。16项定向测试、8项PG测试、24项API行为对比及真实浏览器筛选分页通过。样本仍35,279条；仅4192更新，无表结构或PG配置变更。</p><p class="muted">原始审查内容保留为15:07基线；本轮复现32次9失败与原审查11失败为不同运行。此次短时读查询验证不代表持续写入、混合负载、P95/SLA或真机通过。原启动m04/m07/m06 schema权限错误仍待独立修复；本轮未新增共享内存错误。证据：临时文件夹/PERF02_低并发查询修复/验收记录.md。</p></div></section>'''
doc=doc.replace('<main>', '<main>'+repair, 1)
doc=doc.replace('<nav aria-label="报告章节">','<nav aria-label="报告章节"><a href="#perf02">最新修复</a>',1)
doc=doc.replace('03 / OBSERVED</em>低并发已暴露故障，不能只看单次响应','03 / OBSERVED</em>原始观察：低并发故障（修复见PERF02补记）')
for p in [root/'docs/reports/hardware-readiness-20261102.html',evidence/'真机联调准备度报告.html']:
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(doc,encoding='utf-8')
print('Standalone report written; no external scripts/fonts/images')
