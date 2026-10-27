# 平台数据库预留

PostgreSQL是既有方案候选，未安装、未建库，版本待确定。config放无密钥参数模板，init放实例级初始化，backup放备份恢复脚本；业务DDL统一归apps/platform/db/migrations。数据卷不提交源码。
