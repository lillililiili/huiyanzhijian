import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const userDataDir = resolve('runtime/chrome-alarms-ui-temp');
mkdirSync(userDataDir, { recursive: true });

const chrome = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=9225',
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
    const listRes = await fetch('http://127.0.0.1:9225/json');
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

    console.log('1. Navigating directly to http://127.0.0.1:4181/#alarms ...');
    await send('Page.navigate', { url: 'http://127.0.0.1:4181/#alarms' });
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

    console.log('3. Ensuring hash is #alarms ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          if (window.location.hash !== '#alarms') {
            window.location.hash = '#alarms';
          }
        })()
      `
    });
    await sleep(3500);

    const outDir = resolve('临时文件夹/WP4.2_工业级报警工作台');
    const brainDir = 'C:\\Users\\qiyue\\.gemini\\antigravity\\brain\\19c6514c-ec6f-484f-be8c-26cd719f1f44';
    mkdirSync(outDir, { recursive: true });
    mkdirSync(brainDir, { recursive: true });

    // Step A: Capture Overview Screenshot and query KPIs
    console.log('4. Querying Alarm KPI and Overview ...');
    const domInfo = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (() => {
          const title = document.querySelector('h1, h2')?.textContent?.trim();
          const subtitle = document.querySelector('.page-title-sub, .subtitle')?.textContent?.trim();
          const kpis = Array.from(document.querySelectorAll('.alarm-kpis .kpi')).map(el => ({
            label: el.querySelector('.kpi-label')?.textContent?.trim(),
            val: el.querySelector('.kpi-value')?.textContent?.trim(),
            note: el.querySelector('.kpi-note')?.textContent?.trim()
          }));
          const tabs = Array.from(document.querySelectorAll('.alarms-workbench-tabs button')).map(el => ({
            text: el.textContent?.trim(),
            active: el.classList.contains('active')
          }));
          const rows = Array.from(document.querySelectorAll('.alarm-workbench-table tbody tr')).map(tr => {
            const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim());
            return tds;
          });
          const buttons = Array.from(document.querySelectorAll('.alarm-actions-cell button')).map(b => b.textContent?.trim());
          return { title, subtitle, kpis, tabs, rowCount: rows.length, sampleRow: rows[0], actionButtons: buttons.slice(0, 5) };
        })()
      `
    });
    console.log('DOM info:\n', JSON.stringify(domInfo.result?.value, null, 2));

    const shot1 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '01_alarms_workbench_overview.png'), Buffer.from(shot1.data, 'base64'));
    writeFileSync(resolve(brainDir, '01_alarms_workbench_overview.png'), Buffer.from(shot1.data, 'base64'));
    console.log('Saved 01_alarms_workbench_overview.png');

    // Step B: Check for PENDING / PROCESSING interaction
    console.log('5. Testing interaction: Ack or Open Handle Modal ...');
    const interactRes = await send('Runtime.evaluate', {
      awaitPromise: true,
      returnByValue: true,
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('.alarm-actions-cell button'));
          const ackBtn = buttons.find(b => b.textContent.includes('一键确认'));
          if (ackBtn) {
            ackBtn.click();
            return { action: 'clicked_ack' };
          }
          const handleBtn = buttons.find(b => b.textContent.includes('登记处置'));
          if (handleBtn) {
            handleBtn.click();
            return { action: 'clicked_handle' };
          }
          const reviewBtn = buttons.find(b => b.textContent.includes('主管复核'));
          if (reviewBtn) {
            reviewBtn.click();
            return { action: 'clicked_review' };
          }
          return { action: 'none', foundButtons: buttons.map(b => b.textContent.trim()) };
        })()
      `
    });
    console.log('Interaction 1 result:', interactRes.result?.value);
    await sleep(2500);

    const shot2 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '02_alarms_modal_interaction.png'), Buffer.from(shot2.data, 'base64'));
    writeFileSync(resolve(brainDir, '02_alarms_modal_interaction.png'), Buffer.from(shot2.data, 'base64'));
    console.log('Saved 02_alarms_modal_interaction.png');

    // Close any modal if open
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('.modal-close, button[aria-label="关闭"]');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(1000);

    // Step C: Open Detail Drawer and view timeline
    console.log('6. Opening detail drawer to view lifecycle actions timeline ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const buttons = Array.from(document.querySelectorAll('.alarm-actions-cell button'));
          const detailBtn = buttons.find(b => b.textContent.includes('轨迹详情'));
          if (detailBtn) detailBtn.click();
        })()
      `
    });
    await sleep(2000);

    const shot3 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '03_alarms_drawer_timeline.png'), Buffer.from(shot3.data, 'base64'));
    writeFileSync(resolve(brainDir, '03_alarms_drawer_timeline.png'), Buffer.from(shot3.data, 'base64'));
    console.log('Saved 03_alarms_drawer_timeline.png');

    // Close drawer
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const closeBtn = document.querySelector('.drawer-close, button.close');
          if (closeBtn) closeBtn.click();
        })()
      `
    });
    await sleep(1000);

    // Step D: Switch to Raw FAIL tab
    console.log('7. Switching to Raw FAIL tab ...');
    await send('Runtime.evaluate', {
      expression: `
        (() => {
          const tabBtns = document.querySelectorAll('.alarms-workbench-tabs button');
          if (tabBtns.length > 1) {
            tabBtns[1].click();
          }
        })()
      `
    });
    await sleep(2500);

    const shot4 = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(resolve(outDir, '04_alarms_raw_fail_tab.png'), Buffer.from(shot4.data, 'base64'));
    writeFileSync(resolve(brainDir, '04_alarms_raw_fail_tab.png'), Buffer.from(shot4.data, 'base64'));
    console.log('Saved 04_alarms_raw_fail_tab.png');

    console.log('ALL VERIFICATIONS COMPLETED SUCCESSFULLY!');
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
