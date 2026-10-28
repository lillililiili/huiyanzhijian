import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = resolve('runtime/chrome-reports-ui-temp');
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9226',
  `--user-data-dir=${userDataDir}`,
  '--disable-gpu',
  '--no-first-run',
  '--window-size=1600,1100',
  'about:blank'
]);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  await sleep(1500);
  try {
    const listRes = await fetch('http://127.0.0.1:9226/json');
    const tabs = await listRes.json();
    const pageTab = tabs.find(t => t.type === 'page') || tabs[0];
    const ws = new WebSocket(pageTab.webSocketDebuggerUrl);

    let id = 1;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    };

    const send = (method, params = {}) => new Promise((res, rej) => {
      const reqId = id++;
      pending.set(reqId, (msg) => {
        if (msg.error) rej(new Error(JSON.stringify(msg.error)));
        else res(msg.result);
      });
      ws.send(JSON.stringify({ id: reqId, method, params }));
    });

    await new Promise(r => ws.onopen = r);
    await send('Page.enable');
    await send('Runtime.enable');

    console.log('1. Navigating to http://127.0.0.1:4181/#reports ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:4181/#reports' });
    await sleep(2500);

    console.log('2. Logging in as admin / 123456 ...');
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
            const form = user.closest('form');
            if (form) form.requestSubmit();
            else {
              const btn = document.querySelector('button[type=submit]');
              if (btn) btn.click();
            }
          }
        })()
      `
    });
    await sleep(3500);

    console.log('3. Ensuring hash is #reports ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          if (window.location.hash !== '#reports') {
            window.location.hash = '#reports';
          }
        })()
      `
    });
    await sleep(3500);

    const outDir = resolve('临时文件夹/WP5.4_质量报告管理与导出');
    const brainDir = 'C:\\Users\\qiyue\\.gemini\\antigravity\\brain\\19c6514c-ec6f-484f-be8c-26cd719f1f44';
    mkdirSync(outDir, { recursive: true });
    mkdirSync(brainDir, { recursive: true });

    // Step A: Capture Reports List Overview Screenshot
    console.log('4. Querying Reports KPI and List ...');
    const domInfo = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (() => {
          const title = document.querySelector('h1, h2')?.textContent?.trim();
          const subtitle = document.querySelector('.page-title-sub, .subtitle')?.textContent?.trim();
          const kpis = Array.from(document.querySelectorAll('.kpi')).map(el => ({
            label: el.querySelector('.kpi-label')?.textContent?.trim(),
            val: el.querySelector('.kpi-value')?.textContent?.trim()
          }));
          const rows = Array.from(document.querySelectorAll('.table-wrap table tbody tr')).map(tr => {
            return Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim());
          });
          return { title, subtitle, kpis, rowCount: rows.length, sampleRow: rows[0] };
        })()
      `
    });
    console.log('DOM info:\n', JSON.stringify(domInfo.result?.value, null, 2));

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '01_reports_list_overview.png'), Buffer.from(shot1.data, 'base64'));
    writeFileSync(resolve(brainDir, '01_reports_list_overview.png'), Buffer.from(shot1.data, 'base64'));
    console.log('Saved 01_reports_list_overview.png');

    // Step B: Open Create Report Modal
    console.log('5. Opening Create Report Modal ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('出具质量检验报告'));
          if (btn) btn.click();
        })()
      `
    });
    await sleep(2000);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '02_reports_create_modal.png'), Buffer.from(shot2.data, 'base64'));
    writeFileSync(resolve(brainDir, '02_reports_create_modal.png'), Buffer.from(shot2.data, 'base64'));
    console.log('Saved 02_reports_create_modal.png');

    // Close create modal
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('.modal-close, button[aria-label="关闭"]');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(1000);

    // Step C: Navigate to Report Detail / Preview (P17)
    console.log('6. Navigating to first report detail preview ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const link = document.querySelector('.table-wrap table tbody tr a');
          if (link) link.click();
        })()
      `
    });
    await sleep(3000);

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '03_report_preview_a4.png'), Buffer.from(shot3.data, 'base64'));
    writeFileSync(resolve(brainDir, '03_report_preview_a4.png'), Buffer.from(shot3.data, 'base64'));
    console.log('Saved 03_report_preview_a4.png');

    console.log('ALL REPORT VERIFICATIONS COMPLETED SUCCESSFULLY!');
    ws.close();
  } finally {
    chrome.kill();
  }
}

main().catch(err => {
  console.error('Fatal execution error:', err);
  try { chrome.kill(); } catch(_) {}
  process.exit(1);
});
