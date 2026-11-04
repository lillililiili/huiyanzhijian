# 当前工程架构

## 运行链路

```text
设备/独立模拟器 → 现场 Go 采集端（bbolt 原始账本 + 本地 InfluxDB）
                          ↓ 带身份、序号、任务绑定的批次 / 回执 / 重试
                    Node.js / TypeScript / NestJS API
                          ├─ PostgreSQL：账号、订单工单、盘、任务、规则、判定、投影、统计、审计
                          └─ 中心 InfluxDB：OVALITY 原文与值
                    React / TypeScript / ECharts
                          ├─ 4181 业务前台
                          └─ 4182 管理后台
```

搭盖率与铜丝间隙原文仍保存在 PostgreSQL。护套厚度复用 OVALITY 任务及配对结果，不是独立第四类设备任务；当前配对验证是模拟范围。实时接收事实、质量判定、配对有效性必须分开。

## 目录与职责

| 路径 | 职责 |
|---|---|
| `apps/web` | 4181 业务 UI、公共 API 客户端与展示组件 |
| `apps/admin-web` | 4182 账号、设置、审计和运行诊断；复用平台身份 |
| `apps/platform` | 模块化后端；composition 组装，M00–M09 业务归属，db 迁移 |
| `边缘设备/edge-app` | 当前 Go 边缘应用、协议、持久队列、网页与打包脚本 |
| `apps/device-edge` | 早期 TypeScript 边缘工程；不等同当前 Go 现场程序 |
| `tools/simulator` | 独立线缆/设备/送料/扫码模拟平台；SQLite 持久化 |
| `adapters/inspur/http` | HTTP 采集适配源码；运行范围和部署状态见其文档，真机未验收 |
| `contracts` | 接入 schema、示例、模拟及扫码契约 |
| `docker`、`infra` | 本地 Compose、Dockerfile、数据库和网关配置 |
| `tests` | 前后端契约、业务及集成测试 |
| `huiyanzhijian/docs` | 正式设计、工作包、页面和模块台账 |
| `docs` | 工程使用说明、审查报告入口 |

平台保留模块化单体；无需为本轮接入额外引入 Redis、Kafka 或拆微服务。分析子进程当前为 health-only，耗时分析消费仍需落实。各状态以源码与部署核验为准，早期“预留目录”说明仅是历史。

## 数据边界

- 来源键和采集序号唯一约束保护幂等；SIMULATED 与 REAL 使用独立授权。
- 任务冻结规则；无效、隔离、未判定不能作为合格点。
- 不圆度/护套没有设备图片，不生成现场证据替代品。
- 中心按采样时间展示完整任务趋势；历史米数不视为已验证定位。
- 存储回执不等于质量合格；任务结束不等于整盘放行。
- PG 投影减少重复计算，但原文查询仍依赖时序；联合备份和保留策略是两套库的共同责任。
