# WP4.3 M07 客户 MES 出站投递与对账 API 契约
2026-10-28｜已实现、自测，待用户验收。API 前缀 `/api/v1`，沿用统一响应及人员 Cookie 鉴权。

## 1 接口概览

| 接口 | 方法 | 描述 |
|---|---|---|
| `/api/v1/mes/deliveries` | GET | 出站投递记录列表查询（支持 status, business_key 过滤） |
| `/api/v1/mes/enqueue-task` | POST | 手动/自动将完工任务报告推入出站投递队列并触发投递 |
| `/api/v1/mes/deliveries/:id:retry` | POST | 对失败投递进行手动重新投递 |

## 2 类型契约文件
TypeScript 共享类型定义已落盘于：
`contracts/platform/m07-mes.ts`
出站 Schema 已落盘于：
`contracts/mes/v1/mes-inspection-report.schema.json`
