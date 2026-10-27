# CAT01 基础档案维护 API

2026-10-26｜已实现、自测并部署，待用户验收。前缀 `/api/v1`，复用 M00 Cookie/CSRF、统一响应及请求号。

## 1 权限与一致性

- 查询：`data:read`；写入：`catalog:write`（现有 admin 角色）。工厂取服务端会话；跨厂或不存在对象返回404。普通人员不可修改角色来获得本权限。
- 所有写入携带 `Idempotency-Key`；修改同时携带 `If-Match`（版本字符串，支持引号）。无版本428、旧版本412；同键同文返回原结果，同键异文409。
- 写入原因必填；版本、档案、适用关系、幂等回执及审计在一个事务提交。规格维护与工单创建/任务启动共用工厂生产锁。
- 列表计数与数据在同一只读快照内查询；不同翻页请求为实时分页，不冻结全量结果。

## 2 接口

| 方法与路径 | 请求 | 返回 |
|---|---|---|
| GET `/catalog/specifications` | `q`、`enabled=true/false`、`page`、`limit`（1～100） | `items,total,page,limit`；按创建时间倒序、ID稳定排序 |
| GET `/catalog/specifications/{id}` | 无 | 规格及 `applicability`；响应头 `ETag` |
| POST `/catalog/specifications` | 完整规格字段＋reason | 新规格，version=1；ID为独立UUID，业务编号不是ID |
| POST `/catalog/specifications/{id}` | 完整规格字段＋reason | 更新后规格及version；启停通过enabled完成 |
| GET `/catalog/revisions/{specifications\|devices}/{id}` | page、limit | 分页历史；version、snapshot、actor_id、request_id、reason、recorded_at |
| POST `/catalog/devices/{id}` | 下表设备资料＋reason | 更新后设备及version |

成功沿用现有人员命令的200封装。重复业务编号409；字段错误400；结构不适用422。未登录401、无权限403。设备列表/详情继续复用 GET `/catalog`。

## 3 规格字段

| 字段 | 约束 |
|---|---|
| code / name | 必填；最长64/128；code首尾无空格，同工厂唯一，按现有数据库大小写规则比较 |
| voltage_kv | 十进制字符串，最多3位小数，35～220 kV；是项目范围校验，不是仪器识别结果 |
| conductor_area_mm2 | 十进制字符串，整数最多12位、小数最多4位，大于0 |
| core_count | 整数1～1000；输入边界，不代表设备能力范围 |
| shield_structure | tape / wire / combined / none |
| enabled | 布尔值；停用保留记录 |
| cable_model / customer_code / product_type | 字符串，最长128，可空；不代替客户主数据 |
| description | 字符串，最长2000，可空 |
| applicability | 1～100项；`process_id,metric_code`；同厂工序、组合不得重复 |
| reason | 必填非空字符串，最长500 |

指标限 `SHIELD_OVERLAP_RATE/WIRE_GAP/OVALITY`。搭盖率需tape或combined，铜丝间隙需wire或combined；不圆度可用于各结构。适用关系不是方法/阈值批准。

## 4 设备资料字段

`name,model`必填，最长128；`manufacturer,serial_number,firmware`可空、最长128；`notes`可空、最长2000；`reason`必填、最长500。只修改这些字段，不允许借该接口修改工厂、工序、接入凭据、enabled、能力版本、协议或data_environment。设备新增、能力维护、校准和协议配置未在本包实现。

## 5 历史与任务

- `m01.catalog_revision`普通运行角色仅有SELECT/INSERT；首次维护旧档案时补录基线版本，原修改人未知，不虚构操作者。
- 新任务取当时规格快照；修改规格不回写已有任务的context_snapshot/rule_snapshot。
- 停用规格禁止创建新工单/新任务、禁止启动待开始任务；已运行任务及其历史继续保留。
- 新规格无批准规则时，模拟采样可入库，质量为NOT_EVALUATED；不得自动挂上演示阈值。
- 模拟器使用真实设备身份接口完成绑定、回执和持久化；来源仍标SIMULATED，HW状态不升级。

## 6 验收与剩余

已测：管理员写入/只读拒绝、跨厂404、搜索分页、重复编码、幂等、并发200/412、只追加历史、停用约束、旧快照保留、新规格模拟采样入库、网页刷新回读。证据：[CAT01验收](../../临时文件夹/CAT01_基础档案维护/验收记录.md)。

待完成：工厂/产线/工序维护、客户主数据、测量层/目标外径及公差引用、能力来源/校准、导入审核；正式规则与位置/分析另包推进。
