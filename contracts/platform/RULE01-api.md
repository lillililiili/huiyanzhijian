# RULE01 模拟配方管理公开接口

2026-10-27。基于B1人员会话、工厂范围、CSRF、统一响应信封。仅TEST_ONLY，设备1.0 Assignment及RuleSnapshot结构不变，仍用GE/LE/BETWEEN（均含边界）。新元数据放入parameters并随任务冻结。

| 方法 / 路径（前缀 /api/v1） | 权限 | 行为 |
|---|---|---|
| GET /recipes | data:read / USER | 当前工厂全部版本，含停用版本 |
| GET /recipes/:versionId/versions | data:read / USER | 同系列全部不可变版本与启停事件 |
| POST /recipes | rules:write / USER | 新建系列和V1.0，启用 |
| POST /recipes/:versionId/versions | rules:write / USER | 追加Vn.0，停用被编辑版本，不改其他版本 |
| POST /recipes/:versionId/status | rules:write / USER | 明确启停指定版本，记录原因 |

写接口都需Idempotency-Key；编辑和启停还需If-Match，值来自DTO.version（启停乐观锁，不是revision展示版本）。重复同键同内容返回原结果，异内容409；缺版本428，旧版本412。默认现有admin角色新增rules:write，操作员不新增维护权。

新增和编辑请求示例（specification_ids空数组表示全部适用此检测项的规格）：

```json
{"code":"BY-REF","name":"不圆度参考测试","metric_code":"OVALITY","unit":"%","comparison":{"operator":"LE","lower":null,"upper":"8"},"specification_ids":["SP035-300"],"standard_reference":"宏亮应用方案：8%仅为参考目标，供模拟测试","reason":"建立模拟参考配方"}
```

状态请求：`{"enabled":false,"reason":"暂停此测试版本"}`。不能通过请求设置approval_state、method_id或revision，也不能更改已有系列code/metric_code。编号在工厂内不区分大小写唯一。名称128字、编号64字、依据1000字、原因500字。

DTO保留id/revision/metric_code/approval_state/rule_snapshot/source_metadata，增加group_id、code、name、version_number、unit、specification_ids、standard_reference、reason、actor_id、enabled、version、created_at。历史响应`{versions: Recipe[],events: [{recipe_version_id,enabled,version,actor_id,reason,recorded_at}]}`。

数值只接收非负十进制字符串，最多14位整数、10位小数；百分比不超过100。GE只填lower，LE只填upper，另一端必须null；BETWEEN两端必填且下限≤上限。无效数据不补零。单位搭盖率%、间隙mm、不圆度%，不自动把测径仪mm差值换成不圆度%。

M03拥有recipe_metadata（只增）、recipe_state（可更新）、recipe_state_event及recipe_command_receipt（只增）；迁移008。recipe_version保留不可更新权限；原有版本仅增加管理元数据，快照和哈希原样保留。M03依赖M00权限/审计和M01公开getSpecification/metricApplicable，不直接读写M01表。维护与M02任务创建/自动发现配置通过工厂事务锁串行。

M02调用RuleApi.getSnapshot(factory,id,metric,environment,db,specificationId)，新建任务/自动进料校验启停、检测项、规格和环境；错误RECIPE_DISABLED/RECIPE_NOT_APPLICABLE/RULE_UNIT_INVALID等为422。不存在或跨工厂版本404，未授权403。停用不改变已创建任务、绑定及测量快照，已有任务可继续采样；自动发现的新任务不自动切换到新版本，也不回退到仅采集，用户需明确选择。已有手动任务复用按其原快照执行。

原件只证明参考目标：宏亮方案间隙≤3mm、不圆度≤8%；搭盖率无可直接批准的产品限值。界面按钮主动套用并保存来源，用户手动阈值须填写依据；本包不提供生产标准审批或方法/硬件公式配置。
