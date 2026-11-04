# HT03 双项同步采集部署

2026-11-03；已部署、自测通过待用户验收，未冻结。

## 1 已部署范围

- 4181：huiyan-web:ht03-20261103，镜像52a42ca1dd70；运行标签huiyan-web:local。
- 4192：huiyan-backend:ht03-20261103，镜像18249060fd86；运行标签huiyan-backend:b1。
- PG追加016c_paired_sheath_tasks、016d_sheath_report_pending；017未执行。
- 其他34个已有容器的ID、镜像、启动时间均未改变。边缘、模拟器和原始报文不变。

## 2 执行顺序与重建

工作树：_worktrees/HT03-paired-tasks。应用基线d777fd9，不以内层文档Git版本代表应用版本。

1. 校验共享源码哈希，备份PG并在隔离库恢复验证。当前备份runtime/ht03/ht03-deploy-before.dump。
2. 完整迁移预检，迁移账号执行至016d；运行账号仍无DDL权限。禁止无截止执行017。
3. 编译platform/web，在工作树根使用HT03.backend.Dockerfile和HT03.web.Dockerfile构建。两文件以已保存本地基础镜像增量覆盖，无需pull。
4. 使用迁移连接执行dist/db/backfill-sheath-tasks.js；须设置HT03_BACKUP_CONFIRMED=yes及MIGRATION_DATABASE_URL。脚本每100条提交，可恢复、幂等；不输出连接凭据。
5. 更新backend时必须同时使用b1.compose.yaml与ts01.compose.yaml，保留时序配置；再更新web。

```powershell
docker compose --env-file runtime/b1/compose.env -f docker/b1.compose.yaml -f docker/ts01.compose.yaml up -d --no-deps --no-build --pull never backend
docker compose -f docker/compose.yaml up -d --no-deps --no-build --pull never web
```

运行标签须先指向本轮已验证镜像。增量镜像的基础标签为huiyan-backend:ht03-base-20261103、huiyan-web:ht03-base-20261103。

## 3 数据验收：通过

追加22个护套任务、42367条派生结果；原35任务、43279条采样及数值/判定/投影哈希不变。采样与接收微秒时间、源记录关联差异0，双任务状态/盘号/关联版本差异0。隔离重复回填0任务/0记录。两个服务healthy；4181实际浏览器读取独立护套任务2500条结果。

## 4 回退与边界

不得仅切回旧后端：旧版本不识别成对任务与派生统计，可能错误处理设备占用。优先前向修复；整库恢复须另行核实新增数据并制定受控恢复方案。已保存备份不代表允许覆盖当前数据库。

护套报告新增NOT_EVALUATED结果；消费者必须正确显示未判定，不能映射为合格。历史已发布报告不重写。护套正式质量限值、真机和MES尚未验收。
