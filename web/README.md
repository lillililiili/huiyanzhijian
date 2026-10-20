# 慧眼智检 · Web

本目录是「慧眼智检」的 React 前端。视觉和交互对照上一级的 `慧眼智检-原生原型/`。这里不修改原型，也不读取原型的本地存储。

## 启动

在本目录执行：

```powershell
npm install
npm run dev
```

浏览器打开 [http://127.0.0.1:4180/](http://127.0.0.1:4180/)。开发服务只监听 `127.0.0.1:4180`。

构建后用同一地址预览：

```powershell
npm run build
npm run preview
```

## 对照原型

原型目录是 `慧眼智检-原生原型/`。在该目录执行 `node server.cjs`，打开 [http://127.0.0.1:4174/](http://127.0.0.1:4174/)。

两边存储不互通。

| 应用 | 数据 | 会话 | 记住账号 |
| --- | --- | --- | --- |
| 本目录 `4180` | `huiyan-web:v1` | `hy-web-session-v1` | `hy-web-remember-account` |
| 原型 `4174` | `huiyan-native-prototype:v1` | `hy-session-v1` | `hy-remember-account` |

`localhost` 和 `127.0.0.1` 也是不同的存储来源。对照时请使用 `127.0.0.1`。

演示账号是 `admin`、`quality`、`operator`、`viewer`。密码任意填写不少于 4 位的字符。登录不向服务器发送账号。

## 测试

```powershell
npm test
```

`npm test` 依次执行 `test:domain`、`test:components`、`test:ui`。
