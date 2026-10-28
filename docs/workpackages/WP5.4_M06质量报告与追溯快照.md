# WP5.4 M06 质量报告与追溯快照体系

> 2026-10-28 · 阶段五核心业务逻辑交付物 · M06 质量报告快照生成、三项指标覆盖统计与防伪验真体系 · 数据库迁移 011、全量自动化测试与 4192 真实容器端到端验证 100% 通过。

---

## 一、 需求与工作目标

按照用户指示与《后续开发计划清单_基于评估报告推进_2026-10-28.md》：
1. **测试驱动环境**：真机物理联调延后，三项指标（搭盖率、铜丝间隙、不圆度）由 4196 端口模拟器持续驱动；
2. **核心业务逻辑与公式照常开发**：提供完整的整盘质量检验报告生成、有效区间覆盖计算、指标极值/均值/符合率计算，以及 SHA-256 跨字段防伪快照冻结机制；
3. **避免冲突**：专注于平台后端（`apps/platform/modules/m06-quality/`）与共享契约（`contracts/platform/`），绝不改动前端目录，并通过消息系统与协同前端 Agent 保持紧密联动。

---

## 二、 架构与数据库设计（011 迁移）

在 PostgreSQL 数据库中引入 Schema `m06`，新增三张核心业务表：
1. `m06.report_template_version`：报告模板版本化定义表
   - 支持模板编号、版本、标题、抬头、签署栏定义、页脚与内容分块；
   - 插入默认工厂批准模板 `DEFAULT_STANDARD`（高压电缆铠装与挤塑工序质量检验与追溯报告）。
2. `m06.quality_report`：不可变质量报告快照表
   - 记录报告编号（如 `QR-73AF4F4C-MVRJFHHS`）、线缆盘号、工单号、关联任务清单；
   - 冻结覆盖快照 `coverage_snapshot`（起止米数、覆盖有效米数、记录数、完整性）；
   - 冻结指标统计快照 `statistics`（搭盖率、铜丝间隙、不圆度的总采样数、有效数、合格数、超限数、极值、平均值与符合率百分比）；
   - 冻结最终质量判定 `final_result`（`PASS` / `FAIL` / `CONDITIONAL`）；
   - 冻结防伪指纹 `snapshot_hash`（基于跨字段规范化 Canonical JSON 生成的 SHA-256 摘要），确保生成的快照具备法律级防篡改特性；
   - 支持生命周期状态机：`GENERATED`（已生成快照） -> `PUBLISHED`（质检主管签发，冻结发布时点与发布人员）。
3. `m06.report_command_receipt`：保证高并发场景下报告生成与发布的幂等防重。

---

## 三、 核心业务能力与 API 清单

平台提供如下受控 REST 接口（已在本地 4192 Docker 容器中部署）：

| HTTP 方法 | 接口路径 | 功能说明 | 权限控制 |
|---|---|---|---|
| `GET` | `/api/v1/reports` | 质量报告列表分页查询（支持按盘号、工单、状态、最终结论多维过滤） | `reports:read` |
| `POST` | `/api/v1/reports:generate` | 按线缆盘号聚合该盘所有检测任务数据，计算指标统计并生成不可变快照 | `reports:write` |
| `GET` | `/api/v1/reports/:id` | 质量报告详情查询（返回完整不可变数据快照与防伪哈希） | `reports:read` |
| `POST` | `/api/v1/reports/:id:publish` | 质检主管发布报告（`GENERATED` -> `PUBLISHED`，不可逆，记录签发人与时间） | `reports:write` |
| `GET` | `/api/v1/reports/:id/export` | 导出带公司抬头、指标汇总表格、签署信息与 SHA-256 防伪验证签名的质检证书 | `reports:read` |

---

## 四、 共享契约与类型定义

为保证协同前端 Agent（`19c6514c-ec6f-484f-be8c-26cd719f1f44`）开发 P16/P17 模块时类型零偏差，已在 `contracts/platform/` 生成共享定义：
1. `contracts/platform/m06-reports.ts`：导出 `QualityReportItem`, `GenerateReportDto`, `ReportFilterParams`, `QualityCertificateExport`, `CoverageSnapshot`, `MetricSummaryItem` 等完整类型；
2. `contracts/platform/WP5.4-m06-reports-api.md`：详细接口契约与传参说明。

---

## 五、 验证结果

1. **自动化集成测试**：
   - 编写 `tests/backend/m06-quality.test.ts`，涵盖无数据安全拦截、平台 API 盘任务创建、各指标统计精度核算、防伪哈希校验、发布状态流转、证书导出校验及幂等性保护；
   - **7 项测试全部绿色通过 (7 passed, 0 failed, duration ~3.2s)**。
2. **本地 4192 真实容器实测（`scratch/verify_m06_live.mjs`）**：
   - 管理员登录获取凭据；
   - 查询线缆盘列表并选取测试盘 `73af4f4c-73fe-4d3d-92af-6a71fb51f0d5`；
   - 调用 `POST /api/v1/reports:generate` 成功生成编号 `QR-73AF4F4C-MVRJFHHS` 报告快照；
   - 成功计算覆盖米数 `19.500m (0.000m ~ 19.500m)`，记录数 `40`；
   - 成功统计不圆度：总数 40，平均值 1.818%，极小值 0.000%，极大值 18.182%，符合率 90.00%，判定结论 FAIL（由于模拟器注入了缺陷）；
   - 生成 64 位 SHA-256 指纹：`9cf0015da4544fca85350d6abee6e7be4e46a47406544833ecc879c7bda903a1`；
   - 调用 `POST /api/v1/reports/:id:publish` 成功由 `U001` (admin) 签发为 `PUBLISHED`；
   - 调用 `GET /api/v1/reports/:id/export` 成功导出具备 `VERIFIED_IMMUTABLE` 校验状态的标准质检合格证书；
   - 调用 `GET /api/v1/reports` 成功从列表回读。
