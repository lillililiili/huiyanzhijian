# AD01 管理接口 · 2026-10-26

沿用/api/v1、hy_session、CSRF、统一错误和request_id。固定角色admin/quality/viewer；管理角色的新增权限为users:manage、settings:write、logs:read。原业务权限保持。以下均需人员登录。

| 接口 | 权限 | 行为 |
|---|---|---|
| GET /admin/users | users:manage | q账号/姓名、status、page、limit；当前工厂分页；返回可管理角色范围、editable、version，不返回密码散列 |
| GET /admin/users/options | users:manage | 固定角色与权限说明；本人可管理且M01启用的工厂 |
| POST /admin/users | users:manage | login_name/display_name/password/roles[{factory_id,role_code}]/reason；同工厂一个角色；唯一登录名 |
| POST /admin/users/{id} | users:manage | display_name/status/roles/reason；需If-Match；目标含本人无管理权工厂则禁止全局修改 |
| POST /admin/users/{id}:reset | users:manage | password/reason；需If-Match；撤销目标旧会话，响应仅id/version/reset |
| GET /auth/factories；POST /auth/factory | data:read | 查询授权且启用工厂；切换当前会话工厂，页面整体重新读取，不扩大权限 |
| GET /admin/settings | data:read | platform工厂设置、personal账号偏好；未保存为明确默认值version=0 |
| POST /admin/settings/platform | settings:write | platform_name、organization_name、default_page_size、reason；需If-Match |
| POST /admin/settings/personal | data:read | page_size（null跟随平台）、density、reason；需If-Match |
| GET /admin/audits | audit:read | from/to/actor_id/action/resource_type/resource_id/result/request_id/id/page/limit；当前厂；追加事件；递归脱敏；返回as_of |
| GET /admin/logs | logs:read | service=platform-api、level、request_id、from/to/page/limit；当前厂；返回来源、保留期、可用时间、过期状态、as_of |
| GET /admin/diagnostics | logs:read | from/to/request_id/state/id/task_id/device_id/page/limit；M04批次；id查询额外返回最多500条回执白名单字段 |
| GET /admin/status | data:read | 检查时刻、API/DB、分析进程最后心跳与能力；未启用Redis/MQ/MinIO明确DISABLED |

## 写入与隔离

账号与设置命令需要Idempotency-Key；同键同内容返回既有结果，异内容409。命令载荷仅保存服务器密钥HMAC，不保存密码原文。数据库事务全局管理锁，锁内复核当前权限/会话、版本和每个受影响工厂最后有效管理员；改用户及审计同事务提交。用户资料、状态、角色或密码修改均撤销其旧会话。已进入的业务请求可能完成，后续请求必须重新认证。

密码12～128字符且含字母数字，scrypt加随机盐。创建/重置密码框掩码，无回显、日志或审计密码。管理员线下可信交付；远程环境须先配置TLS。未实现自助找回/邮件短信/SSO、角色定义编辑。

角色管理仅分配既有角色。多个工厂的账号详情仅返回操作者管辖范围；包含其他范围时禁止全局编辑。按厂写入的审计角色快照也只包含该厂内容。匿名失败登录没有可信工厂，不在厂级网页日志中公开。

## 设置生效

平台名称/机构名最长128；默认管理页20/50/100条。个人条数null/20/50/100；密度comfortable/compact。保存后标题与密度生效；新打开管理列表采用个人优先、平台其次、20兜底，显式URL条数优先。旧业务列表分页和质量数据无变化。平台配置按工厂，个人按账号跨浏览器保存，不使用localStorage伪装持久化。

## 查询与安全

分页page>=1、limit1～100，固定排序时间倒序加ID。时间带时区，精度最高微秒，区间[from,to)。日志及审计首次返回as_of，后续页沿用to，避免新增请求挤动分页；改变条件重新查询。审计导出仅当前筛选页JSON，导出前重新请求鉴权，不声称导出全部结果。

运行日志仅API安全白名单：时间、服务、级别、请求号、归一化路由、HTTP状态、错误码、耗时。无请求正文、查询值、Cookie/Token/密码。动态路径段归一化；没有任务/设备字段则不提供该日志筛选。任务/设备筛选在采集诊断中基于已存储记录关联，拒绝未关联报文不伪造来源。回执展示错误码，不返回原文和凭据。

ops.runtime_log保留7天、全实例100000条，写入时最多每分钟触发受限清理函数；无流量时旧物理行下次清理，查询始终排除过期行。Docker原有json-file 10m×5继续保留且不经网页读取。无Docker socket、Shell或文件路径接口。采集批次/审计暂不自动清理；长期容量政策另行确认，不混用运行日志7天期限。

API/DB不可达返回503，页面状态未知/读取失败；worker有记录但心跳过期为异常，无记录为未知；health-only仅健康心跳。不得据此声称分析或正式质量报告可用。

## 错误与验收

401会话无效；403权限/工厂/CSRF；404资源或日志源不存在；409账号唯一、版本、幂等或LAST_ADMIN；400字段/时间/密码非法；503真实依赖失败。列表失败不返回成功空集合。审计runtime仅SELECT/INSERT，无UPDATE/DELETE权限。

自动验证：tests/backend/ad01-cases.ts；前端组件tests：apps/web/src/app/adminPages.test.tsx。真实浏览器/DB证据：临时文件夹/AD01_管理后台真实贯通。密码输入及授权扩大网页最终提交待用户人工验收，不计作浏览器通过。
