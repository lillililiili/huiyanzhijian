const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { createStaticServer, readConfig } = require("./server.cjs");
const { start, stop, probe } = require("./launcher.cjs");
const exec = promisify(execFile);

async function unusedPort() {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function fixture(port) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "慧眼 便携测试-"));
  fs.mkdirSync(path.join(root, "app"));
  fs.mkdirSync(path.join(root, "site"));
  fs.writeFileSync(path.join(root, "平台配置.json"), JSON.stringify({ port }));
  fs.writeFileSync(path.join(root, "build-info.json"), JSON.stringify({ source_commit: "test-build" }));
  fs.writeFileSync(path.join(root, "site", "index.html"), "<!doctype html><title>慧眼智检</title>");
  fs.writeFileSync(path.join(root, "site", "app.js"), "console.log('offline');");
  fs.writeFileSync(path.join(root, "private.txt"), "must-not-be-served");
  for (const file of ["launcher.cjs", "server.cjs"]) fs.copyFileSync(path.join(__dirname, file), path.join(root, "app", file));
  return root;
}

function request(port, target, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: target, ...options }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves offline files and HEAD; blocks file escape, private folders, bad host and writes", async () => {
  const port = await unusedPort();
  const root = fixture(port);
  const server = createStaticServer({ siteDir: path.join(root, "site"), port, id: "test", token: "control-token" });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  try {
    const index = await request(port, "/");
    assert.equal(index.status, 200);
    assert.match(index.body, /慧眼智检/);
    assert.match((await request(port, "/app.js")).headers["content-type"], /javascript/);
    const head = await request(port, "/", { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(Number(head.headers["content-length"]), Buffer.byteLength(index.body));
    for (const target of ["/app/launcher.cjs", "/data/runtime.json", "/private.txt", "/missing.js"]) {
      assert.equal((await request(port, target)).status, 404, target);
    }
    assert.equal((await request(port, "/..%2fprivate.txt")).status, 403);
    assert.equal((await request(port, "/..%5cprivate.txt")).status, 400);
    assert.equal((await request(port, "/%ZZ")).status, 400);
    assert.equal((await request(port, "/", { headers: { Host: `malicious.example:${port}` } })).status, 403);
    assert.equal((await request(port, "/", { method: "POST" })).status, 405);
    assert.equal((await request(port, "/__huiyan/stop", { method: "POST" })).status, 403);
    assert.equal((await request(port, "/__huiyan/stop", {
      method: "POST", headers: { Authorization: "Bearer control-token", Origin: "https://other.example" }
    })).status, 403);
    assert.equal((await request(port, "/")).status, 200);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("launch in Chinese/space path with minimal PATH; repeat launch reuses process; stop is idempotent", async () => {
  const port = await unusedPort();
  const root = fixture(port);
  const launcher = path.join(root, "app", "launcher.cjs");
  const env = { ...process.env, PATH: path.join(process.env.SystemRoot || "C:\\Windows", "System32"), NODE_OPTIONS: "", NODE_PATH: "" };
  try {
    const first = await exec(process.execPath, [launcher, "start", "--no-open"], { env });
    assert.match(first.stdout, /平台已启动/);
    const original = await probe(port);
    assert.equal(original.data.version, "test-build");
    const second = await exec(process.execPath, [launcher, "start", "--no-open"], { env });
    assert.match(second.stdout, /平台已启动/);
    assert.equal((await probe(port)).data.pid, original.data.pid);
    assert.equal((await request(port, "/")).status, 200);
    await stop(root);
    assert.equal((await probe(port)).kind, "absent");
    await stop(root);
  } finally { await stop(root); }
});

test("occupied port refuses startup and does not terminate or replace the other server", async () => {
  const port = await unusedPort();
  const root = fixture(port);
  let response = "other application";
  const other = http.createServer((req, res) => res.end(response));
  await new Promise(resolve => other.listen(port, "127.0.0.1", resolve));
  try {
    await assert.rejects(start(root, { noOpen: true }), /已被其他程序/);
    assert.equal((await request(port, "/")).body, "other application");
    response = "null";
    await assert.rejects(start(root, { noOpen: true }), /已被其他程序/);
    assert.equal((await request(port, "/")).body, "null");
    assert.equal(fs.existsSync(path.join(root, "data", "runtime.json")), false);
  } finally { await new Promise(resolve => other.close(resolve)); }
});

test("a second copy cannot start over or stop the first copy", async () => {
  const port = await unusedPort();
  const first = fixture(port);
  const second = fixture(port);
  try {
    await start(first, { noOpen: true });
    const pid = (await probe(port)).data.pid;
    await assert.rejects(start(second, { noOpen: true }), /另一份平台/);
    fs.mkdirSync(path.join(second, "data"));
    fs.copyFileSync(path.join(first, "data", "runtime.json"), path.join(second, "data", "runtime.json"));
    await assert.rejects(stop(second), /其他目录/);
    assert.equal((await probe(port)).data.pid, pid);
  } finally { await stop(first); }
});

test("invalid configuration and incomplete extraction fail before creating a service", async () => {
  const root = fixture(80);
  assert.throws(() => readConfig(root), /1024/);
  await assert.rejects(start(root, { noOpen: true }), /1024/);
  const port = await unusedPort();
  fs.writeFileSync(path.join(root, "平台配置.json"), "\uFEFF" + JSON.stringify({ port }));
  assert.equal(readConfig(root).port, port);
  fs.renameSync(path.join(root, "site", "index.html"), path.join(root, "site", "index.saved"));
  await assert.rejects(start(root, { noOpen: true }), /完整解压/);
  assert.equal((await probe(port)).kind, "absent");
});
