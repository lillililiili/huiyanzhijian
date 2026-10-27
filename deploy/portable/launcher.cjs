const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { APP_ID, HEALTH_PATH, STOP_PATH, readConfig, instanceId } = require("./server.cjs");

function probe(port, pathname = HEALTH_PATH, options = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => { if (!settled) { settled = true; resolve(result); } };
    const req = http.request({
      host: "127.0.0.1", port, path: pathname, method: options.method || "GET",
      headers: options.headers || {}, timeout: 800, agent: false
    }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
        if (body.length > 16384) { finish({ kind: "other" }); req.destroy(); }
      });
      res.on("end", () => {
        try { finish({ kind: "response", status: res.statusCode, data: JSON.parse(body) }); }
        catch { finish({ kind: "other", status: res.statusCode }); }
      });
      res.on("error", () => finish({ kind: "other" }));
    });
    req.on("timeout", () => { finish({ kind: "other" }); req.destroy(); });
    req.on("error", error => finish({ kind: error.code === "ECONNREFUSED" ? "absent" : "other" }));
    req.end();
  });
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const isOurs = (result, id) => result.kind === "response" && result.status === 200 &&
  result.data?.app === APP_ID && result.data?.instance === id;
const conflict = port => new Error(`端口 ${port} 已被其他程序或另一份平台占用。请先关闭对应程序，或修改“平台配置.json”中的 port；不会停止其他程序。`);

function openBrowser(url) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(process.env.SystemRoot || "C:\\Windows", "explorer.exe"), [url], {
      detached: true, windowsHide: true, stdio: "ignore"
    });
    child.once("spawn", () => { child.unref(); resolve(); });
    child.once("error", reject);
  });
}

/** Start only the bundled server; repeat launches reuse this package's instance. */
async function start(root, { noOpen = false } = {}) {
  const { port } = readConfig(root);
  const id = instanceId(root);
  for (const file of ["site/index.html", "app/server.cjs", "build-info.json"]) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`缺少 ${file}。请完整解压整个运行包。`);
  }
  const current = await probe(port);
  if (!isOurs(current, id) && current.kind !== "absent") throw conflict(port);
  if (!isOurs(current, id)) {
    const logDir = path.join(root, "logs");
    fs.mkdirSync(logDir, { recursive: true });
    const log = fs.openSync(path.join(logDir, "server.log"), "a");
    let child;
    let spawnError;
    try {
      child = spawn(process.execPath, [path.join(root, "app", "server.cjs")], {
        cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log],
        env: { ...process.env, NODE_OPTIONS: "", NODE_PATH: "" }
      });
      child.on("error", error => { spawnError = error; });
      child.unref();
    } finally { fs.closeSync(log); }
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (spawnError) throw spawnError;
      await delay(100);
      const status = await probe(port);
      if (isOurs(status, id)) {
        // The server publishes the shutdown token only after successfully binding.
        try {
          const state = JSON.parse(fs.readFileSync(path.join(root, "data", "runtime.json"), "utf8"));
          if (state.pid === status.data.pid && state.instance === id && state.running) { ready = true; break; }
        } catch { /* Wait for the ready state write. */ }
      } else if (status.kind !== "absent") { throw conflict(port); }
    }
    if (!ready) throw new Error("服务未能启动，请查看 logs/server.log。");
  }
  const url = `http://127.0.0.1:${port}/`;
  console.log(`平台已启动：${url}`);
  if (!noOpen) {
    try { await openBrowser(url); }
    catch { console.log(`未能自动打开浏览器，请手动访问：${url}`); }
  }
  return url;
}

/** Stop uses a local token and verified instance identity, never a process-name kill. */
async function stop(root) {
  const id = instanceId(root);
  let state;
  try { state = JSON.parse(fs.readFileSync(path.join(root, "data", "runtime.json"), "utf8")); }
  catch { console.log("本目录尚无已启动的服务。"); return; }
  if (state.instance !== id) throw new Error("运行记录来自其他目录，请先在原目录停止平台。");
  const current = await probe(state.port);
  if (current.kind === "absent") { console.log("平台已停止。"); return; }
  if (!isOurs(current, id)) throw conflict(state.port);
  const result = await probe(state.port, STOP_PATH, { method: "POST", headers: { Authorization: `Bearer ${state.token}` } });
  if (result.status !== 200) throw new Error("停止请求未被本实例接受，请查看 logs/server.log。");
  for (let attempt = 0; attempt < 30; attempt++) {
    await delay(100);
    if ((await probe(state.port)).kind === "absent") { console.log("平台已停止。"); return; }
  }
  throw new Error("服务仍在结束请求，请稍后重试停止。");
}

module.exports = { probe, start, stop };
if (require.main === module) {
  const root = path.resolve(__dirname, "..");
  const action = process.argv[2] || "start";
  const command = action === "start" ? start(root, { noOpen: process.argv.includes("--no-open") })
    : action === "stop" ? stop(root) : Promise.reject(new Error("仅支持 start 或 stop。"));
  command.catch(error => { console.error(error.message); process.exitCode = 1; });
}
