# 慧眼智检本地 Docker 部署

本目录部署上一级 `web/` 中的 React 演示前端。Node 构建静态资源，Nginx 提供页面。使用现有 Hash 路由，无正式 API、数据库、设备或 MES 连接。

## 启动

在本目录执行 PowerShell 命令：

```powershell
docker compose config --quiet
docker compose up -d --build --pull never
docker compose ps
```

访问 http://127.0.0.1:4181/ 。演示账号 `admin`、`quality`、`operator`、`viewer`，密码任意不少于四位字符。

基础镜像为 `node:22-bookworm` 和 `nginx:1.27-alpine`。当前机器已有这两个镜像，首次构建仍需 npm 网络访问以按 `web/package-lock.json` 安装依赖。Compose 禁止自动拉取服务镜像，构建也不主动刷新基础镜像；在缺少基础镜像的新机器上，先手动获取：

```powershell
docker pull node:22-bookworm
docker pull nginx:1.27-alpine
```

## 管理

```powershell
docker compose logs --tail 100 web
docker compose stop
docker compose start
docker compose down
```

源码更新后重新执行启动命令，构建失败时检查日志。仅需更换本地端口时：

```powershell
$env:HUIYAN_PORT = '4182'
docker compose up -d --pull never
```

服务只绑定本机回环地址，默认不向局域网公开。项目名为 `huiyan-local`，不会停止其他 Compose 项目。

## 数据与验证边界

业务数据保存在浏览器 localStorage，会话在 sessionStorage。容器没有业务数据卷，重建容器不会清除浏览器数据；清除站点存储会丢失该浏览器的演示数据。4181、4180、4174 以及 localhost 与 127.0.0.1 各自隔离，不会自动迁移旧演示记录。

`/healthz` 用于容器存活检查。HTTP 成功和镜像构建通过只证明部署与静态资源服务可用，不代表正式业务、设备或 MES 验收。
