# 慧眼智检线缆质量管控平台

本项目面向 35–220kV 高压电缆生产场景，建设三项检测的设备接入、现场检测、质量追溯和 MES 数据输出能力。仓库包含原生原型、React 演示前端、业务/管理前端、Node 平台后端、设备输入模拟器、PostgreSQL 迁移、接口契约与 Docker 部署文件。

## 当前状态

- 代码仓库：[lillililiili/huiyanzhijian](https://github.com/lillililiili/huiyanzhijian)。
- `web/` 是 localStorage 演示前端；实际业务端在 `apps/web/`，管理端在 `apps/admin-web/`，Node/TypeScript API 在 `apps/platform/`，独立设备模拟器在 `tools/simulator/`。模拟器只经设备契约调用 API；不会直写 PostgreSQL。SIMULATED 数据与真实设备数据来源标识保持区分。
- PostgreSQL 表结构通过 `apps/platform/db/migrations/` 中的有序 SQL 迁移管理；设备输入契约、OpenAPI 与样例位于 `contracts/`。本地凭据、运行期配置、数据库卷、SQLite 队列及备份不提交到 Git。
- Docker Compose 部署文件：`docker/b1.compose.yaml`（PostgreSQL、API 与 CLI 模拟器）、`docker/compose.yaml`（业务前端）、`apps/admin-web/compose.yaml`（管理前端）、`tools/simulator/compose.yaml`（4196 模拟器 Web）。旧 localStorage 演示部署单独保留在 `docker/demo.compose.yaml`。
- `node_modules`、`dist` 等构建目录不入库。各前端、后端及模拟器用已提交的 `package-lock.json` 通过 Docker 构建；无需提交约 1.3 GB 的解压交付包或重复的历史运行快照。
- 2026-10-20 从用户提供的 `huiyanzhijian.zip` 导入的演示前端、Docker 配置及设计资料仍保留；导入说明见 [记录](docs/verification/2026-10-20_压缩包代码导入.md)。
- 2026-10-09 核对代码基线 `cbd8c76`：已包含 [27 页原生交互原型](慧眼智检-原生原型/README.md)，可在本机运行。
- 两份 Word 文档、一份 Excel 台账原样保存在 [项目资料](项目资料/)；十张参考图已在 [原型参考图目录](慧眼智检-原生原型/assets/references/) 归档。
- 全局开发文档记录架构、页面台账与模块范围。当前运行实现采用 React/TypeScript、Node/TypeScript 和 PostgreSQL；原生原型和 `web/` 演示数据不作为生产能力依据。
- B1–B3、AD02、SIM02–SIM07 等功能状态与验证范围以 `docs/12_页面开发与测试台账.md`、对应工作包和模块台账为准。代码提交、Docker 构建、模拟器验证、真实浏览器、真机和 MES 验收分别记录；未注明完成的现场验证仍待执行。
- 当前提交分支为 `docs/project-definition`。该分支包含项目文档、演示前端和完整业务源包；每个包的运行与部署方法见下文和子目录 README。

## 项目文件入口

| 文件 | 用途 |
|---|---|
| [项目总说明](docs/01_项目总说明.md) | 范围、现状、技术选型、环境、非功能要求 |
| [全局编码规范](docs/02_全局编码规范.md) | 命名、分层、错误处理、模块协作和测试 |
| [整体架构与模块拆分](docs/03_整体架构&模块拆分文档.md) | 模块编号、公开接口、允许依赖、开发顺序 |
| [数据库设计](docs/04_数据库设计.md) | 逻辑表、字段、索引、所属模块和迁移约束 |
| [接口总契约](docs/05_接口总契约文档.md) | 请求、响应、鉴权、错误码、数据与事件契约 |
| [风险与约束](docs/06_风险&约束.md) | 冻结规则、会话隔离、待决事项和变更流程 |
| [领域术语](CONTEXT.md) | 工单、盘号、测量、判定、报警等统一含义 |
| [AI 会话模板](.prompt.md) | A 新模块、B 修复或重构、C 下个模块设计 |
| [模块状态台账](docs/modules/模块状态台账.md) | 每个模块的版本、负责人、验收与冻结证据 |
| [模块文档模板](docs/modules/模块文档模板.md) | 模块设计、实现、测试和交接的统一格式 |
| [原型页面与开发映射](docs/07_原型页面与开发映射.md) | 27 页、页面区块、按钮、数据来源、模块和接口映射 |
| [业务规则与验收基线](docs/08_业务规则与验收基线.md) | 状态机、权限、统计、补录、报告、异常与验收场景 |
| [审查记录与开发任务](docs/09_文档审查与开发任务.md) | 本次发现、修正依据、剩余决策、可分配工作包 |
| [第一轮开发任务清单](docs/10_第一轮开发任务清单.md) | V1.1按页面派工、职责、交付与验收；[可转发Word版](docs/交付/10_第一轮开发任务清单_开发人员版_V1.1.docx)；原V1.0保留为历史 |
| [R01技术选型与工程方案](docs/11_R01技术选型与工程方案.md) | 推荐理由、候选版本、工程部署、三类测试与负责人确认事项；[Word版](docs/交付/11_R01技术选型与工程方案_V1.0.docx) |
| [页面开发与测试台账](docs/12_页面开发与测试台账.md) | 页面分期、依赖、当前可测状态与逐页提测门槛 |
| [页面任务与提测模板](docs/pages/页面任务与提测模板.md) | 每页前后端、契约、测试数据与交接；[P09规格档案样例](docs/pages/P09_规格档案_页面工作包.md) |

## 完整业务栈部署（Windows / Docker Desktop）

在仓库根目录使用 PowerShell。首次准备需要 Node.js 22、Docker Desktop 和可用的 Docker 镜像 `node:22-bookworm`、`postgis/postgis:16-3.5`、`nginx:1.27-alpine`；本仓库的 Compose 配置不自动拉取镜像。缺少镜像时先按本机网络与镜像策略获取。

```powershell
node tools/b1.mjs init
docker compose -f docker/compose.yaml up -d --build --pull never web
docker compose -f apps/admin-web/compose.yaml up -d --build --pull never admin-web
node tools/simulator.mjs init
```

`node tools/b1.mjs init` 创建本机运行配置，启动 PostgreSQL，构建 API 与 CLI 模拟器，执行有序迁移及初始档案引导，再启动 API。首次运行会在 `runtime/b1/` 生成凭据；`node tools/simulator.mjs init` 使用设备凭据生成独立模拟器 Web 配置。凭据只保存在本机，不要提交或分享该目录。

| 服务 | 本地地址 | 部署说明 |
|---|---|---|
| 业务前端 | http://127.0.0.1:4181/ | [业务 Docker 配置](docker/README.md) |
| 管理前端 | http://127.0.0.1:4182/ | [AD02 部署说明](docker/AD02-DEPLOYMENT.md) |
| 平台 API | http://127.0.0.1:4192/api/v1 | [后端说明](apps/platform/README.md) |
| PostgreSQL | 127.0.0.1:4193 | 表和字段变更见 `apps/platform/db/migrations/` |
| 设备模拟器 Web | http://127.0.0.1:4196/ | [模拟器使用说明](tools/simulator/README.md) |

日常启动/停止可用 `node tools/b1.mjs start`、`node tools/b1.mjs stop`、`node tools/simulator.mjs start` 和 `node tools/simulator.mjs stop`；停止服务不会删除命名数据卷。数据库备份命令为 `node tools/b1.mjs backup`，生成的备份保存在被 Git 忽略的本地 `runtime/b1/backups/`。升级前按部署文档备份并保留卷；不要使用 `docker compose down -v` 清理业务数据。

每个包也可独立开发：平台 `apps/platform/`、业务前端 `apps/web/`、管理前端 `apps/admin-web/`、SIMULATED Web 模拟器 `tools/simulator/`。这些包各自有 README、锁文件与容器定义。`apps/device-edge/` 目前只有采集端预留说明，不含可运行驱动；真机/MES 是否接通以工作包和验收记录为准。

## 演示与原型

旧 React 演示前端与原生原型仍保留，便于对照页面和历史验证；它们不替代真实业务前端/API。

Windows 10/11 64 位电脑可使用免安装交付包：完整解压后双击 `启动平台.bat`，自动打开 `http://127.0.0.1:4188/`；双击 `停止平台.bat` 结束服务。包内自带 Node.js 和前端资源，目标电脑无需安装 Node、npm、Docker 或数据库。演示账号 `admin` / `1234`，数据仍保存在浏览器本地；不包含原电脑浏览器数据。制作脚本与运行约定见 [免安装包说明](deploy/portable/README.md)，本机实测见 [交付验证](docs/verification/2026-10-20_Windows免安装包.md)。

React 演示前端在仓库根目录执行（Windows PowerShell 使用 `npm.cmd`）：

```powershell
cd .\web
npm.cmd ci
npm.cmd run dev
```

打开 [React 演示前端](http://127.0.0.1:4180/)。运行 `npm.cmd test` 执行已有前端测试，运行 `npm.cmd run build` 执行 TypeScript 检查及生产构建。演示账号和存储隔离说明见 [web/README.md](web/README.md)。Docker 演示使用 [docker/DEMO-README.md](docker/DEMO-README.md)；完整业务栈部署见 [docker/README.md](docker/README.md)。

原型可以直接启动。在仓库根目录执行：

```powershell
cd .\慧眼智检-原生原型
node server.cjs
```

打开 [本机原型](http://127.0.0.1:4174/)。演示账号 `admin` / `1234`；密码仅作不少于四位字符的本地校验。无需 npm 安装或构建。端口占用时使用 `node server.cjs 4175`；不要停止其他项目服务。服务只监听本机，关闭运行进程后停止。

原型使用浏览器 localStorage 保存演示数据，设备和 MES 均为模拟；正式系统不能复用该存储、鉴权和模拟确认机制。原型测试命令与能力见其 README。本机已执行启动及登录、检测页跳转验证；本次文档审查的复核记录见第 09 份文档。

仓库已有，不再重复创建。已克隆仓库的开发者先检查当前分支与未提交修改；首次获取仓库可使用：

```powershell
git clone https://github.com/lillililiili/huiyanzhijian.git
cd huiyanzhijian
git status --short
```

## 会话与交付

每个新会话读取 [AGENTS.md](AGENTS.md) 和 [.prompt.md](.prompt.md) 指定的全局文档，使用同一 Git 基线。每个编码会话只承担一个明确工作包，源码、文档、接口与测试证据一起交付。

独立对话并不自动隔离磁盘上的文件。并行编码使用不同 Git worktree 或不同克隆目录；仅切换对话、标签页或同一目录里的分支不构成隔离。

原始 V1.0 资料中含 D/E 扩展指标等旧范围，执行时以 [项目总说明的范围校正](docs/01_项目总说明.md#范围校正) 为准。原台账 P07 是通用导入与人工录入，保留三项检测的导入设计，只排除 D/E 扩展验收。原资料保持原样，不能直接把其中 42 项任务全部视为当前批准范围。
