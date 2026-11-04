# HWREADY01 源码发布范围

分支：`codex/hw-readiness-20261102`。基于 GitHub `docs/project-definition` 的 `cd9d7466d2c85971cf12ddd8eb0f1d1c07fa3fd2` 建立独立克隆；原目录不切分支、不提交、不重置。只推送 GitHub，不推送原配置中的 Gitee 地址。

本轮纳入当前外层 apps、adapters、contracts、docker、infra、services、tests、tools、Go 边缘、工程指南及内层正式 Markdown 文档。`source-snapshot-20261102.json` 记录同步文件的原始 SHA256 / 字节数及 Git 规范化换行后的 SHA256，不包含它自身、Git 元数据和继承的旧原型目录。

远程分支继承的 `web`、原生原型、deploy 和项目资料为历史归档，不是当前运行系统。业务入口是 apps/web；平台是 apps/platform；现场程序是边缘设备/edge-app。apps/platform-java 等历史方案不代表已批准切换技术栈。

排除依赖、编译产物、运行配置、令牌、数据库、备份、个人截图及本地客户参考原件。本地验收截图和审查原始输出仍在临时文件夹，HTML 已包含用于评审的摘要。发布扫描发现未启用 Java 方案 application.yml 含数据库密码默认值，已移除默认值，要求通过 DB_PASSWORD 环境变量提供；没有修改运行账号或部署。

当前源码包含其他会话先前开发成果，部分源码与部署状态不同。本轮只执行报告所列 14 项定向测试和有界只读查询，不能把源码快照视为全部功能重新验收或可直接生产上线。共享服务未重建；部署前必须核对迁移漂移、时序配置和目标工作包。

后续从该分支检出时，正式设计的唯一更新入口为 `huiyanzhijian/docs`，工程使用说明为 `docs`。设备原件的本地绝对路径仅用于项目现场参考，不应改成公开下载地址。
