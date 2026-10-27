# 本地部署验证记录

## 2026-10-26 AD02最新验证

五个常驻容器healthy，分别停止web/admin后，另一前端真实查询、API及模拟器均正常，现已恢复。188项前端回归、52项API/代理/权限/资源检查通过。共享业务及账号逐行哈希不变，设置写入仅在隔离数据库验证。待用户验收，见[AD02证据](../临时文件夹/AD02_独立管理前端/验收记录.md)。

## 2026-10-26 OPS01最新运行检查

当前日常服务为web 4181、B1 backend 4192、PostgreSQL 4193及独立模拟器Web 4196。数据库初查停止、后端503；已恢复数据库，并在b1.compose.yaml和既有容器设置unless-stopped重启策略。四个容器恢复healthy，HTTP健康及模拟器到后端只读profile查询通过。已删除6个退出的隔离测试容器；所有数据卷、镜像及其他项目容器保留。详情见[OPS01记录](../huiyanzhijian/docs/workpackages/OPS01_服务检查与测试容器清理.md)。下文为原前端部署历史。

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

## 2026-10-21 STRUCT01路径调整验证

web已迁入apps/web，Nginx配置归infra/middleware/nginx。构建及隔离容器检查通过，旧服务未替换。最新证据见 [STRUCT01](../huiyanzhijian/docs/workpackages/STRUCT01_工程目录整理.md)，此前正文保留为历史记录。

## 2026-10-21 ING01：按用户要求更新现有Docker

已执行并成功：

```powershell
docker compose -f docker/compose.yaml config --quiet
docker tag huiyan-web:local huiyan-web:before-ing01-20261021
docker compose -f docker/compose.yaml build --pull=false web
docker compose -f docker/compose.yaml up -d --no-build --pull never --force-recreate web
docker compose -f docker/compose.yaml exec -T web nginx -t
```

- 复用本机node:22-bookworm与nginx:1.27-alpine，未执行docker pull。构建缓存命中，未将缓存步骤描述为本轮重新运行的npm/TypeScript测试。
- 旧容器 `7737b1068177` 已由新容器 `84616058ab60` 替代，名称仍为huiyan-local-web-1。
- 新容器镜像引用 `sha256:37b1490123a05a460f74f576e0992215dc5489ab52b35fe7e8258e05b5592f24`，检查时healthy；启动时间UTC `2026-10-21T07:00:28.611451249Z`。
- Nginx配置测试通过，healthz为200/ok，根页面200；index-30QdnkCn.js和index-DvxSZ05S.css均200，资源名与此前部署一致。
- 真实浏览器打开4181，输入演示admin/1234并点击登录，进入#dashboard；回读到12项任务、3/3设备及“演示数据 · 非现场实测”。截图已保存。
- 当前UI、功能与配色没有代码改动，浏览器存储未清除。没有新增后端、数据库或模拟器；9个接入API及32项运行验收均未执行。

证据目录：[ING01](../临时文件夹/接入契约_ING01/)，包含docker-before/after.json、docker-build.log、docker-up.log、http-check.json及docker-dashboard.png。旧镜像保留为huiyan-web:before-ing01-20261021；必要时将其重新标记为huiyan-web:local并以--no-build --pull never重建web即可回退。本次没有执行回退、删除卷或清除用户数据。

