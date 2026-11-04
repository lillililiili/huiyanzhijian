# 开发与验证

根目录不是统一 npm workspace，不能用根 `npm test` 判断业务工程。分别执行：

```powershell
npm --prefix apps/web ci
npm --prefix apps/web run build
npm --prefix apps/web test
npm --prefix apps/admin-web ci
npm --prefix apps/admin-web run build
npm --prefix apps/platform ci
npm --prefix apps/platform run build
npm --prefix tools/simulator ci
npm --prefix tools/simulator run build
```

后端测试要区分纯测试与集成测试。`tests/backend/integration.test.ts` 会创建隔离数据库、启动测试 API 并生成业务测试数据；运行前检查其端口、凭据、时序配置和清理逻辑。不要把完整测试套件指向共享业务库。

本轮只执行以下纯定向测试（14 项通过）：

```powershell
Set-Location apps/platform
.\node_modules\.bin\tsx.cmd --test ../../tests/backend/canonical.test.ts ../../tests/backend/time01.test.ts ../../tests/backend/sc01-sheath.test.ts ../../tests/backend/bc01.test.ts
```

Go 边缘测试在装有 Go 且支持所需编译环境的独立目录执行 `go test ./...`，竞争检测另运行 `go test -race ./...`。本轮 Windows 未安装可用 Go，不能复用历史 race 结果作为当前证据。

## 协作与版本

读取根 AGENTS.md、.prompt.md 和目标工作包，保留其他会话修改。业务代码在外层 `apps`、正式文档在 `huiyanzhijian/docs`。当前本地历史 Git 位于内层 `huiyanzhijian/.git`，其 HEAD 不代表外层应用版本。

HWREADY01 使用独立克隆 `_worktrees/HWREADY01-publish` 汇总当前可发布源码与说明，分支 `codex/hw-readiness-20261102`。发布快照会记录文件 SHA256；不切换原分支、不推送 Gitee、不强推 main、不声称全部同步源码已经部署。

只提交源码、必要运行资源、锁文件、契约和说明。排除 runtime、凭据、依赖、构建包、原始客户资料、备份、个人截图及本地证据。新增工作包标记自测待验收，不自动冻结。


2026-11-02 DB01：启动权限及迁移漂移已修复并部署4192；迁移须显式截止016a，未部署017保持不动。见[部署说明](../docker/DB01-DEPLOYMENT.md)。STAB01隔离恢复首轮通过，不代表真机或长期容量验收。
