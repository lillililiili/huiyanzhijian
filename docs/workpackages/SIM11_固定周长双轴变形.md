# SIM11 固定周长双轴变形

2026-11-02，B类整改，会话root，用户确认严格固定周长，以直径40mm圆为基准，非固定X+Y。只修改4196新版本不圆度规格生成及预览，保留SIM10/SC03等同期实现。

新增seeded-perimeter.v4，A原始圆直径D可配置（本次40mm），X/Y基准同值；C0=πD。连续形变沿物理区段生成，使用椭圆周长积分求解轴对；去除共模尺寸噪声，X增则Y减。B维持填写的读数，不额外注入独立尺寸漂移。本模型假设测量轴与椭圆主轴一致，不声称全周测量。原min/max判定和用户示例8%不互换，不改生产规则。

公式依据：NIST DLMF 19.9.9 https://dlmf.nist.gov/19.9.E9 。对完整直径使用C=2∫₀^(π/2)√(X²sin²θ+Y²cos²θ)dθ。数值积分逐次加密并归一化；输出六位小数，记录实际舍入误差，不声称浮点/序列化后数学零误差。仪器范围受限时整体减小变形，不逐轴裁剪。

旧v1/v2/v3快照不改写，新确认后使用v4。界面明确原始圆直径、周长约束及误差；不更改中心API、PG/InfluxDB表、边缘算法或另两项指标。按用户此前指示构建部署、不运行功能测试，待用户验收。

## 实施与部署

已实现seeded-perimeter.v4并部署4196，待用户验收。A表单变为一个原始圆直径输入（新建默认40mm），规格JSON仍保存相同的diameter_x_mm/diameter_y_mm，服务端验证两值相同。旧规格载入会提示以旧X作为原始圆直径，请核对40mm后重新生成确认；不原地重算历史快照。B保持用户填写值；原先B单轴/双轴含义不变。

正常波动与缺陷均作用于一个连续有符号形变变量，反向轴比生成后按数值积分周长归一化，消除A的共模尺寸漂移。C0=πD，D=40时C0≈125.66370614359172mm。物理区段/种子及调速位置保持；min/max圆整度、原任务规则和8%历史示例不改。

仪器量程边界通过二分降低形变强度实现，不逐轴截断；周长核对使用六位小数序列化后的X/Y。预览增加周长、周长误差、基准周长及最大误差。平均直径会随椭圆形状变化，这是固定周长而非固定X+Y模型；护套均值差公式不改。假定X/Y沿椭圆主轴，不声称旋转截面或全周重建。

### 文件及影响
- tools/simulator/src/ellipse-perimeter.ts：新增数值积分及定周长轴对求解。
- tools/simulator/src/continuous-profile.ts：仅v4新分支，v3原逻辑保留。
- tools/simulator/src/specification.ts：v4校验/点值/预览，旧版兼容。
- tools/simulator/web/specifications.js：圆直径输入、算法说明、周长回读。
- 本工作包、第12份及模块状态台账、项目开发学习交接。

无新表，无中心API/PG/InfluxDB/Go边缘/4181变更；SIM10、SC03及其他会话改动保留。外层源码不属于内层文档Git；文档分支docs/project-definition，cd9d7466d2c85971cf12ddd8eb0f1d1c07fa3fd2。原源文件备份runtime/sim11/baseline。

### 检查结果
- node --check tools/simulator/web/specifications.js：通过。
- docker build --pull=false -t huiyan-simulator:sim11 -f docker/B1.simulator.Dockerfile .：TypeScript构建通过。
- 离线数学核算：无网络、无卷的sim11一次性容器调用纯计算函数；独立65536中点积分核对D=0.01/1/40/400/655.35及形变-2/-1/-0.1/0/0.1/1/2共35组，周长误差均<0.000004mm，正向形变X不减/Y不增，量程内。最大误差0.0000011170068514587683mm（六位小数舍入后）。这不是UI或业务链路测试，也不是吞吐测试。
- D=40，零形变得40/40；形变0.1得43.702199/36.117520，周长残差约1.0572e-7mm；负形变交换轴。形变强度是内部轴比控制量，不等于单轴百分比或不圆度百分比，UI已更名。
- docker tag huiyan-simulator:sim11 huiyan-simulator:web 后，docker compose --env-file runtime/simulator/simulator.env -f tools/simulator/compose.yaml up -d --no-deps simulator：仅4196重建。
- 部署镜像sha256:562a3ceef47350a221e8ae796eaf6e261be766b1e2c6f7471f298e587b83b158；容器healthy，/health=200。
- 部署前无活动模拟送料；原卷huiyan-simulator_simulator-data保留，前后23790条样本、36条模型版本一致。SQLite备份runtime/simulator/backups/SIM11-before-20261102.sqlite；原镜像f087e26afb93d5b4ba62655c60c7cdd8db39b1fe8cfc23960288c5f557128cd8标记before-sim11。

延续用户不做业务测试的要求，未执行浏览器、送料写入、HW/MES联调；无浏览器截图，未标已验收冻结。完成构建、离线数学核算和部署健康核查。

### 用户操作与剩余条件
刷新4196/#specs，选择不圆度，原始圆直径填40，生成预览核对周长约125.663706mm与微小舍入误差，确认结果后新送料生效。老规格必须重新确认才升级v4。后续业务联调需验证新版本保存、重启、送料与预览一致及原链路不退化；本模型未包含真实材料力学、测量误差和周向旋转。
