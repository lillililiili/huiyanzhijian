const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const APP_ID = "huiyan-portable";
const HEALTH_PATH = "/__huiyan/health";
const STOP_PATH = "/__huiyan/stop";
const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff", ".woff2": "font/woff2"
};

function readConfig(root) {
  const config = JSON.parse(fs.readFileSync(path.join(root, "平台配置.json"), "utf8").replace(/^\uFEFF/, ""));
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) {
    throw new Error("平台配置.json 的 port 必须是 1024 到 65535 之间的整数。");
  }
  return config;
}

function instanceId(root) {
  return crypto.createHash("sha256").update(fs.realpathSync.native(root)).digest("hex");
}

function reply(res, status, body, headers = {}, head = false) {
  const data = Buffer.from(body);
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8", "Content-Length": data.length,
    "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", ...headers
  });
  res.end(head ? undefined : data);
}

/** Only site files are public. Control endpoints are local and instance scoped. */
function createStaticServer({ siteDir, port, id, token, version = "unknown" }) {
  // Use the same native canonical form as promises.realpath on Windows (8.3 paths).
  const root = fs.realpathSync.native(siteDir);
  const server = http.createServer(async (req, res) => {
    const head = req.method === "HEAD";
    if (req.headers.host !== `127.0.0.1:${port}`) return reply(res, 403, "Forbidden host", {}, head);
    let pathname;
    try {
      pathname = decodeURIComponent((req.url || "/").split("?")[0]);
    } catch {
      return reply(res, 400, "Invalid URL", {}, head);
    }
    if (pathname === HEALTH_PATH && req.method === "GET") {
      return reply(res, 200, JSON.stringify({ app: APP_ID, instance: id, version, pid: process.pid, port }), {
        "Content-Type": "application/json; charset=utf-8"
      });
    }
    if (pathname === STOP_PATH) {
      if (req.method !== "POST" || req.headers.authorization !== `Bearer ${token}` ||
          (req.headers.origin && req.headers.origin !== `http://127.0.0.1:${port}`)) {
        return reply(res, 403, "Forbidden", {}, head);
      }
      reply(res, 200, "Stopping");
      setImmediate(() => server.close());
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) return reply(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
    if (!pathname.startsWith("/") || /[\0\\:]/.test(pathname)) return reply(res, 400, "Invalid path", {}, head);
    const target = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(root + path.sep)) return reply(res, 403, "Forbidden", {}, head);
    try {
      const real = await fs.promises.realpath(target);
      if (!real.startsWith(root + path.sep)) return reply(res, 403, "Forbidden", {}, head);
      const stat = await fs.promises.stat(real);
      if (!stat.isFile()) return reply(res, 404, "Not found", {}, head);
      const body = head ? null : await fs.promises.readFile(real);
      res.writeHead(200, {
        "Content-Type": MIME[path.extname(real).toLowerCase()] || "application/octet-stream",
        "Content-Length": stat.size, "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff"
      });
      res.end(body);
    } catch (error) {
      reply(res, ["ENOENT", "ENOTDIR"].includes(error.code) ? 404 : 500, "File unavailable", {}, head);
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 1000;
  return server;
}

function run(root = path.resolve(__dirname, "..")) {
  const { port } = readConfig(root);
  const id = instanceId(root);
  const token = crypto.randomBytes(32).toString("hex");
  const build = JSON.parse(fs.readFileSync(path.join(root, "build-info.json"), "utf8"));
  const statePath = path.join(root, "data", "runtime.json");
  const server = createStaticServer({ siteDir: path.join(root, "site"), port, id, token, version: build.source_commit });
  server.once("error", error => {
    console.error(`${new Date().toISOString()} ${error.code || "ERROR"}: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    try {
      fs.mkdirSync(path.dirname(statePath), { recursive: true });
      fs.writeFileSync(statePath, JSON.stringify({ instance: id, token, port, pid: process.pid, running: true }) + "\n");
      console.log(`${new Date().toISOString()} Ready http://127.0.0.1:${port}/`);
    } catch (error) {
      console.error(`Cannot save runtime state: ${error.message}`);
      server.close();
      process.exitCode = 1;
    }
  });
  server.once("close", () => {
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (state.token === token) fs.writeFileSync(statePath, JSON.stringify({ ...state, running: false }) + "\n");
    } catch { /* Missing state must not prevent stopping our own listener. */ }
  });
  process.on("SIGINT", () => server.close());
  process.on("SIGTERM", () => server.close());
  return server;
}

module.exports = { APP_ID, HEALTH_PATH, STOP_PATH, readConfig, instanceId, createStaticServer, run };
if (require.main === module) {
  try { run(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
