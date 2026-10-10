'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../js/data.js'), 'utf8');
function app(options = {}) {
  const items = options.items || new Map();
  const localStorage = options.blocked ? { getItem(){ throw new Error('blocked'); }, setItem(){ throw new Error('blocked'); } } : { getItem:k=>items.get(k)||null, setItem:(k,v)=>items.set(k,v) };
  const context = vm.createContext({ localStorage, Date, console, module:{exports:{}} });
  vm.runInContext(code, context);
  return { S: context.HY.Store, context, items };
}
function input(S, extra = {}) {
  return { workOrder:'WO-TEST-001',reelId:'P-TEST-001',specId:'SP035-400',metric:'dg',deviceId:'HY-DG-01',recipeId:S.state.recipes.find(r=>r.metric==='dg'&&r.enabled).id,plannedLength:30,...extra };
}

test('seed data is coherent across 12 tasks, 90 current records and independent statuses', () => {
  const {S}=app();
  assert.equal(S.state.tasks.length,12);
  assert.equal(S.state.tasks.filter(t=>t.status==='running').length,3);
  assert.equal(S.state.tasks.filter(t=>t.status==='completed').length,9);
  assert.equal(S.state.devices.filter(d=>d.status==='online').length,3);
  assert.equal(S.state.specs.length,6);
  const stats=S.stats(S.currentRecords());
  assert.equal(stats.total,90);assert.equal(stats.valid,90);assert.equal(stats.pass,88);assert.equal(stats.fail,2);
  assert.equal(S.currentRecords('dg').at(-1).value,12.36);
  assert.equal(S.currentRecords('jx').at(-1).value,1.52);
  assert.equal(S.currentRecords('by').at(-1).value,4.37);
  assert.equal(S.stats(S.currentRecords('jx')).avg,1.80);
  assert.equal(S.stats(S.currentRecords('by')).avg,4.25);
  const pending=S.state.alarms.filter(a=>a.status==='pending');
  assert.equal(pending.length,1);assert.equal(pending[0].active,false);
  assert.equal(S.record(pending[0].recordId).value,9.20);
  for(const r of S.state.records){const t=S.task(r.taskId);assert.equal(r.metric,t.metric);assert.equal(r.reelId,t.reelId);assert.equal(r.deviceId,t.deviceId);assert.equal(r.judgement,S.judge(r.value,r.metric,r.ruleSnapshot,r.validity));}
});

test('all threshold boundaries are inclusive and missing data is never coerced to zero', () => {
  const {S}=app();
  for(const [m,boundary,outside] of [['dg',10,9.99],['jx',3,3.01],['by',8,8.01]]){assert.equal(S.judge(boundary,m),'pass');assert.equal(S.judge(outside,m),'fail');}
  for(const missing of [null,undefined,'','  ',NaN,Infinity,false])assert.equal(S.judge(missing,'jx'),'invalid');
  assert.equal(S.judge(0,'jx'),'pass');
  assert.equal(S.judge(12,'dg',undefined,'invalid'),'invalid');
  assert.throws(()=>S.judge(3,'diameter'),/三项/);
});

test('stats exclude invalid values while exposing the latest invalid record for current-state UI', () => {
  const {S}=app();
  const rows=[{value:2,validity:'valid',judgement:'pass',time:'2026-10-09 14:01:00'},{value:null,validity:'invalid',judgement:'invalid',time:'2026-10-09 14:02:00'}];
  const stats=S.stats(rows);assert.equal(stats.valid,1);assert.equal(stats.invalid,1);assert.equal(stats.avg,2);assert.equal(stats.min,2);assert.equal(stats.last.value,null);
  assert.equal(S.stats([]).avg,null);assert.equal(S.stats([]).last,null);
});

test('task validation rejects wrong metric, equipment, voltage and missing required fields', () => {
  const {S}=app();
  assert.throws(()=>S.createTask(input(S,{workOrder:''})),/不能为空/);
  assert.throws(()=>S.createTask(input(S,{metric:'jx'})),/不适用/);
  assert.throws(()=>S.createTask(input(S,{deviceId:'HY-JX-01'})),/不匹配/);
  assert.throws(()=>S.createTask(input(S,{plannedLength:0})),/计划长度/);
  S.spec('SP035-400').voltage=10;
  assert.throws(()=>S.createTask(input(S)),/35–220/);
});

test('create, assign, start, measure and finish preserves single-metric applicability', () => {
  const {S}=app();
  const task=S.createTask(input(S));assert.equal(task.status,'pending');assert.equal(S.recordsFor(task.id).length,0);
  assert.throws(()=>S.createTask(input(S)),/已有未完成/);
  assert.throws(()=>S.startTask(task.id),/已有检测中/);
  S.completeTask('T20261009001');S.startTask(task.id);
  assert.throws(()=>S.completeTask(task.id),/尚无检测记录/);
  for(let i=0;i<3;i++)S.advanceTask(task.id);
  S.completeTask(task.id);
  assert.equal(task.status,'completed');assert.equal(task.measuredLength,30);assert.equal(S.recordsFor(task.id).length,3);
  assert.ok(S.recordsFor(task.id).every(r=>r.metric==='dg'));
  const report=S.createReport(task.id);assert.equal(report.kind,'final');assert.equal(report.snapshot.stats.valid,3);
});

test('offline equipment blocks acquisition without introducing fake zero measurements', () => {
  const {S}=app();S.setScenario('offline');
  const before=S.state.records.length;
  assert.throws(()=>S.advanceTask('T20261009001'),/离线/);
  assert.equal(S.state.records.length,before);
  assert.equal(S.device('HY-DG-01').status,'offline');
  S.setScenario('normal');assert.equal(S.device('HY-DG-01').status,'online');
});

test('restored readings do not automatically close pending alarms; resolution requires notes', () => {
  const {S}=app();const alarm=S.alarm('AL20261009001');const original=JSON.stringify(S.record(alarm.recordId));
  assert.equal(alarm.active,false);assert.equal(alarm.status,'pending');
  assert.throws(()=>S.updateAlarm(alarm.id,{status:'resolved',note:''}),/说明/);
  S.updateAlarm(alarm.id,{status:'processing',note:'开始复核原始量测'});
  S.updateAlarm(alarm.id,{status:'resolved',note:'复核设备原图与连续后续记录，完成处置'});
  assert.equal(alarm.status,'resolved');assert.equal(JSON.stringify(S.record(alarm.recordId)),original);assert.equal(alarm.history.length,4);
});

test('recipe revision cannot rewrite historical rule snapshots or invert the judgement direction', () => {
  const {S}=app();const old=S.recipe('DG-V1.0');const task=S.task('T20261009001');const original=JSON.stringify(task.ruleSnapshot);const record=S.recordsFor(task.id)[0];
  const next=S.reviseRecipe(old.id,{name:'高要求配方',threshold:13,operator:'>='});
  assert.equal(next.version,'V1.1');assert.equal(next.threshold,13);assert.equal(old.enabled,false);assert.equal(S.recipe(old.id),old);
  assert.equal(JSON.stringify(task.ruleSnapshot),original);assert.equal(record.ruleSnapshot.threshold,10);assert.equal(record.judgement,'pass');
  assert.throws(()=>S.reviseRecipe(next.id,{threshold:12,operator:'<='}),/下限/);
  const created=S.createTask(input(S,{recipeId:next.id}));assert.equal(created.ruleSnapshot.threshold,13);
});

test('reports remain deep snapshots, running tasks create stages and unresolved alarms block final reports', () => {
  const {S}=app();const report=S.createReport('T20261009001');
  assert.equal(report.kind,'stage');assert.equal(report.snapshot.task.status,'running');
  const original=JSON.stringify(report.snapshot);
  S.state.reportTemplate.title='新的报告标题';S.spec('SP035-400').area=500;S.device('HY-DG-01').name='新设备显示名称';S.advanceTask('T20261009001');S.completeTask('T20261009001');
  assert.equal(JSON.stringify(report.snapshot),original);
  assert.throws(()=>S.createReport('T20261009001'),/复核/);
  S.updateAlarm('AL20261009001',{status:'resolved',note:'已复核并处理'});
  const final=S.createReport('T20261009001');assert.equal(final.kind,'final');assert.equal(final.snapshot.stats.fail,1);
  assert.notEqual(final.snapshot.task,S.task(final.taskId));assert.notEqual(final.snapshot.records[0],S.recordsFor(final.taskId)[0]);
});

test('MES retry is idempotent, failed sync is independent from measurement validity', () => {
  const {S}=app();S.setScenario('mes-failure');
  const failed=S.state.records.filter(r=>r.mesStatus==='failed');assert.equal(failed.length,3);assert.ok(failed.every(r=>r.validity==='valid'));
  assert.equal(S.retrySync().count,0);
  S.setScenario('normal');const before=S.state.records.length;
  assert.equal(S.retrySync().count,3);assert.equal(S.retrySync().count,0);assert.equal(S.state.records.length,before);
  assert.ok(failed.every(r=>r.mesStatus==='confirmed'));
  assert.throws(()=>S.retrySync(['unknown']),/不存在/);
});

test('CSV imports accept valid rows, report row-level errors, preserve blanks as invalid and prevent duplicates', () => {
  const {S}=app();const base={taskId:'T20261009001',metric:'dg',time:'2026-10-09 14:31:00',meter:1240,value:12};
  const out=S.importRecords([base,{...base,time:'2026-10-09 14:32:00',value:''},{...base,time:'2026-10-09 14:33:00',metric:'x'},{...base,time:'2026-10-09 14:34:00',value:null,validity:'invalid'}]);
  assert.equal(out.count,2);assert.equal(out.errors.length,2);assert.equal(out.errors[0].row,2);assert.equal(out.errors[0].line,3);
  const invalid=S.recordsFor(base.taskId).at(-1);assert.equal(invalid.value,null);assert.equal(invalid.judgement,'invalid');
  assert.equal(S.importRecords([base]).count,0);
  assert.equal(S.importRecords([{...base,time:'2026-02-30 14:01:00'}]).count,0);
  assert.equal(S.importRecords([{...base,time:'2026-10-09 14:40:00',deviceId:'HY-JX-01'}]).count,0);
});

test('backfilled historical failures create pending recovered alarms without changing previously generated reports', () => {
  const {S}=app();const historical=S.task('T20261009004');const report=S.state.reports.find(r=>r.taskId===historical.id);const original=JSON.stringify(report.snapshot);
  const result=S.importRecords([{taskId:historical.id,metric:'dg',time:'2026-10-09 08:05:30',meter:75,value:9}]);
  assert.equal(result.count,1);const alarm=S.state.alarms.at(-1);assert.equal(alarm.active,false);assert.equal(alarm.status,'pending');
  assert.equal(JSON.stringify(report.snapshot),original);assert.equal(S.recordsFor(historical.id).length,13);
});

test('auxiliary data keeps local gaps distinct and does not invent an out-of-roundness formula', () => {
  const {S}=app();const wire=S.currentRecords('jx').at(-1);const by=S.currentRecords('by').at(-1);
  assert.equal(wire.aux.localGaps.length,4);assert.equal(Math.round(wire.aux.localGaps.reduce((a,b)=>a+b,0)/4*100)/100,wire.value);
  assert.equal(by.aux.xDiameter,66.42);assert.equal(by.aux.yDiameter,63.52);assert.equal(by.value,4.37);assert.equal(by.aux.formula,undefined);
});

test('invalid scenario retains null records, excludes them from pass rate, and normal scenario preserves history', () => {
  const {S}=app();S.setScenario('invalid');
  const invalid=S.state.records.filter(r=>r.validity==='invalid');assert.equal(invalid.length,1);assert.equal(invalid[0].value,null);
  const summary=S.stats(S.currentRecords());assert.equal(summary.invalid,1);assert.equal(summary.valid,87);
  S.setScenario('normal');assert.equal(S.record(invalid[0].id).value,null);
});

test('saved state survives reload; corrupt or incompatible storage safely falls back; reset restores exact seeds', () => {
  const {S,items}=app();const task=S.createTask(input(S));
  const reloaded=app({items}).S;assert.equal(reloaded.task(task.id).workOrder,'WO-TEST-001');
  reloaded.reset();assert.equal(reloaded.state.tasks.length,12);assert.equal(reloaded.currentRecords().length,90);
  items.set(S.KEY,'{broken');assert.equal(app({items}).S.state.tasks.length,12);
  items.set(S.KEY,JSON.stringify({schemaVersion:999}));assert.equal(app({items}).S.state.tasks.length,12);
  const blocked=app({blocked:true}).S;assert.equal(blocked.createTask(input(blocked)).status,'pending');assert.equal(blocked.memoryOnly,true);
});

test('audit actor uses the active mock session user', () => {
  const {S,context}=app();context.HY.currentUser={id:'U003',name:'质量审核员',role:'quality'};
  const entry=S.log('查看报告','RP-TEST');assert.equal(entry.actor,'质量审核员');assert.equal(entry.role,'quality');
});
