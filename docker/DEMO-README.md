# localStorage 演示前端 Docker

此部署只运行仓库 `web/` 下的演示前端，不连接平台 API 或数据库，演示记录保存在浏览器本地。

在仓库根目录运行：

```powershell
docker compose -f docker/demo.compose.yaml up -d --build --pull never
```

打开 http://127.0.0.1:4181/ 。演示登录账号见 [web/README.md](../web/README.md)。要停止演示容器：

```powershell
docker compose -f docker/demo.compose.yaml stop
```

实际业务前端/API/数据库部署请使用 [Docker 部署说明](README.md)。
