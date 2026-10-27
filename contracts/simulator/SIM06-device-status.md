# SIM06 设备状态展示契约

2026-10-27，开发2。仅扩展模拟器目录响应与页面展示；不新增平台接口、数据库表或设备启停命令。

## 数据与状态
- GET /api/catalog 的 devices 项新增 platform_assignment：null 或 {task_id, spool_id, metric_code}，由既有授权 GET /devices/:id/assignment 读取；沿用设备凭据及 SIMULATED 限制。
- enabled 来自主平台设备资料，显示“已启用/已停用”；此页不修改该配置。
- 仅本地 job.status 为 STARTING/RUNNING/STOPPING 计作当前执行。历史完成记录的 control=RUNNING/PAUSED 不计作仍在运行。
- 当前执行优先显示准备中、送料中、采集中、暂停、停止、补传或重放；已停用但已有执行仍展示执行并提示，不掩盖运行。
- 无当前执行但平台存在 assignment：任务占用；无占用且启用：待命；无占用且停用：未运行。
- 本地状态过期/请求失败显示状态未同步。平台查询失败时启用状态不再沿用为确认状态，页头显示平台同步异常；本地已知执行可继续显示并注明平台未同步。
- 本地按既有轮询间隔刷新（默认1秒），平台目录约5秒刷新；属于轮询观察，不是物理实时状态。目录与分配接口不是同一事务快照。

## 导航
查看送料定位当前设备的具体执行；诊断执行定位设置高级记录。查看占用任务使用可配置主平台地址与准确 task_id。停止送料不自动结束 BOUND 平台任务，卡片继续显示任务占用。

## 部署
只更新 tools/simulator 容器4196。先确认无活动采样并备份队列卷；使用现有 compose 构建，然后 up --no-deps --no-build --pull never --wait simulator。4181/4182/4192及数据库容器不重建，不删除卷。回滚镜像标签 huiyan-simulator:before-sim06-20261027；本次无迁移，无需回滚业务数据。
