# 业务与管理前端独立部署

2026-10-26，AD02，已部署、自测通过，待用户验收。本文取代旧原型的任意密码、无API及独立后台预留说明。

| 应用 | 入口 | Compose / 服务 |
|---|---|---|
| 业务平台 | http://127.0.0.1:4181/ | docker/compose.yaml / web |
| 管理后台 | http://127.0.0.1:4182/ | apps/admin-web/compose.yaml / admin-web |
| 设备模拟器 | http://127.0.0.1:4196/ | tools/simulator/compose.yaml / simulator |
| 后端API | http://127.0.0.1:4192/api/v1 | docker/b1.compose.yaml / backend |

## 职责

4181保留全部已实现的日常业务与业务配置：设备资料、规格、任务、工单、线缆、检测、历史导出、配方查看、自动发现策略等。日常业务不依赖管理后台服务运行。

4182负责账号、固定角色与工厂权限、平台名称/机构/管理列表默认条数、个人显示偏好、审计、运行日志及采集诊断。原4181的users/audit/settings地址保留hash参数后跳转至4182；业务侧只保留一个管理后台导航入口。尚未实现的设备新增、扫码、正式报表、阈值编辑不会因拆分自动成为已交付功能。

## 独立启动、停止与更新

在项目根目录运行：

```powershell
docker compose -f docker/compose.yaml up -d --no-build --pull never web
docker compose -f apps/admin-web/compose.yaml up -d --no-build --pull never admin-web
node tools/simulator.mjs start

docker compose -f docker/compose.yaml stop web
docker compose -f docker/compose.yaml start web
docker compose -f apps/admin-web/compose.yaml stop admin-web
docker compose -f apps/admin-web/compose.yaml start admin-web
node tools/simulator.mjs stop

# 仅构建需更新的一端，成功后运行对应的up命令
docker compose -f docker/compose.yaml build --pull=false web
docker compose -f apps/admin-web/compose.yaml build --pull=false admin-web
```

两个前端各有入口、package-lock、dist、镜像及Compose服务，不重建另一前端即可更新。后端/PostgreSQL/附件/模拟器卷保持原配置，本次不运行初始化、清库、删除卷或重置密码。

## 会话与代理

两端各自通过同源/api直接代理4192，无运行时前端互赖。账号沿用现有平台账号，服务端检查权限；能打开4182不等于管理员。

同一主机名不同端口共用hy_session/hy_csrf Cookie。会话HttpOnly、SameSite=Strict、/api/v1路径保持不变，凭据不写localStorage。任一前端退出会撤销当前共享会话，另一端在刷新、返回页面、15秒轮询或下一次请求时失效。写入前重新核验身份/工厂/权限与CSRF，身份变化终止提交，不自动重放。不同主机名（包括localhost与127.0.0.1）分别登录。

## 部署地址配置

跨应用地址由ADMIN_APP_URL、BUSINESS_APP_URL构建变量配置，Compose映射到VITE_ADMIN_APP_URL和VITE_BUSINESS_APP_URL。未配置时使用当前协议/主机及4182/4181端口，没有固定127.0.0.1跳转地址。配置支持HTTPS、不同域名及部署子路径，旧hash查询完整保留。

```dotenv
ADMIN_APP_URL=https://admin.example.com/
BUSINESS_APP_URL=https://quality.example.com/
API_UPSTREAM=http://platform-api:4192
```

两个Compose构建/启动时传同一`--env-file`路径。跨应用地址变更需重新构建对应前端；API_UPSTREAM是运行时变量，变更后仅需重建相应容器。Nginx启动模板生成代理配置，默认上游http://host.docker.internal:4192。云HTTPS、远程监听及域名需另配环境，本轮未发布外网。

本机Vite开发端口为业务4180、管理4183，代理4192。端口分离不替代服务端权限控制。

## 共享代码及回退

公共UI/登录壳/styles/public资产仍单一来源于apps/web；API、偏好与查询hook集中在apps/web/src/shared。admin构建读取这些源码并生成自己的静态产物，运行时不加载4181资源，不复制整套业务页面。管理业务唯一实现在apps/admin-web/src/AdminPages.tsx；原原型页面仅保留历史测试用途。

修改前源码归档runtime/ad02/source-before.zip；业务原镜像已标记huiyan-web:before-ad02。回退需审核恢复对应文件，避免覆盖后续修改；将旧镜像重新标记huiyan-web:local后仅重建web容器即可回退前端。本次无数据库迁移。

验证证据：[AD02验收记录](../docs/workpackages/AD02_管理前端独立部署.md)。
