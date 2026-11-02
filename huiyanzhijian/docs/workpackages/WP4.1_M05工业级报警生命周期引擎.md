# WP4.1 M05 工业级报警生命周期引擎

> 2026-10-28 · 阶段四核心业务逻辑交付物 · M05 工业级报警生命周期引擎 · 数据库迁移 009、全量自动化测试与 4192 生产容器端到端验证 100% 通过。

---

## 一、 需求与用户指示对齐

按照最新指示：
1. **脱离真机接入约束**：现阶段不接入真实硬件设备，真机接入功能对应 **4196 端口数据模拟器** 进行数据驱动；
2. **核心业务逻辑全量交付**：除真机接入外，平台的业务功能、处理模块、计算公式等内容照常开发；
3. **避免冲突**：全流程完全避开前端 `apps/web/` 目录，专注于后端底盘、数据库设计与工业级业务状态机。

---

## 二、 架构与数据库设计（009 迁移）

在 PostgreSQL 中引入全新 Schema `m05`，建立了工业级报警实体、处置动作轨迹与幂等收据表：
1. `m05.alarm_event`：存储结构化报警事件（支持 `QUALITY`/`DEVICE`/`DATA` 三类），具备生命周期 `lifecycle`（`ACTIVE`/`RECOVERED`）与处理状态 `handling_state`（`PENDING` -> `PROCESSING` -> `HANDLED` -> `REVIEWED`），记录区段起始米数、样本计数与超限峰值；
2. `m05.alarm_action`：不可变审计动作轨迹表，记录触发（TRIGGER）、确认（ACKNOWLEDGE）、处置登记（HANDLE）、主管复核（REVIEW）的每一次操作人、操作意见与附件证据；
3. `m05.alarm_command_receipt`：保证高并发场景下的命令幂等性。

---

## 三、 核心业务能力与 API 清单

平台提供如下受控 REST 接口：

| HTTP 方法 | 接口路径 | 功能说明 | 权限控制 |
|---|---|---|---|
| `GET` | `/api/v1/alarms` | 报警列表多维筛选（支持处理状态、生命周期、指标、设备、任务、游标分页） | `alarms:read` |
| `GET` | `/api/v1/alarms/:id` | 报警详情查询（含触发原始快照与全量处置时间线 `actions`） | `alarms:read` |
| `POST` | `/api/v1/alarms/:id:ack` | 操作员确认报警（`PENDING` -> `PROCESSING`），幂等防重 | `alarms:write` |
| `POST` | `/api/v1/alarms/:id:handle` | 操作员处置登记（`PROCESSING` -> `HANDLED`），支持处置意见与附件 | `alarms:write` |
| `POST` | `/api/v1/alarms/:id:review` | 质检主管复核（`HANDLED` -> `REVIEWED` 通过 / 驳回），闭环结案 | `alarms:write` |
| `POST` | `/api/v1/alarms:aggregate` | 测点防抖合并引擎：基于 4196 模拟器上报的 FAIL 测点自动合并为工业报警 | `alarms:write` |

---

## 四、 验证结果

1. **自动化集成测试**：`tests/backend/m05-alarms.test.ts` 4 项测试全部通过；
2. **本地 4192 Docker 容器实测**：
   - 重新构建 `huiyan-backend:b1` 镜像并启动，容器健康；
   - 触发 4196 上报测点聚合：成功检测到 54 个超限测点并防抖合并为 12 个结构化工业报警事件；
   - 端到端完成 `[ALR-8307d71d]` 的 **确认 -> 处置意见 -> 主管复核 -> 查看完整 4 项时间线轨迹** 闭环，状态转为 `REVIEWED`！
