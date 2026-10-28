import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = resolve('runtime/chrome-task-activity-temp');
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9222',
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--window-size=1600,1050',
  'about:blank'
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await sleep(1500);
  try {
    const listRes = await fetch('http://127.0.0.1:9222/json');
    const tabs = await listRes.json();
    const wsUrl = tabs[0].webSocketDebuggerUrl;
    const ws = new WebSocket(wsUrl);

    let id = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };

    const send = (method, params = {}) => new Promise((resolve) => {
      const reqId = id++;
      pending.set(reqId, resolve);
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });

    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('Navigating to http://127.0.0.1:4181/#login ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:4181/#login' });
    await sleep(2000);

    console.log('Logging in with account=admin, password=123456 ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const user = document.querySelector('input[name=account]');
          const pass = document.querySelector('input[name=password]');
          if (user && pass) {
            user.value = 'admin';
            user.dispatchEvent(new Event('input', { bubbles: true }));
            pass.value = '123456';
            pass.dispatchEvent(new Event('input', { bubbles: true }));
            const btn = document.querySelector('button[type=submit]');
            if (btn) btn.click();
          }
        })()
      `
    });

    await sleep(2500);

    console.log('Navigating to http://127.0.0.1:4181/#tasks ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:4181/#tasks' });
    await sleep(3500);

    // Capture screenshot
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    const outDir = resolve('临时文件夹/B3R4_通信与采样状态优化');
    mkdirSync(outDir, { recursive: true });
    const shotPath = resolve(outDir, 'tasks-activity-optimized.png');
    writeFileSync(shotPath, Buffer.from(shot.result.data, 'base64'));
    console.log(`Screenshot saved to ${shotPath}`);

    const brainDir = 'C:\\Users\\qiyue\\.gemini\\antigravity\\brain\\95bd9f17-ef2d-4a62-b1bb-fa02b3e9c22a';
    writeFileSync(resolve(brainDir, 'tasks-activity-optimized.png'), Buffer.from(shot.result.data, 'base64'));

    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(err => {
  console.error(err);
  chrome.kill();
  process.exit(1);
});
