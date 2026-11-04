# 平台后端

Node.js / TypeScript / NestJS 模块化单体。入口 `composition/main.ts`；数据库连接 `infrastructure/db.ts`；模块在 `modules/`；迁移在 `db/migrations/`。

M00 身份与管理、M01 档案、M02 工单/盘/任务、M03 规则、M04 接收/判定/投影，M05 报警、M06 报告、M07 MES、M09 边缘同步均已有不同范围源码。实现、持续调度、部署和真机验收状态需要分别核实。

PostgreSQL 保存业务和计算投影；OVALITY 原文由中心 InfluxDB 保存。读取摘要无需重算原始采样，但明细与完整趋势仍会读取时序。

```powershell
npm ci
npm run build
```

运行需要本地受控 DATABASE_URL、CURSOR_SECRET 及中心时序配置；禁止提交实际环境文件。迁移使用独立迁移角色，不使用运行账号执行 DDL。

`npm test` 包含真实数据库集成测试，先检查隔离配置再执行。纯测试及当前问题见 [开发说明](../../docs/DEVELOPMENT.md) 和 [联调准备度](../../docs/HW-READINESS.md)。

`analysis-worker.ts` 当前只有 health-only 心跳。后端部署同时使用 b1 与 ts01 Compose。当前 001/010/011 历史迁移校验漂移未解决，不能绕过校验升级。
