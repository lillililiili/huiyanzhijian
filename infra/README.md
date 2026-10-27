# 基础设施

`middleware/nginx/nginx.conf` 是现有静态前端的真实配置，已从docker迁入；数据库、缓存、消息、对象存储与可观测性其余路径只预留。启动编排统一在根docker，不在各目录另起默认服务。
