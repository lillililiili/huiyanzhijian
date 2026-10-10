/* Integration checks against the actual buildless browser modules.
 * Run: node tests/integration.test.js
 * No browser, network, dependencies, or repository mutations are required.
 * DOM rendering is captured as HTML; pixel/layout checks are performed separately.
 */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
let passed = 0;

function environment() {
  const storage = new Map(), session = new Map(), listeners = {}, intervals = [], notices = [];
  const app = { innerHTML: '' };
  const context = {
    console, Date, Math, JSON, Number, String, Array, Object, Map, Set,
    URL, URLSearchParams, Promise, Blob,
    FormData: class {
      constructor(form) { this.values = form.values || {}; }
      get(key) { return this.values[key] ?? null; }
      has(key) { return Object.hasOwn(this.values, key); }
      entries() { return Object.entries(this.values)[Symbol.iterator](); }
      [Symbol.iterator]() { return this.entries(); }
    },
    location: { hash: '#login' },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    sessionStorage: { getItem: key => session.get(key) ?? null, setItem: (key, value) => session.set(key, value), removeItem: key => session.delete(key) },
    setTimeout: () => 1, clearTimeout() {},
    setInterval: (fn, delay) => { intervals.push({ fn, delay }); return intervals.length; }, clearInterval() {},
    addEventListener() {}, scrollTo() {}, print() {}, requestAnimationFrame() {},
    document: {
      title: '', activeElement: null, baseURI: 'http://127.0.0.1:8765/index.html',
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      getElementById: id => id === 'app' ? app : null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener: (name, fn) => { listeners[name] = fn; }
    }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['data.js', 'ui.js', 'pages-core.js', 'pages-management.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context, { filename: file });
  }
  const H = context.HY, S = H.Store, U = H.UI;
  let modal, drawer, download;
  U.modal = (title, body, submit, label) => { modal = { title, body, submit, label }; };
  U.drawer = (title, body) => { drawer = { title, body }; };
  U.closeModal = () => {};
  U.closeDrawer = () => {};
  U.toast = text => notices.push(text);
  U.downloadFile = (name, content, type) => { download = { name, content: String(content), type }; };
  function login(role = 'admin') {
    const user = S.state.users.find(u => u.role === role && u.enabled !== false);
    H.currentUser = { id: user.id, name: user.name, username: user.username, role: user.role };
    return H.currentUser;
  }
  function render(route) {
    context.location.hash = '#' + route;
    H.render();
    assert.ok(!app.innerHTML.includes('页面加载失败'), route + ' must not render an error screen');
    return app.innerHTML;
  }
  function submit(values) {
    assert.ok(modal && typeof modal.submit === 'function', 'action must open a working modal');
    return modal.submit({
      get: key => Object.hasOwn(values, key) ? values[key] : null,
      has: key => Object.hasOwn(values, key),
      entries: () => Object.entries(values)[Symbol.iterator]()
    });
  }
  return { context, H, S, U, app, storage, session, intervals, notices, listeners, render, login, submit,
    get modal() { return modal; }, get drawer() { return drawer; }, get download() { return download; },
    clearModal() { modal = null; }
  };
}

function test(name, run) {
  try { run(environment()); passed++; process.stdout.write('PASS ' + name + '\n'); }
  catch (error) { process.stderr.write('FAIL ' + name + '\n' + error.stack + '\n'); process.exitCode = 1; }
}
const element = (data = {}) => ({ dataset: data });
const ids = { task: 'T20261009001', alarm: 'AL20261009001', reel: 'P20261009001' };
const pages = [
  'login', 'dashboard', 'monitor', 'detection?metric=dg', 'detection?metric=jx', 'detection?metric=by',
  'tasks', 'task?id=' + ids.task, 'specs', 'history', 'trace?reel=' + ids.reel, 'import',
  'alarms', 'alarm?id=' + ids.alarm, 'analytics', 'reports', 'report?id=RP20261009001',
  'metrics', 'recipes', 'templates', 'devices', 'connections', 'mes', 'sync', 'users', 'audit', 'settings'
];

test('all 27 logical pages render and every visible action is registered', e => {
  assert.equal(pages.length, 27);
  const actions = new Set(), routes = new Set(Object.keys(e.H.Pages).concat('login'));
  pages.forEach(route => {
    if (route !== 'login') e.login();
    const html = e.render(route);
    assert.ok(html.length > 1000, route + ' has substantive content');
    assert.ok(!html.includes('undefined') && !html.includes('NaN'), route + ' has no missing-value tokens');
    for (const match of html.matchAll(/data-action="([^"]+)"/g)) {
      actions.add(match[1]);
      assert.equal(typeof e.H.Actions[match[1]], 'function', route + ' has an unregistered action: ' + match[1]);
    }
    for (const match of html.matchAll(/href="#([^"?]+)(?:[^\"]*)"/g)) assert.ok(routes.has(match[1]), 'unknown linked route: ' + match[1]);
  });
  e.S.setScenario('mes-failure');
  for (const match of e.render('sync').matchAll(/data-action="([^"]+)"/g)) assert.equal(typeof e.H.Actions[match[1]], 'function', 'failure-state action is registered');
  assert.ok(actions.size >= 30, 'test must cover a meaningful action surface');
});

test('empty combinations render useful empty states on all query pages', e => {
  e.login();
  const cases = [
    ['monitor', { line: '__missing__' }], ['tasks', { query: '__missing__' }], ['specs', { query: '__missing__' }],
    ['history', { query: '__missing__' }], ['alarms', { keyword: '__missing__' }], ['reports', { keyword: '__missing__' }],
    ['devices', { keyword: '__missing__' }], ['sync', { keyword: '__missing__' }], ['users', { keyword: '__missing__' }],
    ['audit', { keyword: '__missing__' }], ['analytics', { from: '2099-01-01', to: '2099-01-02' }]
  ];
  cases.forEach(([route, filters]) => {
    e.H.filters[route] = filters;
    const html = e.render(route);
    assert.match(html, /没有|未找到|暂无|无匹配/, route + ' must explain why the table is empty');
    assert.ok(!html.includes('NaN') && !html.includes('Infinity'), route + ' empty statistics must be safe');
    e.H.Actions['filter-reset'](element({ id: route }));
    assert.equal(Object.keys(e.H.filters[route]).length, 0, route + ' reset must clear query state');
  });
});

test('record drawer follows the exact record, rule, image, alarm, and sync status', e => {
  e.login();
  for (const alarm of e.S.state.alarms) {
    const record = e.S.record(alarm.recordId);
    e.H.showRecord(record.id);
    assert.ok(e.drawer.body.includes(record.id));
    assert.ok(e.drawer.body.includes(record.taskId));
    assert.ok(e.drawer.body.includes(record.reelId));
    assert.ok(e.drawer.body.includes(record.image));
    assert.ok(e.drawer.body.includes(record.ruleSnapshot.id));
    assert.ok(e.drawer.body.includes(alarm.id));
    assert.ok(e.drawer.body.includes(Number(record.value).toFixed(2)));
    assert.ok(e.drawer.body.includes('已确认'));
  }
  const record = e.S.currentRecords('jx')[0];
  const image = e.U.inspection(record);
  record.aux.localGaps.forEach(gap => assert.ok(image.includes(Number(gap).toFixed(2)), 'image labels must use this record, not fixed sample values'));
});

test('history CSV exports the full filtered result, not only the current page', e => {
  e.login(); e.render('history');
  e.H.Actions['core-history-export']();
  assert.equal(e.download.content.split('\r\n').length - 1, 90);
  e.H.filters.history = { metric: 'dg', judgement: 'fail', query: ids.reel };
  e.render('history'); e.H.Actions['core-history-export']();
  assert.equal(e.download.content.split('\r\n').length - 1, 1);
  assert.ok(e.download.content.includes('9.2'));
  assert.ok(e.download.content.startsWith('\uFEFF'), 'CSV must include a UTF-8 BOM for local spreadsheet programs');
  const result = e.download.content;
  e.H.filters.history = { query: '__missing__' }; e.render('history'); e.H.Actions['core-history-export']();
  assert.equal(e.download.content, result, 'empty query must not silently export unrelated data');
});

test('alarm review changes only handling state and retains original measurement evidence', e => {
  e.login(); e.render('alarms');
  const alarm = e.S.alarm(ids.alarm), record = e.S.record(alarm.recordId), before = JSON.stringify(record);
  assert.equal(alarm.active, false); assert.equal(alarm.status, 'pending');
  e.H.Actions['alarm-review'](element({ id: alarm.id }));
  e.submit({ status: 'resolved', actor: '复核人员', note: '检查工艺调整与后续连续记录，完成复核。' });
  assert.equal(alarm.status, 'resolved');
  assert.equal(JSON.stringify(record), before);
  assert.equal(alarm.history.at(-1).actor, '复核人员');
  assert.ok(e.render('alarm?id=' + alarm.id).includes('已处理'));
});

test('recipe revision affects future tasks and preserves historical rules', e => {
  e.login(); e.render('recipes');
  const previous = e.S.recipe('DG-V1.0'), existing = JSON.stringify(e.S.task(ids.task).ruleSnapshot);
  e.H.Actions['recipe-edit'](element({ id: previous.id }));
  e.submit({ baseId: previous.id, name: '新版搭盖率规则', threshold: '11', note: '演示工艺变更' });
  const next = e.S.state.recipes.find(r => r.metric === 'dg' && r.enabled);
  assert.equal(next.threshold, 11); assert.equal(previous.enabled, false);
  assert.equal(next.description, '演示工艺变更');
  assert.equal(JSON.stringify(e.S.task(ids.task).ruleSnapshot), existing);
  assert.ok(e.render('recipes').includes('新版搭盖率规则'));
});

test('report template settings apply to new immutable report snapshots and CSV', e => {
  e.login(); e.render('templates');
  const oldReport = JSON.stringify(e.S.state.reports[0]);
  e.H.Actions['template-edit']();
  e.submit({ title: '测试质量报告', signatory: '复核：测试人员', footer: '测试页脚', includeAlarms: 'on' });
  const task = e.S.state.tasks.find(t => t.status === 'completed');
  const report = e.S.createReport(task.id);
  assert.equal(report.snapshot.template.title, '测试质量报告');
  assert.equal(report.snapshot.template.includeTrend, false);
  assert.equal(JSON.stringify(e.S.state.reports[0]), oldReport);
  const originalArea = report.snapshot.spec.area;
  e.S.spec(task.specId).area = 999;
  e.render('report?id=' + report.id);
  const preview = e.H.Pages.report();
  assert.ok(preview.includes('测试质量报告') && preview.includes('测试页脚'));
  assert.ok(preview.includes('×' + originalArea)); assert.ok(!preview.includes('×999'));
  assert.ok(!preview.includes('chart-host'), 'disabled trend must disappear from the report');
  assert.ok(preview.includes('本报告无关联报警记录'), 'report must use a report-specific empty alarm explanation');
  assert.ok(!preview.includes('调整查询条件'), 'a report must not show a generic query or create-record empty state');
  assert.ok(preview.includes('font-size:22px;white-space:normal'), 'report KPIs need compact wrapping values for print and narrow desktops');
  e.H.Actions['report-data-export'](element({ id: report.id }));
  assert.equal(e.download.content.split('\r\n').length - 1, report.snapshot.records.length);
});

test('display precision, page size, and replay interval use saved configuration', e => {
  e.login(); e.render('metrics');
  e.H.Actions['metric-edit'](element({ metric: 'dg' }));
  e.submit({ decimals: '3', description: '显示三位小数，不改变原始判定' });
  assert.equal(e.U.metricFmt(12.36, 'dg'), '12.360');
  assert.ok(e.render('metrics').includes('12.360'));
  assert.ok(e.render('alarms').includes('9.200'), 'alarm record values must use configured precision');
  assert.ok(e.render('alarm?id=' + ids.alarm).includes('9.200'), 'alarm detail must use configured precision');
  assert.ok(e.render('sync').includes('12.360'), 'sync table values must use configured precision');
  const avg = e.S.stats(e.S.state.records.filter(r => r.metric === 'dg')).avg;
  assert.ok(e.render('analytics').includes(Number(avg).toFixed(3)), 'statistics must use configured metric precision');
  e.H.Actions['settings-edit']();
  e.submit({ platformName: '慧眼智检', organization: '测试机构', refreshInterval: '10', pageSize: '20' });
  assert.equal(e.U.paginate(Array.from({ length: 25 }, (_, i) => i), 'test', 8).items.length, 20);
  assert.ok(e.render('dashboard').includes('测试机构'));
  e.render('detection?metric=dg');
  e.H.Actions['core-replay'](element({ metric: 'dg' }));
  assert.equal(e.intervals.at(-1).delay, 10000);
});

test('device, connection, MES, and user settings persist and influence pages', e => {
  e.login(); e.render('devices');
  e.H.Actions['device-add']();
  e.submit({ id: 'HY-DG-02', name: '二号搭盖率检测设备', metric: 'dg', line: '铜带二号工位', calibration: '2026-10-09', status: 'offline' });
  assert.equal(e.S.device('HY-DG-02').status, 'offline');
  assert.ok(e.render('devices').includes('二号搭盖率检测设备'));
  e.H.Actions['connection-edit']();
  e.submit({ protocol: 'MQTT', endpoint: 'mqtt://127.0.0.1:1883/measurements', interval: '2000', heartbeat: '30', autoReconnect: 'on' });
  assert.equal(e.S.state.connections.protocol, 'MQTT');
  assert.ok(e.render('connections').includes('2000'));
  e.H.Actions['mes-edit']();
  e.submit({ endpoint: 'https://mes.example.local/demo', mode: 'batch', timeout: '12000', retries: '5' });
  assert.equal(e.S.state.mes.enabled, false); assert.equal(e.S.state.mes.mode, 'batch');
  e.H.Actions['user-add']();
  e.submit({ name: '测试观察员', account: 'qa_viewer', role: 'viewer', enabled: 'true' });
  assert.equal(e.S.state.users.find(u => u.username === 'qa_viewer').role, 'viewer');
  assert.ok(e.render('users').includes('qa_viewer'));
  const stored = JSON.parse(e.storage.get('huiyan-native-prototype:v1'));
  assert.equal(stored.connections.protocol, 'MQTT');
  assert.equal(stored.mes.enabled, false);
  assert.ok(stored.users.some(u => u.username === 'qa_viewer'));
  const error = { textContent: '' }, form = { id: 'login-form', values: { account: 'qa_viewer', password: 'demo1234' }, reportValidity: () => true, querySelector: () => error };
  e.H.currentUser = null;
  e.listeners.submit({ target: form, preventDefault() {} });
  assert.equal(error.textContent, '', 'a user created by the management form must be accepted by the real login handler');
  assert.equal(e.H.currentUser.username, 'qa_viewer');
  assert.equal(e.H.currentUser.role, 'viewer');
  e.S.state.users.find(u => u.username === 'qa_viewer').enabled = false;
  e.H.currentUser = null;
  e.listeners.submit({ target: form, preventDefault() {} });
  assert.equal(e.H.currentUser, null);
  assert.ok(error.textContent.includes('停用'), 'disabled users must be blocked by the login handler');
});

test('sync failure and retry preserve quality judgement and deduplicate confirmations', e => {
  e.login(); e.S.setScenario('mes-failure'); e.render('sync');
  const failed = e.S.state.records.filter(r => r.mesStatus === 'failed');
  assert.ok(failed.length);
  const original = new Map(failed.map(r => [r.id, { value: r.value, judgement: r.judgement, rule: JSON.stringify(r.ruleSnapshot) }]));
  e.H.filters.sync = { status: 'failed' };
  e.H.Actions['sync-retry-filtered']();
  assert.ok(failed.every(r => r.mesStatus === 'failed'), 'failure scenario must not claim success');
  e.S.setScenario('normal'); e.H.Actions['sync-retry-filtered']();
  assert.ok(failed.every(r => r.mesStatus === 'confirmed'));
  const total = e.S.state.records.length;
  e.H.Actions['sync-retry'](element({ id: failed[0].id }));
  assert.equal(e.S.state.records.length, total);
  failed.forEach(r => { assert.equal(r.value, original.get(r.id).value); assert.equal(r.judgement, original.get(r.id).judgement); assert.equal(JSON.stringify(r.ruleSnapshot), original.get(r.id).rule); });
});

test('viewer and quality users cannot access restricted mutations', e => {
  e.login('viewer'); e.render('users');
  for (const action of ['user-add', 'device-add', 'template-edit', 'settings-edit', 'connection-edit', 'mes-edit']) {
    e.clearModal(); e.H.Actions[action](); assert.equal(e.modal, null, action + ' must not open for a viewer');
  }
  assert.throws(() => e.H.Actions['core-task-advance'](element({ id: ids.task })), /只读/);
  e.login('quality');
  for (const action of ['user-add', 'device-add', 'settings-edit', 'connection-edit', 'mes-edit']) {
    e.clearModal(); e.H.Actions[action](); assert.equal(e.modal, null, action + ' requires an admin');
  }
  e.H.Actions['alarm-review'](element({ id: ids.alarm })); assert.ok(e.modal, 'quality role may review alarms');
});

test('user supplied names and notes are escaped before HTML rendering', e => {
  e.login();
  const payload = '<img src=x onerror=alert(1)>';
  e.S.state.devices[0].name = payload;
  e.S.state.users[0].name = payload;
  e.S.state.alarms[0].history.push({ time: '2026-10-09 14:30:00', actor: payload, note: payload, status: 'processing' });
  for (const route of ['devices', 'users', 'alarm?id=' + ids.alarm]) {
    const html = e.render(route);
    assert.ok(!html.includes(payload), route + ' must never embed raw input as HTML');
    assert.ok(html.includes('&lt;img'), route + ' must display escaped text');
  }
});

test('invalid detail IDs are reported instead of displaying unrelated records', e => {
  e.login();
  for (const route of ['alarm?id=__missing__', 'report?id=__missing__', 'task?id=__missing__']) {
    const html = e.render(route);
    assert.match(html, /不存在|暂无|不可用|没有找到/, route + ' must explain unavailable detail');
  }
});

process.stdout.write('\n' + passed + ' integration tests passed.\n');
if (process.exitCode) process.exit(process.exitCode);
