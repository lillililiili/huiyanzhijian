# 本地部署验证记录

日期：2026-10-20。

范围：当前外层目录 `web/` 的 React 演示前端；所有部署文件放在 `docker/`。未修改业务源码、原型、内层仓库或正式页面验收台账。

内层文档仓库基线：`docs/project-definition` / `da956002eb58d75e2df67daad6766bb8b6c239ee`。外层前端不在该 Git 仓库内，不能用此提交代表前端版本。

## 实际结果

- Docker Desktop Linux 引擎可用，Compose v5.5.1。
- 复用本机已有 `node:22-bookworm`、`nginx:1.27-alpine`，未执行 docker pull。
- `docker compose config --quiet` 通过。
- `docker compose up -d --build --pull never` 成功；容器内 npm ci、TypeScript 检查及 Vite 构建通过。
- 构建存在单个 JS chunk 大于 500 kB 的提示，非构建失败；本次未修改业务分包。
- 镜像：`huiyan-web:local`；容器：`huiyan-local-web-1`。
- `docker compose exec -T web nginx -t` 通过。
- `http://127.0.0.1:4181/healthz` 返回 `ok`。
- 实际浏览器打开 4181 显示登录页；输入演示 admin / 1234 并点击登录，跳转 `#dashboard`。
- 浏览器回读工作台：12 个任务、3/3 台设备、三项当前值 12.36%、1.52 mm、4.37%；页面明确标注“演示数据 · 非现场实测”。

以上仅证明容器部署、前端构建、登录和工作台冒烟验证。未执行全部业务回归，没有真实 API、数据库、设备或 MES 验收。
