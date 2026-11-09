# BC02 双测径合并条码部署

2026-11-04已部署4181/4192，镜像huiyan-web:bc02-20261104、huiyan-backend:bc02-20261104，均healthy。没有数据库迁移；模拟器、后台、时序和边缘未重启。原镜像为rep07前端及rep04后端，保留用于回滚。

现行compose链和环境文件路径保存在runtime/bc02/deploy-plan.json。后续部署必须保留b1＋ts01及现行覆盖配置，不能仅运行旧b1文件。重建、重启仅指定服务，不执行down或删除卷。

在工程根PowerShell执行（使用现存镜像）：
```powershell
$bc02Plan = Get-Content runtime/bc02/deploy-plan.json -Raw | ConvertFrom-Json
$bc02BackendArgs = @($bc02Plan.backend.args)
docker @bc02BackendArgs up -d --no-deps --no-build --pull never backend
$bc02WebArgs = @($bc02Plan.web.args)
docker @bc02WebArgs up -d --no-deps --no-build --pull never web
```

API仍使用原鉴权和任务表；task-labels列表按物理采集分组，新增related_tasks。先更新后端再更新前端。回滚需使用原镜像替换BC02覆盖文件中的image，沿同一配置链启动对应服务，不涉及数据回滚。

实际浏览器已验证2任务变1张、护套行定位同码、PNG和ZIP下载；全部119任务行哈希部署前后一致。详见临时文件夹/项目开发学习/2026-11-04_BC02_双测径合并条码_root.md。待用户验收，未冻结；没有本轮真机扫码或采集验收。
