# 慧眼智检 · 逐步实施计划

> 日期：2026-10-16\
> 范围：`E:\Chenjiyan\Projects\huiyanzhijian\web`\
> 依据：`前端实现设计.md`（落地路线）、`FRONTEND-DESIGN-PLAN.md`（页面、视觉、§11.3 门禁）、`慧眼智检-原生原型/`（视觉与交互基准）、`web/` 现有工程\
> 本文件只排实施顺序。未收到「开始执行」之前不改应用代码。

## 0. 已核对的现状

对照 `web/src` 的文件与 `package.json`，`前端实现设计.md` 的 PR 1–PR 5 已经在工程里，PR 6 及之后还没有页面。

已落地：

- Vite 6 + React 18 + TypeScript 5。ECharts 锁定 `6.0.0`。`dev` / `preview` 只绑定 `127.0.0.1:4180`，`strictPort: true`。
- 领域层在 `src/domain` 与 `src/persistence`。存储键是 `huiyan-web:v1`、`hy-web-session-v1`、`hy-web-remember-account`。领域模块不引用 React、`document`、`localStorage`。`store.test.ts` 有 18 项。
- 登录、27 路由壳、侧栏、顶栏、窄屏焦点陷阱、权限常量可用。`src/pages/registry.tsx` 仍把全部路由交给 `placeholders.tsx`，主体只渲染 `h1`。
- PR 5 的共用件已在：`viewState.ts`、`charts/trendOption.ts`、`format.ts`、`Badge` / `StatusBadge`、`PageTitle` / `Panel` / `Kpi`、`DataTable` / `Empty` / `RecordTable`、`FilterForm` / `Pagination`、`InspectionFigure`、`RecordDrawer`、`TrendChart`、`download.ts`。`main.tsx` 已在 `styles.css` 之后引入 `core.css`。`vite.config.ts` 已收集 `pages`、`charts`、`ui/**/*.test.tsx`。
- 现有用例：`test:domain` 18 项，`test:components` 5 项，`test:ui`（Vitest）42 项，分布在 `hashRoute` 5、`viewState` 2、`shell.session` 11、`shell.keyboard` 9、`shell.error` 1、`trendOption` 3、`widgets` 8、`recordDrawer` 2、`TrendChart` 1。仓库里还没有统一的 `npm test`。
- `InspectionStore` 还没有 `saveSpec`、`saveMetricDisplay`、`saveTemplate`、`saveDevice`、`saveConnections`、`saveMes`、`saveUser`、`saveSettings`。没有 `detectionWindow.ts`，没有 `csv.ts`。`styles.css` 已有 `@media print`，报告页不必再移植一整份打印规则。

PR 1–PR 5 不重做。下一阶段从 PR 6 开始。每个阶段结束停一次，等「继续」。

不改原型目录。不从原型 localStorage 导入。不增加第 28 个 hash。不引入 React Router、Redux、Zustand、Express、OpenAI、Recharts、Lucide、WebSocket，也不把图表改到 CDN。

## 1. 文档冲突与建议

下面几处 `FRONTEND-DESIGN-PLAN.md` 与 `前端实现设计.md`、现有 `web/` 不一致。技术栈以 `前端实现设计.md` 和现有工程为准，不重建计划 §3 的原生 IIFE。其余行为冲突同样以 `前端实现设计.md` 和原型测试为准。若某条不同意，在说「开始执行」时指出即可。

| 冲突 | 设计计划 | 实现设计 / 现有工程 | 建议 |
| --- | --- | --- | --- |
| 技术形态 | §3：原生 IIFE、`window.HY`、`data-action`、端口 4174 | React 组件、具名事件、端口 4180 | 按现有 `web/`。计划 §3 只作原型说明 |
| 存储键 | §7.1：`huiyan-native-prototype:v1`、`hy-session-v1`、`hy-remember-account` | `huiyan-web:v1`、`hy-web-session-v1`、`hy-web-remember-account` | 保持现有三键，不读原型键 |
| 验收命令 | §11.1 / §11.3：原型 `node --test` 的 48 项必须全绿 | `web` 用 `tsx --test` 与 Vitest | 行为按这 48 项逐条移植到 `web` 测试。不把原型测试改成 `web` 的 `npm test`，也不改原型目录 |
| 检测页操作 | §5.4 把开始 / 推进 / 完成放在检测页 | 检测页只做时间轴、米数轴和回放；回放不调用 `advanceTask`。开始、采集、结束在任务详情 | 按实现设计 |
| 指标配置 | §5.16 写名称、阈值、停用 | 只改 `metricDisplay` 的小数位和说明。阈值留在常量表和配方快照里。判定不走小数位 | 按实现设计 |
| 同步页标题 | §4.2 / §5.22 写「数据同步监控」 | `h1` 是「MES 同步监控」，面包屑和侧栏是「同步监控」 | 保持壳上已经使用的三套字符串 |
| 报警处置文案 | §5.11 写待处理 / 处理中 / 已处理 | 处置走「待复核 / 处理中 / 已处理」；通用 `pending` 仍是「待处理」；同步页 `pending` 是「待同步」 | 四套文案都保留，不合成一张表 |
| 只读拦截文案 | §5 笼统写「当前角色为只读」 | 三句：任务与规格用 `DENY_WRITE_CORE`；报警、指标、配方、模板用 `DENY_WRITE`；抽屉重试用「当前角色为只读」；设备、接入、MES、用户、设置用 `DENY_ADMIN` | 按权限矩阵，不改现有常量 |
| 设置页运行环境 | 容易写成 Vite / React | KPI 冻结为「运行环境 / 本地原型 / HTML · CSS · JavaScript」，用来对照原型截图 | 按实现设计，不改成当前技术栈名称 |
| 登录记住账号键 | §5.1 写 `hy-remember-account` | 已是 `hy-web-remember-account` | 保持现有键 |

没有未决的新产品行为。上面的建议就是执行时的默认。

## 2. 最终目录

`【已有】` 本计划不重写，只在注明「修改」时补依赖。`【新建】` 从 PR 6 起逐个出现。`【替换】` 指占位 `h1` 换成真实页面后删除对应分支。

```text
web/
  package.json                         【修改·PR13】增加 npm test，串起三套现有测试
  vite.config.ts                       【已有】已收集 pages / charts / ui 的 Vitest。不收集 node:test 文件
  index.html                           【已有】
  README.md                            【新建·PR13】只写新应用如何启动、如何对照 4174 原型
  public/assets/images/                【已有】13 张 PNG
  public/assets/icons/                 【已有】64 张。缺文件时按页面实际引用补单张，不拷 4964 张
  public/assets/vendor/                【已有】许可证
  src/main.tsx                         【已有】tokens.css → components.css → styles.css → core.css
  src/app/
    App.tsx                            【已有】无会话登录页，有会话壳
    appStore.ts                        【已有】浏览器单例。测试继续注入 store，不碰它
    hashRoute.ts                       【已有】25 个路由名、三套标题、回跳
    nav.ts                             【已有】侧栏顺序与高亮
    useAppState.ts                     【已有】订阅 hash、会话、store 根引用
    viewState.ts                       【已有】筛选与分页。只在内存，刷新丢失，不写入 huiyan-web:v1
    shell/AppShell.tsx                 【修改·逐阶段】按路由表把占位换成页面组件
    shell/LoginPage.tsx                【已有】
    shell/*.test.tsx                   【已有】窄屏与会话回归必须保持通过
  src/auth/
    session.ts                         【已有】
    permissions.ts                     【已有】canWrite、isAdmin、四句拒绝、抽屉角色徽章
    permissions.test.ts                【新建·PR13】补 viewer / quality / admin 的拒绝文案
  src/domain/
    types.ts metrics.ts judge.ts stats.ts time.ts seed.ts   【已有】
    store.ts                           【修改】PR7 saveSpec；PR10 saveMetricDisplay、saveTemplate；PR11 saveDevice、saveConnections、saveMes；PR12 saveUser、saveSettings
    store.test.ts                      【修改】每增加一个写入方法就补对应断言，原 18 项保持通过
    detectionWindow.ts                 【新建·PR6】detectionContext、detectionRows。未知 metric 先归 dg。无 DOM
    detectionWindow.test.ts            【新建·PR6】锁 30 分钟窗口、空任务不再显示 12.36
    csv.ts                             【新建·PR8】CSV 解析、BOM、引号、公式注入转义、5 MB 与 10000 行上限
    csv.test.ts                        【新建·PR8】
  src/persistence/                     【已有】不改适配器语义
  src/charts/
    trendOption.ts                     【已有】图表契约。纯函数，不挂 DOM
    trendOption.test.ts                【已有】Y 轴、markLine、阶梯线、null 断点
  src/ui/
    Icon Button HashLink Field Note Modal Drawer Toast focusTrap   【已有】
    components.css components.test.ts                               【已有】
    format.ts Badge StatusBadge PageTitle Panel Kpi                【已有】
    DataTable Empty RecordTable FilterForm Pagination              【已有】
    InspectionFigure RecordDrawer TrendChart download.ts           【已有】
  src/pages/
    placeholders.tsx                 【替换】每完成一页就从这里拿掉该路由。全部真实页落地后删除
    registry.tsx                     【修改·PR6 起】路由名到页面组件。未知路由仍是「页面不存在」
    dashboard/DashboardPage.tsx      【新建·PR6】工作台：五张 KPI、三张指标卡、运行任务、待办
    monitor/MonitorPage.tsx          【新建·PR6】设备卡、主数值、任务状态格
    detection/DetectionPage.tsx      【新建·PR6】dg / jx / by 同一组件。时间轴、米数轴、回放
    tasks/TasksPage.tsx              【新建·PR7】任务筛选、KPI、MES 汇总
    tasks/TaskPage.tsx               【新建·PR7】开始、采集、结束、执行日志、报告入口
    specs/SpecsPage.tsx              【新建·PR7】左表右详情。quality 可写
    history/HistoryPage.tsx          【新建·PR8】分钟筛选、90 条默认窗口、全量导出
    trace/TracePage.tsx              【新建·PR8】按盘号聚合。未关联指标不画空图
    import/ImportPage.tsx            【新建·PR8】预览前 100 行，保存全部通过行
    alarms/AlarmsPage.tsx            【新建·PR9】数值状态与处置状态分开
    alarms/AlarmPage.tsx             【新建·PR9】复核、时间线、原始记录不变
    analytics/AnalyticsPage.tsx      【新建·PR9】只汇总有效记录
    reports/ReportsPage.tsx          【新建·PR9】报告列表
    reports/ReportPage.tsx           【新建·PR9】只读深快照，window.print()
    metrics/MetricsPage.tsx          【新建·PR10】只改小数位和说明
    recipes/RecipesPage.tsx          【新建·PR10】派生新版本，停用旧版本
    templates/TemplatesPage.tsx      【新建·PR10】四个开关的三元缺省
    devices/DevicesPage.tsx          【新建·PR11】设备卡。管理员专属
    connections/ConnectionsPage.tsx  【新建·PR11】本地检查，不发请求
    mes/MesPage.tsx                  【新建·PR11】地址格式，无真实 token
    sync/SyncPage.tsx                【新建·PR11】重试。停用与失败场景分两句文案
    users/UsersPage.tsx              【新建·PR12】角色三套文案。无密码
    audit/AuditPage.tsx              【新建·PR12】真实审计时间，公式转义导出
    settings/SettingsPage.tsx        【新建·PR12】场景、分页、恢复初始数据
  src/styles/
    tokens.css                       【已有】navy #091f52、blue #155ab6、green #11836f、red #d34858、amber #b7781a
    styles.css                       【已有】含 @media print。不重写登录和壳
    core.css                         【已有】page-dashboard、page-detection、page-monitor、page-history、page-settings
```

每个新建文件在该阶段汇报里用 2–3 行说明职责、关键函数和被谁调用。页面 class 保持 `page page-{route}`，不另起一套视觉。侧栏 248px、顶栏 67px、卡片圆角 9px，颜色只用 `tokens.css`。

## 3. 依赖与顺序

```text
PR1 工程壳 ──┐
             ├─ PR3 基础组件 ── PR4 路由壳与登录 ──┐
PR2 领域 store ┘                                  │
                                                  ├─ PR5 图表、表格、记录抽屉   【已在仓库】
                                                  │     ├─ PR6 工作台 / 监控 / 检测     ← 下一阶段
                                                  │     │    └─ PR7 任务 / 规格
                                                  │     ├─ PR8 历史 / 追溯 / 导入
                                                  │     ├─ PR9 报警 / 统计 / 报告
                                                  │     ├─ PR10 指标 / 配方 / 模板
                                                  │     └─ PR11 设备 / 接入 / MES / 同步
                                                  │              └─ PR12 用户 / 审计 / 设置
                                                  └─ PR13 验收（依赖 PR6–PR12）
```

PR 8、PR 9、PR 10 都只依赖 PR 4 和 PR 5，可以排在 PR 7 前后。本计划仍按 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 串行，避免一次改太多。PR 12 放在 PR 11 之后，避免设置页先于设备和 MES 页出现。

筛选和分页只用已有的 `viewState`。提交筛选把该键页码置为 1。页面不得另写一套筛选状态，也不得写入 `huiyan-web:v1`。

## 4. 分阶段里程碑

每一阶段的验证都在 `web/` 目录执行。4180 被占用时只调整 Vite，不改回 4174。`npm test` 在 PR 13 加入之前，用下面三条代替：

```text
npm run test:domain
npm run test:components
npm run test:ui
npm run build
```

预期：原有 18 + 5 + 42 继续通过，本阶段新测试通过，`tsc -b && vite build` 退出码 0。领域测试仍不启动 jsdom。组件的 node:test 仍走 `tsx --tsconfig tsconfig.app.json`，不并进 Vitest。

### PR 1–PR 4 · 已完成

可在 `http://127.0.0.1:4180/` 登录，侧栏能打开 27 个逻辑地址，主体是标题。

- `#login` 为登录页。三个按钮填 `admin` / `operator` / `viewer` 和 `demo1234`。
- `#dashboard` 标题「工作台首页」，侧栏「工作台」。
- `#detection?metric=foo` 面包屑是字符串 `undefined检测`，标题仍是「金属屏蔽搭盖率检测」。
- `#mes` 标题「MES 接口配置」，面包屑「MES接口配置」。`#sync` 标题「MES 同步监控」，面包屑「同步监控」。

### PR 5 · 已完成

图表、表格、记录抽屉、筛选分页和 `core.css` 已在 `src/`。`registry.tsx` 仍渲染占位 `h1`。本计划不重写这些文件，除非后续页面必须接上注册表。

已锁住的行为：`RecordDrawer` 能看到记录号和规则快照；`mesStatus === pending` 在抽屉里是「待处理 / amber」。`trendOption` 为 `animation: false`，无效值为 `null` 且 `connectNulls: false`。`fmt` 对 `null` 和非有限数显示「—」。阈值格式化不复用 `metricFmt`。

### PR 6 · 工作台、监控、三项检测

目标：替换 `#dashboard`、`#monitor`、`#detection`。先建 `src/domain` 里尚缺的窗口模块，再写三个页面目录。

新建：

- `src/domain/detectionWindow.ts`、`detectionWindow.test.ts`
- `src/pages/dashboard/DashboardPage.tsx` 与页面测试
- `src/pages/monitor/MonitorPage.tsx` 与页面测试
- `src/pages/detection/DetectionPage.tsx` 与页面测试

修改：`registry.tsx` 只替换这三路。`placeholders.tsx` 不再负责它们。`AppShell` 若已走 `renderPage`，不改壳的导航和焦点。

完成标准。用质量管理员登录后打开：

- `#dashboard`：第一张 KPI 标签是「今日检测任务」，值是种子任务数 12，不按日期过滤。副标题含检测中与已完成数量。三张指标卡走运行任务的 30 分钟窗口。没有运行任务时才退回 `currentRecords`。页底有「当前值符合阈值不代表整盘合格」。
- `#monitor`：主数值是当前窗口最后一条的格式化值，没有记录时是「—」和「暂无数据」。不得出现把 `12.36` 当成空设备主数值。「空闲」只出现在任务状态格。
- `#detection?metric=dg` 初始是任务 `T20261009001` 的 30 条。`metric=jx` 标题为「铜丝屏蔽相邻铜丝间隙检测」，`metric=by` 为「电缆不圆度检测」。`metric=foo` 按搭盖率取数，面包屑仍是 `undefined检测`。指定了不存在的 `task` 时整页空态。
- 回放按 `settings.refreshInterval` 切片已有记录，离开页面或更换任务会清掉计时器。回放不调用 `advanceTask`。
- 新建一个尚无样本的搭盖率任务并开始后，工作台搭盖率当前值不再是 `12.36%`。显式 `task=T20261009001` 仍看原任务。
- 领域测试新增窗口用例。原 18 项仍通过。构建通过。其余路由仍是原来的 `h1`。

验证：

```text
npm run test:domain
npm run test:components
npm run test:ui
npm run build
```

浏览器：`npm run dev` 后打开 `http://127.0.0.1:4180/#dashboard`、`#monitor`、`#detection?metric=dg`、`#detection?metric=jx`、`#detection?metric=by`。控制台无报错。

### PR 7 · 任务列表、任务详情、规格档案

目标：替换 `#tasks`、`#task`、`#specs`。store 新增 `saveSpec`。

新建：`src/pages/tasks/TasksPage.tsx`、`TaskPage.tsx`、`src/pages/specs/SpecsPage.tsx` 与测试。\
修改：`store.ts`、`store.test.ts`、`registry.tsx`。

完成标准：

- `#tasks` 的 KPI「今日任务总数」也是 `tasks.length`，不和「今日检测任务」混名。MES 汇总只有「待采集 / 同步失败 / 同步中 / 已确认」。
- `#task` 无 `id` 和 `?id=` 都打开种子 `T20261009001`。坏 id 的 `h1` 仍是「检测任务详情」，空态「任务不存在」。
- `T20261009001` 执行日志顺序含 `12:50:00`、`12:55:00`、`13:00:00`、`14:06:00`、`14:07:00`、`14:30:00`。种子任务的分配时间是开始前 5 分钟；用户新建任务的分配时间就是 `createdAt`。
- 待开始可「开始检测」，检测中可「采集下一条」和「结束检测」。已完成且仍有未处置报警时链到该报警，文案「先复核异常」。设备同一时间只跑一个任务。铜带规格不得含 `jx`，铜丝规格不得含 `dg`。电压只允许 35 / 66 / 110 / 220。
- `quality` 可以保存规格。`viewer` 点击写操作得到 `DENY_WRITE_CORE`，store 再拦一次。按钮仍渲染。
- 原有测试与构建通过。

### PR 8 · 历史、盘号追溯、导入

目标：替换 `#history`、`#trace`、`#import`。本阶段不依赖任务页的内部结构。

新建：`src/domain/csv.ts`、`csv.test.ts`、`src/pages/history/HistoryPage.tsx`、`src/pages/trace/TracePage.tsx`、`src/pages/import/ImportPage.tsx` 与页面测试。\
修改：`registry.tsx`。

完成标准：

- 首次进入历史页，筛选项是 `2026-10-09T14:01` 和 `2026-10-09T14:30`。比较时结束边界补 `:59`，页面出现「共 90 条记录」，不是 87 条，也不是 198 条。
- 搭盖率 + 超限 + 盘号 `P20261009001` 导出 1 行，值 `9.2`，规则版本 `DG-V1.0`。导出是当前筛选的全部行，带 UTF-8 BOM。空结果提示「当前查询无可导出的记录」。
- `#trace` 无盘号时用 `P20261009001`。该盘只有搭盖率：1 张图，间隙和不圆度写「本盘未关联该项检测」，不画空坐标。未知盘号留在页面上，任务表为空。
- 导入大于 5 MB 或超过 10000 行被拒绝。预览表最多 100 行，保存处理全部通过行。页面先去掉错误行和 `_row` 再调用 `importRecords`。来源一律写成「人工导入补录」。记录抽屉用已有的 `RecordDrawer`。
- `csv` 测试与原领域测试通过。构建通过。

### PR 9 · 报警、统计、报告

目标：替换 `#alarms`、`#alarm`、`#analytics`、`#reports`、`#report`。打印沿用 `styles.css` 已有的 `@media print`。缺报告页专用规则时再补，不另写一套壳隐藏逻辑。

新建：五个页面与测试。\
修改：`registry.tsx`。必要时补 `styles.css` 或 `core.css` 的报告排版。

完成标准：

- 列表把「仍超限 / 已恢复」和「待复核 / 处理中 / 已处理」分开。复核调用 `updateAlarm`，不改原始记录。量测恢复不自动关闭报警。
- `#alarm` 无 id 用种子 `AL20261009001`。坏 id 或 `?id=` 的 `h1` 是「暂无报警事件」。证据区有效性是「有效数据 / 无效数据」。MES 走 `mesState`。
- 统计只汇总有效记录。导出不要求管理员。
- `#report` 无 id 打开最后一份，种子是 `RP20261009009`。坏 id 的 `h1` 是「尚无质量报告」。预览只读快照。运行中是阶段报告。未处置报警不能出最终报告。无报警时写「本报告无关联报警记录」。打印用 `window.print()`，不嵌 PDF 库。
- `viewer` 复核被拒绝。构建与原测试通过。

### PR 10 · 指标显示、配方、报告模板

目标：替换 `#metrics`、`#recipes`、`#templates`。store 新增 `saveMetricDisplay`、`saveTemplate`。`reviseRecipe` 已在 PR 2。

新建：三个页面与测试。\
修改：`store.ts`、`store.test.ts`、`registry.tsx`。

完成标准：

- 小数位只影响展示，范围 0–4。小数位为 0 时工作台搭盖率当前值显示 `12` 而不是 `12.36`。间隙三位时平均值 `1.800`。米数仍是一位。阈值文本仍是 `10.25` 这种原值。
- 配方派生新版本并停用旧版本。历史 `ruleSnapshot` 不变。操作符锁定。阈值 0–100，间隙上限也是 100，不改成 3。
- 模板四个开关的缺省按实现设计的三元式。第一次保存得到 `revision = 2`、`version = V1.1`。未勾选写成 `false`。只影响之后的 `createReport`。
- `quality` 可写，`viewer` 得到 `DENY_WRITE`。构建与原测试通过。

### PR 11 · 设备、接入、MES、同步

目标：替换 `#devices`、`#connections`、`#mes`、`#sync`。store 新增 `saveDevice`、`saveConnections`、`saveMes`。

新建：四个页面与测试。\
修改：`store.ts`、`store.test.ts`、`registry.tsx`。

完成标准：

- 三个写操作只有 `admin`。检查按钮不发网络请求，`quality` 和 `viewer` 也可以点检查。
- 已有记录的设备，检测类型只读。重复编号拒绝。
- MES 地址必须以 `http:` 或 `https:` 开头。不提供可保存的真实 token。认证文案是「模拟令牌（无真实凭据）」。
- `#sync` 的 `h1` 保持「MES 同步监控」。`mes.enabled === false` 时页面提示「MES 同步演示已停用，请先在接口配置中启用。」，不把 store 的「MES 接口未启用」显示出来。失败场景重试不确认。正常场景重试幂等，不增加记录，不改判定和报警。表格徽章走 `mesState`。
- 长 URL 可在窄容器内断行。构建与原测试通过。

### PR 12 · 用户、审计、设置

目标：替换 `#users`、`#audit`、`#settings`。store 新增 `saveUser`、`saveSettings`。`setScenario` 与 `reset` 已在 PR 2。

新建：三个页面与测试。\
修改：`store.ts`、`store.test.ts`、`registry.tsx`。完成后删除 `placeholders.tsx`。

完成标准：

- 用户页标题用 `roles`：`viewer` 是「只读观察员」。账户抽屉仍是「只读查看者」。种子显示名「访客」不混进这两处。
- 不采集密码。最后一个启用管理员不能被降级或停用。不能停用当前用户。编辑自己时同步会话里的姓名和角色。停用用户不能登录。
- 审计时间去掉毫秒。导出当前筛选，并做公式转义。
- 设置页第一张 KPI 固定为「运行环境 / 本地原型 / HTML · CSS · JavaScript」。存储徽章区分「浏览器本地」和「内存模式」。坏档不删键。四个场景与 `setScenario` 一致，离线只作用于搭盖率设备。恢复初始数据必须勾选确认，然后 `reset()` 并回到 `#dashboard`。场景和恢复只有管理员可做。
- `settings.pageSize` 写入后，各列表分页跟着变。构建与原测试通过。此时 24 个业务路由都不再走占位。

### PR 13 · 对照验收

目标：把还没落位的集成条款补完，并按 §11.3 做一次自查。不改原型，不新增页面。

新建或修改：`permissions.test.ts`、各页测试里尚未覆盖的坏 id、转义和停用用户、`web/README.md`、`package.json` 的 `test` 脚本。

`npm test` 定义为依次执行 `test:domain`、`test:components`、`test:ui`。

完成标准：

- 27 个逻辑路由都能打开，未知 hash 仍是「页面不存在」而不是白屏。
- 用户输入作为文本渲染，不使用 `dangerouslySetInnerHTML`。
- 停用用户登录失败，文案仍是「账号不存在或已停用，请选择演示身份。」
- `viewer` 与非管理员的拒绝文案和权限矩阵一致，store 层也拒绝。
- `npm test` 与 `npm run build` 通过。
- README 写明：在 `web/` 执行 `npm run dev`，打开 `http://127.0.0.1:4180/`；原型仍用 `127.0.0.1:4174`；两边存储不互通。

手工对照（不做服务器部署）按原型 README 的 7 步走一遍：登录、看工作台三项指标、打开一条记录、处理一条报警、生成或预览报告、导出 CSV、恢复初始数据。浏览器控制台无报错。结果写进阶段汇报，不另做部署。

视口抽查：1920、1440、1366，以及 390 宽的登录、工作台、搭盖率、任务、历史、报告、设置。窄屏沿用 PR 4 已有焦点测试，不重做导航。

## 5. §11.3 门禁怎么落到本计划

| 门禁 | 由哪一阶段证明 |
| --- | --- |
| 27 页可达，无空白、无 404 | PR 6–PR 12 逐页替换，PR 13 汇总 |
| 判定、任务、报警、报告快照与原型一致 | PR 2 已锁领域规则；PR 7、PR 9、PR 10 锁页面出口 |
| 桌面三尺寸与窄屏关键页 | 沿用原型 CSS 与 PR 4 窄屏测试。PR 13 在 1920、1440、1366 和 390 宽抽查登录、工作台、搭盖率、任务、历史、报告、设置 |
| 自动化全绿 | `web` 的 `npm test` 覆盖原型 48 项里的行为。原型目录里的 48 项保持原样，不作为 `web` 的命令 |
| CSV 与打印 | PR 8 导出与导入，PR 9 使用已有打印样式。另存 PDF 交给浏览器 |
| 只读角色写操作被拦截 | 各写页面阶段加一条，PR 13 收口 |
| 持久化与恢复初始数据 | PR 2 已测 load / reset。PR 12 把恢复按钮接到 `reset()` 并回到工作台 |

业务规则在页面里必须继续成立，不在某一页里放宽：边界值算符合；无效数据以 `null` 保存、不进入统计；判定使用记录产生时的规则快照；报告为深快照、生成后不重写；配方、指标显示、模板修改只影响之后的数据；报警「量测恢复 ≠ 人工关闭」；设备同一时间只执行一个任务；`viewer` 全局只读，写操作被 UI 与 store 同时拦截。

## 6. 执行约定

- 一次只做上表中的一个 PR。先建该阶段目录，再逐文件写完整内容。
- 阶段结束汇报：改了哪些文件、每个新文件的职责、打开哪个地址看什么、跑了哪些命令和结果、下一阶段是什么。等「继续」。
- 不改 `慧眼智检-原生原型/`。不提交 git，除非另行要求。
- 页面数据只来自 `createStore` 的种子和本地 `huiyan-web:v1`。不写 `fetch`，不预留空的 `Authorization` 头。
- 现有登录、回跳、窄屏、`undefined检测` 面包屑、MES 标题空格、领域 18 项测试，在每个阶段结束后都要仍然通过。
- 图表继续用已有 `TrendChart` / `trendOption`。按钮、模态、抽屉、提示、表单继续用 `src/ui`。不在页面里再造一套。
