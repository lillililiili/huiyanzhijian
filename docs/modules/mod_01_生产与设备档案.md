# M01 生产与设备档案：B1子范围

> CAT02（2026-10-27，TEST_ONLY）：M01既有规格保存支持页面从指标侧编辑适用关系。移除未批准的“屏蔽结构→检测项”硬编码拦截；仍只允许三项合法metric_code、同工厂有效工序、去重及至少一个适用关系。此放宽用于模拟联调，生产兼容目录待批准后另行受控实现。无表/迁移/API新增；既有版本、幂等和审计不变。见[CAT02](../workpackages/CAT02_三项指标与规格双向选择.md)。

> RULE01（2026-10-27）当前增量：增加公开metricApplicable查询供M03校验规格与检测项适用关系；M03不直接写M01表。规格档案和设备能力未新增第四检测项，原件参考目标不转换成生产批准。 已实现、自测并部署本地，待用户验收、未冻结；HW/MES未验证。详见[工作包](../workpackages/RULE01_模拟配方版本管理.md)及[接口契约](../../../contracts/platform/RULE01-api.md)。

> 当前新增维护能力见末尾CAT01；旧B1/B2只读描述保留为历史。

> 2026-10-26 B2：catalog增加当前工厂specification_applicability；B2按适用关系筛设备，规格选项含编号/电压/截面积/芯数。只读目录，不提供编辑接口；无新增表。 自测通过待用户验收；[证据](../../../临时文件夹/B2_前后端多盘联调/验收记录.md)。下方B1记录为历史基线。

2026-10-21，开发2；A类G00/G01基础包，开发完成待用户验收，未冻结。文档Git基线da956002eb58d75e2df67daad6766bb8b6c239ee，分支docs/project-definition；实际工作目录C:/Users/qiyue/Desktop/kaifa/huiyanzhijian。外层源码未纳入该Git，交付以文件摘要为证，不将文档提交号当源码版本。

## 职责与流程

读取工厂/产线/工序/设备/规格及三项适用关系；仅迁入既有固定档案，不迁入演示业务。供人员catalog查询及M02/M04校验，不提供档案编辑页面。

正常：现有3台设备和6种规格可查，任务选相容三元组。异常：非本工厂/不存在ID返回404，停用/不适用组合不允许创建或启动任务。设备online来自M04心跳，与档案enabled不同。

## 公开接口与依赖

CatalogApi.getDevice(factory,id)、getSpecification(factory,id)按工厂返回档案或404；applicable(specificationId,processId,metricCode)返回是否存在适用关系；list(factory)为同工厂固定目录。调用方先鉴权再传可信factory，不接受客户端自报权限。

本模块SQL只访问m01；设备/规格ID沿用前端原ID，但三台设备标SIMULATED，不声称已连真机。没有使用旧任务seed。

协议版本为B1人员API及设备1.0，详见[人员接口](../../../contracts/platform/B1-api.md)、[第15份](../15_模拟器与真实设备统一接入契约.md)。输入输出实例与权限负例见tests/backend/integration.test.ts；用户操作见[验收指南](../../../临时文件夹/第一阶段_B1后端模拟器/验收操作指南.md)。

## 表、源码与迁移

拥有表：factory、production_line、inspection_process、device、product_specification、specification_applicability。完整字段/约束/索引见[实际字段字典](../workpackages/B1_数据库字段字典.md)，事务、精度和恢复边界见[数据库日志方案](../workpackages/B1_数据库物理设计与日志方案.md)。迁移001后执行002；禁止改已执行SQL，后续增加迁移。初始化/运行账号分离。

源码在apps/platform/modules/m01-catalog/api.ts；组合入口在apps/platform/composition，公开依赖通过api导入。当前仅小范围公开服务与内部SQL，后续复杂用例增长时按模块拆应用/领域/仓储，不建立另一套工程。允许修改范围见[B1工作包](../workpackages/B1_后端数据库与设备模拟器.md)。

## 验证与未交付范围

固定目录数量、初始业务为空、任务相容性及跨工厂隔离已在API测试覆盖；新增编辑停用、导入审核、完整权限管理和P09/P21页面仍未交付。

API＋真实数据库＋独立模拟器验证已执行，证据统一在B1工作包。无本模块UI修改或浏览器验收；HW与客户MES未执行。页面状态以第12份为准，模块/API可提测不代表全页完成。验收人：用户；结果待填写，冻结版本无。


## B3 2026-10-26增量登记

2026-10-26 B3：批量计划、服务端任务筛选、自动进出料、日期任务流水、盘号编辑/同盘分组及详情摘要已交付并自测；Docker已更新，待用户验收。保留现有React UI，HW/位置/正式质量/报告未完成。

M02拥有计划/项、日流水、自动配置、物料标识、过料与事件表；M01公开工厂时区，M01/M03只读接口支持现有事务执行器（SQL仍归原模块）；M04公开单任务样本统计，组合入口装配；M10复用B2样式并拆ProductionPages。API契约与迁移见[B3工作包](../workpackages/B3_批量计划与自动发现.md)。26后端及137前端分层测试通过，最终前端5项相关回归通过；UI/API/SIM证据见[验收记录](../../../临时文件夹/B3_批量计划与自动发现/验收记录.md)。未用户验收、未冻结，其他模块未完范围保留。

## 2026-10-26 CAT01 规格与设备资料维护

状态：本子范围已实现、自测并部署，待用户验收，未冻结；历史“只读/维护未交付”不适用于本包。源码apps/platform/modules/m01-catalog/management.ts、apps/web/src/live/CatalogPages.tsx；006迁移归M01，M00登记catalog:write及审计公开调用。

GET/POST catalog/specifications、POST catalog/devices/{id}、GET catalog/revisions；详细字段/限制见[CAT01契约](../../../contracts/platform/CAT01-catalog-api.md)。新增catalog_command_receipt/catalog_revision，规格与设备补基础资料列。写入要求原因、幂等键、修改版本；历史仅追加，同工厂隔离。规格业务编号与内部ID分离；旧规格ID保持兼容。首次维护前基线操作者未知，不伪造历史。

规格新建/编辑/启停/工序指标关系、搜索分页；设备只编辑名称/型号/厂商/序列号/固件/备注，不能修改来源/能力/协议。M02继续通过CatalogApi读取快照与校验；目录维护与创建/启动共用生产锁，旧任务快照不变。

验收：网页规格v1→v2→停用v3、设备保存、只读回读及SQL一致；API权限/版本/重复/幂等/停用与模拟采样通过。后端62、前端179通过；[证据](../../../临时文件夹/CAT01_基础档案维护/验收记录.md)。未完成工厂/产线/工序、客户主数据、设备新增/启停/能力/校准、测量层/公差引用、导入审核。HW未测。
