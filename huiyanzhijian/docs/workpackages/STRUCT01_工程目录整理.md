# STRUCT01 工程目录整理

日期：2026-10-21。类型B：目录重构。对应开发清单2.4，附带已授权管理后台与基础设施路径预留；2.5内部业务拆分不在本批。

## 范围与基线

- 当前工作区：`C:/Users/qiyue/Desktop/kaifa/huiyanzhijian`，用户明确要求在当前项目续开发。
- 内层文档Git：`docs/project-definition`，起始SHA `da956002eb58d75e2df67daad6766bb8b6c239ee`，起始工作区干净。
- 外层前端无Git基线，保存201份源文件SHA256；不将文档SHA称为前端代码版本。
- 允许路径：web到apps/web、docker配置引用、infra、管理后台/服务等预留README、根入口、正式目录说明及相关台账。
- 禁止变更：现有业务行为、UI样式与资源内容、生产数据、原始资料和.git；不安装框架或中间件。
- 接口与数据库：无运行接口变更，无DDL；后续管理后台复用M00公开契约，模块表归属不变。

## 当前完成情况

| 内容 | 开发状态 | 验证状态 |
|---|---|---|
| 现有web迁入apps/web | 已整理，待验收 | 通过，见实测结果 |
| Nginx配置归入infra，更新Docker路径 | 已整理，待验收 | 通过，见实测结果 |
| 管理后台、平台、数据库、中间件、服务目录 | 已预留 | 只有说明，不可作业务提测 |
| 文档声明及入口更新 | 已编写 | 目录与相对链接检查 |
| Git统一纳管、历史资料统一归档 | 未执行 | 保留原位与历史 |
| 业务文件内部拆分2.5 | 未执行 | 独立后续任务 |

## 验收方法

1. 比较旧新源文件清单，README及图标测试相对路径以外文件摘要一致，配置纯移动摘要一致。
2. 新路径运行原npm test与build，记录原有告警和失败差异。
3. Compose配置解析及现有基础镜像构建，隔离容器验证资源和healthz，避免替换用户已有服务。
4. 从新路径启动预览，在真实浏览器执行登录、页面跳转和代表性弹窗；回读结果。
5. 核对管理后台与服务路径有职责及未实现声明，既有P25/P26/P27继续保留。

证据目录：`临时文件夹/工程目录整理_STRUCT01/`。本次不自动签认业务验收或冻结，验收人及日期由指定人员填写。

## 实测结果

### 1 文件与依赖核对：通过

201份源文件基线中199份内容摘要一致；README为路径说明更新，src/ui/components.test.ts仅将原型图标素材的相对路径增加一层../。首次迁移后测试发现ENOENT，保留失败日志after-test.log，修正后完整重跑通过。Nginx配置纯移动，内容摘要一致；依赖清单、锁文件、业务源码、CSS和图片内容未变。证据：source-comparison.json、web-before-sha256.json和backup/。

### 2 自动化与构建：通过

- 在apps/web运行npm test：39项领域测试、5项组件测试、17个Vitest文件85项测试全部通过（共129项）；见after-test-final.log。
- npm run build退出0；CSS为index-DvxSZ05S.css、JS为index-30QdnkCn.js，与迁移前产物文件名一致。原有大于500kB打包告警仍在，本次未作内部代码拆分；见after-build.log。
- docker compose -f docker/compose.yaml config --quiet通过，Compose服务和端口不变。

### 3 本地Docker：通过

本地node:22-bookworm与nginx:1.27-alpine已存在，没有执行docker pull。以docker build --pull=false -f docker/Dockerfile -t huiyan-web:struct01-check .构建成功；见docker-build.log。隔离容器huiyan-struct01-check使用127.0.0.1:4191，仅作验证，/healthz及根页面返回200，CSS和JS资源均返回200；见docker-http.log。验证结束停止并移除本次容器，保留测试镜像；已有huiyan-local-web-1及4181服务未替换。

### 4 真实浏览器：限定范围通过

在4191隔离站点执行admin演示登录进入工作台；展开系统管理，确认既有用户角色、操作审计、系统设置入口存在；进入用户列表，打开新增演示用户弹窗并取消，列表仍4名；进入审计页查询“登录系统”，查询结果从7条缩小至2条。未创建用户，未重置原4181站点数据。证据：browser-audit-query.txt及browser-audit-query.png。

这是迁移后的代表性交互回归，不是27页完整UI验收、真实账号系统、API或HW验证。管理后台、数据库、中间件及微服务均只预留。

### 5 文档及剩余范围

根README、协作入口、历史前端计划路径提示、正式01/03/11/12/13文档与模块台账已同步。每个预留职责目录有README。工程目录整理待用户验收，未签认业务冻结；Git统一纳管、历史资料去重及2.5业务文件拆分仍未执行。内层Git保持原分支和历史，本次未提交或推送。

