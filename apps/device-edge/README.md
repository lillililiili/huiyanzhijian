# 设备端预留与边缘桌面容器（huiyan-edge）

M09共久采集、批准方法计算、本地存储和补传。只读设备协议，不写PLC控制。尚无驱动或运行程序；SDK、操作系统与本地数据库待确认。

---

## 边缘设备 Ubuntu 桌面版容器部署（Webtop Ubuntu MATE）

为与当前系统容器组（`huiyan-local`、`huiyan-admin`、`huiyan-b1`、`huiyan-simulator`）保持统一命名规范，边缘设备桌面容器归属容器组 **`huiyan-edge`**，容器名为 **`huiyan-edge-ubuntu-desktop-1`**。

### 1. 使用 Docker Compose 一键启动（推荐，自动在 Docker Desktop 中归入 `huiyan-edge` 容器组）

在项目根目录执行：

```powershell
docker compose -f apps/device-edge/compose.yaml up -d
```

### 2. 或使用 `docker run` 直接启动（带 `huiyan-edge` 容器组标签）

```powershell
docker run -d `
  --name huiyan-edge-ubuntu-desktop-1 `
  --label com.docker.compose.project=huiyan-edge `
  --label com.docker.compose.service=ubuntu-desktop `
  -p 3000:3000 `
  -e PUID=1000 `
  -e PGID=1000 `
  -e TZ=Asia/Shanghai `
  --shm-size="1gb" `
  --add-host host.docker.internal:host-gateway `
  -v huiyan-edge-desktop-data:/config `
  --restart unless-stopped `
  lscr.io/linuxserver/webtop:ubuntu-mate
```

### 3. 连接方式

- **浏览器访问**：打开 Edge / Chrome 访问 `http://localhost:3000`
- **默认账号 / 密码**：`abc` / `abc`
- **容器内部访问中心平台后端 API**：`http://host.docker.internal:4192`
