/* Core page regressions: task-bound detection, playback, and trace semantics. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
let passed = 0;

function environment() {
  let charts = [], timer;
  const context = {
    console, URL, URLSearchParams,
    setTimeout: () => 1, clearTimeout: () => {},
    setInterval: fn => { timer = fn; return 1; }, clearInterval: () => {},
    localStorage: { getItem: () => null, setItem: () => {} },
    addEventListener: () => {},
    document: { baseURI: 'http://localhost:8765/', querySelector: () => null }
  };
  context.window = context;
  vm.createContext(context);
  for (const file of ['data.js', 'ui.js', 'pages-core.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', file), 'utf8'), context, { filename: file });
  }
  const H = context.HY, S = H.Store;
  H.UI.chart = (metric, records) => { charts.push({ metric, records }); return '<div class="test-chart"></div>'; };
  H.render = () => {};
  H.UI.toast = () => {};
  H.canWrite = () => true;
  return {
    H, S, charts: () => charts, tick: () => timer && timer(),
    page(route, params = '') { charts = []; H.route = route; H.params = new URLSearchParams(params); return H.Pages[route](); },
    newTask() {
      S.completeTask('T20261009001');
      return S.createTask({ workOrder: 'WO-REGRESSION', reelId: 'P-REGRESSION', specId: 'SP035-400', metric: 'dg', deviceId: 'HY-DG-01', recipeId: 'DG-V1.0', plannedLength: 1000 });
    }
  };
}

function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (error) { console.error('FAIL ' + name + '\n' + error.stack); process.exitCode = 1; }
}

test('Initial detection contains exactly 30 samples from its own task', () => {
  const e = environment(); e.page('detection', 'metric=dg');
  assert.equal(e.charts()[0].records.length, 30);
  assert.ok(e.charts()[0].records.every(record => record.taskId === 'T20261009001'));
});

test('A running task with zero samples shows its own metadata and no previous values', () => {
  const e = environment(), task = e.newTask(); e.S.startTask(task.id);
  const html = e.page('detection', 'metric=dg');
  assert.ok(html.includes(task.id));
  assert.equal(e.charts()[0].records.length, 0);
  assert.ok(!html.includes('12.36<small>'));
  assert.ok(!html.includes('AL20261009001'));
});

test('A new task with one sample cannot mix in the previous 30 samples', () => {
  const e = environment(), task = e.newTask(); e.S.startTask(task.id); e.S.advanceTask(task.id);
  e.page('detection', 'metric=dg&task=' + task.id);
  assert.equal(e.charts()[0].records.length, 1);
  assert.equal(e.charts()[0].records[0].taskId, task.id);
});

test('Explicit historical task selection retains its original task window', () => {
  const e = environment(), task = e.newTask(); e.S.startTask(task.id); e.S.advanceTask(task.id);
  e.page('detection', 'metric=dg&task=T20261009001');
  assert.equal(e.charts()[0].records.length, 30);
  assert.ok(e.charts()[0].records.every(record => record.taskId === 'T20261009001'));
});

test('Replay uses the same selected-task records as the detection page', () => {
  const e = environment(), task = e.newTask(); e.S.startTask(task.id); e.S.advanceTask(task.id);
  e.page('detection', 'metric=dg&task=' + task.id);
  e.H.Actions['core-replay']({ dataset: { metric: 'dg', task: task.id } }); e.tick();
  e.page('detection', 'metric=dg&task=' + task.id);
  assert.equal(e.charts()[0].records.length, 1);
  assert.ok(e.charts()[0].records.every(record => record.taskId === task.id));
});

test('Dashboard and monitor do not relabel previous values as a new running task', () => {
  const e = environment(), task = e.newTask(); e.S.startTask(task.id);
  e.page('dashboard');
  assert.equal(e.charts().find(chart => chart.metric === 'dg').records.length, 0);
  assert.ok(!e.page('monitor').includes('<strong>12.36'));
});

test('Task links carry task context and pending task status reads 待开始', () => {
  const e = environment();
  assert.ok(e.page('task', 'id=T20261009001').includes('detection?metric=dg&amp;task=T20261009001'));
  const task = e.newTask();
  assert.ok(e.page('task', 'id=' + task.id).includes('待开始'));
});

test('Trace omits unrelated measurement charts and distinguishes waiting data', () => {
  const e = environment();
  let html = e.page('trace', 'reel=P20261009001');
  assert.equal(e.charts().length, 1);
  assert.equal((html.match(/本盘未关联该项检测/g) || []).length, 2);
  const task = e.newTask();
  html = e.page('trace', 'reel=' + task.reelId);
  assert.equal(e.charts().length, 0);
  assert.ok(html.includes('等待量测数据'));
});

test('Task log reconstructs chronological lifecycle, alarm, recovery, and MES events', () => {
  const e = environment(), html = e.page('task', 'id=T20261009001');
  const log = html.slice(html.indexOf('执行日志'), html.indexOf('关联异常', html.indexOf('执行日志')));
  const times = ['12:50:00', '12:55:00', '13:00:00', '14:06:00', '14:07:00', '14:30:00'];
  const positions = times.map(time => log.indexOf(time));
  assert.ok(positions.every(position => position >= 0));
  assert.ok(positions.every((position, index) => index === 0 || position > positions[index - 1]));
  assert.ok(!html.includes('DG-V1.0 · V1.0'));
});

test('Configurable measurement precision preserves meter, count and exact threshold formats', () => {
  const e = environment(); e.S.state.settings.metricDisplay = { dg: { decimals: 0 }, jx: { decimals: 3 }, by: { decimals: 1 } };
  let html = e.page('dashboard');
  assert.ok(html.includes('<strong>12<small>%</small>'));
  assert.ok(html.includes('<strong>1.520<small>mm</small>'));
  html = e.page('detection', 'metric=jx');
  assert.ok(html.includes('1.800<small> mm</small>'));
  assert.ok(html.includes('2,261.0'));
  html = e.page('history');
  assert.ok(html.includes('共 90 条记录'));
  assert.ok(html.includes('97.78%'));
  e.S.task('T20261009001').ruleSnapshot.threshold = 10.25;
  assert.ok(e.page('task', 'id=T20261009001').includes('<strong>10.25<small>%</small>'));
});

console.log(`${passed}/10 core regressions passed.`);
