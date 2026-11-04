# SIM12 四项工序预设与25Hz默认采样
2026-11-03，B类模拟器重构；目标4196规格与缺陷，一盘三路物理输入、四项业务结果。

## 实现和边界
所有新建规格及新设备模型默认40ms=25次/秒，旧规格/运行快照原值保留。新增process-profile.v5，保留v1-v4原算法。每次预览用crypto新种子生成三路，各路冻结基准/工序尺寸/周期/档位/参数，预览与实际送料同算法。轻微/明显/严重目标缺陷区段占比范围2–4/8–12/20–30%，正常波动、异常幅度范围逐档增加。这是情景强度，不是产品不合格率或已验证发生概率。

连续材料坐标区段（平滑进入、持续、恢复）+低频漂移+周期波动+起始过渡。直径影响相关长度，用户输入周期节距影响周期，采样窗口sinc抑制过高频周期项；不是设备真实光学带宽仿真。搭盖只减搭盖宽度、间隙偏大。A维持用户确认的固定周长，B在几何范围内变化，护套仍A均径−B均径（不改为半差）。计米器时间按配置传递。不同工序不冒充同一截面同时检测；没有实测张力/温度参数时不伪造校准关系。

页面四条原始曲线预览，统一确认一次事务保存三份规格引用（第四项来自同组A/B）；失败全部回滚、同request_id重试不重复。旧运行不换版本。新增登录及CSRF保护POST /api/specifications/bundle-preview、bundle-confirm，仅模拟器；无需中心API/PG/Go变更。保存前按现有catalog授权核查线缆。

## 资料
本地第18份、170A-2D补充说明及现有HT03/ODM03/SC04/PAR01状态和代码。网络主源：
- https://sikora.net/en/fft-analysis/ ：旋转不平衡、挤出泵动、线速变化等可能产生周期波动。
- https://sikora.net/en/lump-detection/ ：局部鼓包/缩颈是独立表面缺陷，短缺陷可能尖峰；本功能不宣称光学缺陷检出能力。
- https://blog.maillefer.net/roundness-optimization ：圆整度与纵向直径关系需多变量现场/试验标定。
以上支持模型结构，不支持本次数值范围为真实生产参数；全部幅度/频率范围是明确的模拟工程假设。

## 检查
node --check两前端脚本、Docker TypeScript构建。隔离无网络无业务卷容器9组（20/40/80mm×三档）67500点：有限值、固定周长误差<4e-6mm、圆整度和护套计算、同种子逐点复现；SQLite第三项失败全部回滚、同请求幂等通过。未真实浏览器或业务扫码/送料，HW/MES未验证。用户此前要求部署即可不需要测试；仅必要离线数学及事务检查，不写现用数据。

源码：src/process-profile.ts、preset-bundle.ts、continuous-profile.ts导出原函数、specification.ts、web-manager.ts、web-server.ts，web/preset-bundle.js、specifications.js、models.js、index.html。基线备份runtime/sim12/baseline；内层文档Git非业务源码基线，保留并行PAR01修改。

## 部署补记
仅4196更新huiyan-simulator:sim12-20261103，健康及实际HTTP脚本回读200；初次发布发现新脚本静态白名单缺项，已补齐重建，最终回读通过。46290样本保留，未启动扫码/送料。部署前无活跃模拟进程，环境差异0，SQLite备份runtime/sim12/simulator-before.sqlite。
命令：docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml -f runtime/sim12/simulator.override.yaml up -d --no-deps --no-build simulator。
用户操作：选择线缆→一键区读取基准，核对并补齐工序直径、周期和A/B→选择档位生成→查看四图→确认四项预设。已保存规格不强制改40ms；下一次送料采用新确认版本。实际浏览器/联调未验收，待用户验收、未冻结。
