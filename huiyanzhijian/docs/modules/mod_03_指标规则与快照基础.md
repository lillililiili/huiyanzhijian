# M03 指标规则与快照基础：B1子范围

> RULE01（2026-10-27）当前增量：已新增配方管理公开API及008迁移，M03独占recipe_metadata/recipe_state/recipe_state_event/recipe_command_receipt；已有recipe_version不变。版本内容只追加，编辑创建新版本并停用被编辑版本，启停与内容分离。写操作要求rules:write/CSRF/幂等；更新要求If-Match；全部TEST_ONLY。公开依赖M00身份审计及M01规格适用性查询，不查询M02任务表。getSnapshot增加规格校验，停用仅禁止新绑定。 已实现、自测并部署本地，待用户验收、未冻结；HW/MES未验证。详见[工作包](../workpackages/RULE01_模拟配方版本管理.md)及[接口契约](../../../contracts/platform/RULE01-api.md)。

2026-10-21，开发2；A类G00/G01基础包，开发完成待用户验收，未冻结。文档Git基线da956002eb58d75e2df67daad6766bb8b6c239ee，分支docs/project-definition；实际工作目录C:/Users/qiyue/Desktop/kaifa/huiyanzhijian。外层源码未纳入该Git，交付以文件摘要为证，不将文档提交号当源码版本。

## 职责与流程

限定三项指标、单位、规则资格及不可变快照；为M02任务和M04判定提供公开服务。只使用明示上下界，不推导仪器算法，不批准生产规则。

正常：有效样本按Decimal与上下界含等号比较，形成PASS/FAIL。异常：INVALID/MISSING的null值保留，NOT_EVALUATED；正式来源不允许测试规则取得生产合格结论。规则内保留审批资格，不把任务完成等同规则合格。

## 公开接口与依赖

RuleApi.getSnapshot(factory,recipeId,metricCode,environment)返回不可变规则或未批准占位；evaluate(value,rule,environment)返回quality_result/reason_code；list(factory)列出规则。units/unapproved为公开值契约。TEST_ONLY只用于SIMULATED，缺规则/无效值不判合格。

无其他业务模块依赖；规则快照表不可更新。任务和测量分别保存当时快照，后续规则变化不回写旧记录。

协议版本为B1人员API及设备1.0，详见[人员接口](../../../contracts/platform/B1-api.md)、[第15份](../15_模拟器与真实设备统一接入契约.md)。输入输出实例与权限负例见tests/backend/integration.test.ts；用户操作见[验收指南](../../../临时文件夹/第一阶段_B1后端模拟器/验收操作指南.md)。

## 表、源码与迁移

拥有表：metric_definition、recipe_version。完整字段/约束/索引见[实际字段字典](../workpackages/B1_数据库字段字典.md)，事务、精度和恢复边界见[数据库日志方案](../workpackages/B1_数据库物理设计与日志方案.md)。迁移001后执行002；禁止改已执行SQL，后续增加迁移。初始化/运行账号分离。

源码在apps/platform/modules/m03-rules/api.ts；组合入口在apps/platform/composition，公开依赖通过api导入。当前仅小范围公开服务与内部SQL，后续复杂用例增长时按模块拆应用/领域/仓储，不建立另一套工程。允许修改范围见[B1工作包](../workpackages/B1_后端数据库与设备模拟器.md)。

## 验证与未交付范围

三指标正常、边界、超限、无效及十位小数已测；生产阈值审批、方法配置管理、全周不圆度公式及规则编辑界面未实现。

API＋真实数据库＋独立模拟器验证已执行，证据统一在B1工作包。无本模块UI修改或浏览器验收；HW与客户MES未执行。页面状态以第12份为准，模块/API可提测不代表全页完成。验收人：用户；结果待填写，冻结版本无。


## B3 2026-10-26增量登记

2026-10-26 B3：批量计划、服务端任务筛选、自动进出料、日期任务流水、盘号编辑/同盘分组及详情摘要已交付并自测；Docker已更新，待用户验收。保留现有React UI，HW/位置/正式质量/报告未完成。

M02拥有计划/项、日流水、自动配置、物料标识、过料与事件表；M01公开工厂时区，M01/M03只读接口支持现有事务执行器（SQL仍归原模块）；M04公开单任务样本统计，组合入口装配；M10复用B2样式并拆ProductionPages。API契约与迁移见[B3工作包](../workpackages/B3_批量计划与自动发现.md)。26后端及137前端分层测试通过，最终前端5项相关回归通过；UI/API/SIM证据见[验收记录](../../../临时文件夹/B3_批量计划与自动发现/验收记录.md)。未用户验收、未冻结，其他模块未完范围保留。

## ALR02 方法快照对齐验收（2026-10-27）

模拟器从绑定assignment.rule_snapshot.method_id生成检测值；M03继续按任务冻结快照判定。三种方法均匹配，样本各40条、每项6条FAIL、0条NOT_EVALUATED。数据库和页面回读见ALR02验收记录。未更改规则源代码、配方、比较界限或生产标准。
