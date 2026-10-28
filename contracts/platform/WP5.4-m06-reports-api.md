# WP5.4 M06 质量报告与追溯快照 API 契约
2026-10-28｜已实现、自测，待用户验收。API 前缀 `/api/v1`，沿用统一响应及人员 Cookie 鉴权；需要 `reports:read` / `reports:write` 权限。

## 1 接口概览

| 接口 | 方法 | 权限 | 描述 |
|---|---|---|---|
| `/api/v1/reports` | GET | reports:read | 质量报告列表分页与多维筛选（支持 spool_id, work_order_id, state, final_result, report_kind） |
| `/api/v1/reports:generate` | POST | reports:write | 生成整盘/任务质量报告，聚合三项指标统计、覆盖米数并冻结 SHA-256 快照 |
| `/api/v1/reports/:id` | GET | reports:read | 报告不可变快照详情与防伪指纹查询 |
| `/api/v1/reports/:id:publish` | POST | reports:write | 质检主管发布报告（GENERATED -> PUBLISHED，冻结发布时点与人员） |
| `/api/v1/reports/:id/export` | GET | reports:read | 导出标准结构化质检合格证书与审计摘要 |

## 2 类型契约文件
TypeScript 共享类型定义已落盘于：
`contracts/platform/m06-reports.ts`
前端可在 P16/P17（报告生成、查阅与导出模块）直接导入复用。
