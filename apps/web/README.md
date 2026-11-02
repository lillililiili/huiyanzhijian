# 业务前台 · 4181

React / TypeScript / ECharts，默认 LiveApp 使用真实平台 API；不读取历史原型的本地演示数据。管理后台已独立在 `apps/admin-web`，共用身份和后端。

```powershell
npm ci
npm run dev
npm run build
npm test
```

开发/预览默认 4180；Docker 业务入口为 4181。部署配置位于 `docker/compose.yaml`。

检测中心四入口共用时间趋势与记录操作风格；护套具有独立配对状态，不套用不圆度质量阈值。任务、设备、采样、质量判定和来源状态分别显示。数据详情通过 API 回读，不在浏览器生成业务结论。

当前实现与限制见 [架构](../../docs/ARCHITECTURE.md)、[联调审查](../../docs/HW-READINESS.md) 和正式页面台账。旧原型保留作历史参考，不是当前运行应用。
