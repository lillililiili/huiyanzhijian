# WP4.1 M05 工业级报警生命周期引擎 API 契约
2026-10-28｜已实现、自测，待用户验收。API 前缀 `/api/v1`，沿用统一响应及人员 Cookie 鉴权；需要 `alarms:read` / `alarms:write` 权限。

## 1 接口概览

| 接口 | 方法 | 权限 | 描述 |
|---|---|---|---|
| `/api/v1/alarms` | GET | alarms:read | 报警列表分页与多维筛选 |
| `/api/v1/alarms/:id` | GET | alarms:read | 报警详情及处置行动审计历史 |
| `/api/v1/alarms/:id:ack` | POST | alarms:write | 操作员确认报警（PENDING -> PROCESSING） |
| `/api/v1/alarms/:id:handle` | POST | alarms:write | 登记处置意见与纠正措施（-> HANDLED） |
| `/api/v1/alarms/:id:review` | POST | alarms:write | 质检主管复核审批（-> REVIEWED 或驳回回退） |
| `/api/v1/alarms:aggregate` | POST | alarms:write | 基于 M04 缺陷段防抖合并生成工业级报警 |

## 2 类型契约文件
TypeScript 共享类型定义已落盘于：
`contracts/platform/m05-alarms.ts`
前端组件可直接导入引用。
