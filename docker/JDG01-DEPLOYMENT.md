# JDG01 本地部署记录

2026-11-03，4181/4192已部署healthy，自测通过待验收。

镜像huiyan-web:jdg01-20261103、huiyan-backend:jdg01-20261103。后端以huiyan-backend:par01-20261103为基，仅覆盖8个修改模块编译产物及019迁移，保留监督/worker配置；web以huiyan-web:ui01-20261103为基替换静态构建。

实际compose参数见runtime/jdg01/deploy-plan.json：后端保留b1、ts01及PAR01覆盖配置，再叠加runtime/jdg01/backend.override.yaml；前端保留原compose及UI01覆盖配置，再叠加runtime/jdg01/web.override.yaml。不可丢失TS/PAR01配置。仅重建web/backend，无其他服务重启。

019_task_sheath_recipe.sql已执行，仅M02 discovery_profile追加sheath_recipe_version_id及外键，无历史回填；迁移前备份runtime/jdg01/before-019.dump。原87,646采样、57任务、4配方、4报告及规则摘要均保留。

回滚：保留全部原compose/env配置，将两项镜像改回上述PAR01/UI01镜像，仅重建对应服务；新增019字段可以保留，禁止为代码回滚删除业务库或恢复覆盖新增数据。回滚后旧版不支持新增护套规则流程，需要明确功能降级，不改历史数据。部署前重新检查其他会话是否已有更新，不机械覆盖新镜像。
