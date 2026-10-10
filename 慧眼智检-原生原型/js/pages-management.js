(function () {
  'use strict';
  const H = window.HY, S = H.Store, U = H.UI;
  const E = value => U.esc(value == null ? '' : value);
  const metric = id => S.metrics[id] || S.metrics.dg;
  const arr = name => Array.isArray(S.state[name]) ? S.state[name] : [];
  const filter = key => H.filters[key] || {};
  const n = (value, digits = 2) => value === null || value === undefined || value === '' || !Number.isFinite(Number(value)) ? '—' : Number(value).toFixed(digits);
  const measurement = (value, id) => U.metricFmt(value, id);
  const reportKpi = (...args) => U.kpi(...args).replace('class="kpi-value"', 'class="kpi-value" style="font-size:22px;white-space:normal;overflow-wrap:anywhere;line-height:1.5"');
  const pill = (value, map) => { const pair = map[value] || [value || '—', 'gray']; return U.badge(pair[0], pair[1]); };
  const alarmState = value => pill(value, { pending: ['待复核', 'red'], processing: ['处理中', 'amber'], resolved: ['已处理', 'green'] });
  const mesState = value => pill(value, { confirmed: ['已确认', 'green'], pending: ['待同步', 'blue'], failed: ['同步失败', 'red'] });
  const taskState = value => pill(value, { pending: ['待开始', 'gray'], running: ['检测中', 'blue'], completed: ['已完成', 'green'] });
  const roles = { admin: '系统管理员', quality: '质量管理员', viewer: '只读观察员' };
  const metricOptions = [['', '全部三项检测'], ...Object.values(S.metrics).map(m => [m.id, m.short || m.name])];
  const title = U.title.bind(U), link = U.link.bind(U);
  const panel = (heading, body, tools = '', cls = '') => U.panel(heading, '<div class="panel-body">' + body + '</div>', tools, cls);
  const btn = (text, action, data = {}, primary = false, icon = '') => U.button(text, action, data, primary, icon);
  const formButtons = () => '<button class="btn primary" type="submit">' + U.icon('search', 16) + '查询</button>' + btn('重置', 'filter-reset', { id: H.route });
  const kv = (label, value) => '<div><div class="muted small">' + E(label) + '</div><div style="margin-top:8px">' + value + '</div></div>';
  const info = pairs => '<div class="detail-grid">' + pairs.map(pair => kv(pair[0], pair[1])).join('') + '</div>';
  const metricSelect = (name, value) => U.select(name, metricOptions, value);
  const ruleText = (rule, id) => ({ '>=': '≥', '<=': '≤' }[rule && rule.operator || metric(id).operator] || rule && rule.operator || metric(id).operator || '≤') + ' ' + (rule && rule.threshold !== undefined ? rule.threshold : metric(id).threshold) + ' ' + metric(id).unit;
  const dateOnly = value => String(value || '').slice(0, 10);
  const stamp = () => new Date().toISOString();
  const displayTime = value => value ? E(U.date(value)) : '—';
  const canWrite = () => typeof H.canWrite === 'function' ? H.canWrite() : H.currentUser && H.currentUser.role !== 'viewer';
  const admin = () => typeof H.isAdmin === 'function' ? H.isAdmin() : H.currentUser && H.currentUser.role === 'admin';
  function permit(adminOnly) {
    if (adminOnly ? !admin() : !canWrite()) { U.toast(adminOnly ? '此操作需要系统管理员角色，请切换演示身份。' : '当前角色为只读，不能修改演示数据。'); return false; }
    return true;
  }
  function writeLog(action, detail) { S.log(action, detail); S.save(); H.render(); }
  function inputRequired(name, value, placeholder, type = 'text', extra = '') {
    return '<input name="' + E(name) + '" type="' + E(type) + '" value="' + E(value) + '" placeholder="' + E(placeholder || '') + '" required ' + extra + '>';
  }
  const textarea = (name, value, placeholder, required = false) => '<textarea name="' + E(name) + '" rows="4" placeholder="' + E(placeholder || '') + '" ' + (required ? 'required' : '') + '>' + E(value || '') + '</textarea>';
  const check = (name, text, checked) => '<label class="row small"><input type="checkbox" name="' + E(name) + '" ' + (checked ? 'checked' : '') + '> ' + E(text) + '</label>';
  function rawCSV(items, columns) {
    const cell = value => '"' + String(value == null ? '' : value).replace(/"/g, '""').replace(/^([=+@-])/, "'$1") + '"';
    return '\uFEFF' + [columns.map(c => cell(c[0])).join(','), ...items.map(item => columns.map(c => cell(c[1](item))).join(','))].join('\r\n');
  }
  function latestRecipe(id) { return arr('recipes').filter(r => r.metric === id && r.enabled !== false).slice(-1)[0] || arr('recipes').find(r => r.metric === id); }
  function missing(text, route) { return title(text, '请从列表中选择对应记录。') + panel('记录不可用', U.empty(text) + '<div class="toolbar">' + link('返回列表', route) + '</div>'); }

  function filteredAlarms() {
    const f = filter('alarms');
    return arr('alarms').filter(a => {
      const r = S.record(a.recordId) || {};
      return (!f.metric || a.metric === f.metric) && (!f.status || a.status === f.status) && (!f.active || (f.active === 'active') === !!a.active) && (!f.keyword || [a.id, a.taskId, r.reelId, r.workOrder].join(' ').toLowerCase().includes(f.keyword.toLowerCase()));
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  H.Pages.alarms = function () {
    const f = filter('alarms'), all = arr('alarms'), rows = filteredAlarms(), page = U.paginate(rows, 'alarms', 8);
    return title('报警事件', '保留过程超限证据；数值恢复、人工复核与 MES 接收状态分别记录。') +
      '<div class="grid cols-4">' + U.kpi('过程超限事件', all.length, '所有报警原始记录保留', 'bell', 'blue') + U.kpi('待人工复核', all.filter(a => a.status === 'pending').length, '当前值恢复不自动关闭事件', 'alert-triangle', 'red') + U.kpi('正在处理', all.filter(a => a.status === 'processing').length, '处理过程可追溯', 'clock', 'amber') + U.kpi('已完成处置', all.filter(a => a.status === 'resolved').length, '处置记录与原始量测分别保存', 'shield-check', 'green') + '</div>' +
      U.filterForm('alarms', U.field('盘号 / 工单', U.input('keyword', f.keyword, '输入盘号、工单或报警编号')) + U.field('检测项目', metricSelect('metric', f.metric)) + U.field('处理状态', U.select('status', [['', '全部状态'], ['pending', '待复核'], ['processing', '处理中'], ['resolved', '已处理']], f.status)) + U.field('数值状态', U.select('active', [['', '全部'], ['active', '仍超限'], ['recovered', '已恢复']], f.active)), formButtons()) +
      panel('报警记录', U.table(['报警时间', '关联对象', '检测项目', '事件值 / 控制阈值', '数值状态', '处置状态', '操作'], page.items.map(a => {
        const r = S.record(a.recordId) || {};
        return [displayTime(a.createdAt), link(r.reelId || a.taskId, 'trace?reel=' + encodeURIComponent(r.reelId || '')) + '<div class="small muted">' + E(a.id) + '</div>', E(metric(a.metric).name), '<strong class="text-red">' + measurement(r.value, a.metric) + ' ' + E(metric(a.metric).unit) + '</strong><div class="small muted">' + E(ruleText(r.ruleSnapshot, a.metric)) + '</div>', U.badge(a.active ? '仍超限' : '已恢复', a.active ? 'red' : 'green'), alarmState(a.status), link('查看与处置', 'alarm?id=' + encodeURIComponent(a.id))];
      })) + page.footer, '<span class="muted small">共 ' + rows.length + ' 条事件</span>') + U.note('数值恢复仅说明后续采样恢复阈值内。原始超限记录不会被覆盖，处理结论须由质量人员复核。');
  };
  H.Pages.alarm = function () {
    const a = H.params.has('id') ? S.alarm(H.params.get('id')) : arr('alarms')[0];
    if (!a) return missing('暂无报警事件', 'alarms');
    const r = S.record(a.recordId), t = S.task(a.taskId);
    if (!r) return missing('关联量测记录不存在', 'alarms');
    const m = metric(a.metric), history = a.history || [], records = S.recordsFor(a.taskId);
    return title('报警详情与处置', '每一次复核都与原始量测记录、当时规则和处理人关联。', link('返回报警列表', 'alarms') + btn(a.status === 'resolved' ? '补充处置记录' : '复核与处置', 'alarm-review', { id: a.id }, true, 'clipboard-check')) +
      panel(m.name + '超限', info([['报警编号', E(a.id)], ['事件时间', displayTime(a.createdAt)], ['盘号 / 工单', link(r.reelId, 'trace?reel=' + encodeURIComponent(r.reelId)) + '<div class="small muted">' + E(r.workOrder) + '</div>'], ['关联任务', link(a.taskId, 'task?id=' + encodeURIComponent(a.taskId))], ['原始超限值', '<strong class="text-red" style="font-size:28px">' + measurement(r.value, a.metric) + '<small> ' + E(m.unit) + '</small></strong>'], ['当时判定规则', E(ruleText(r.ruleSnapshot, a.metric)) + '<div class="small muted">' + E(r.ruleSnapshot && r.ruleSnapshot.version) + '</div>'], ['米数位置', n(r.meter, 1) + ' m'], ['当前状态', U.badge(a.active ? '数值仍超限' : '数值已恢复', a.active ? 'red' : 'green') + ' ' + alarmState(a.status)]])) +
      '<div class="split">' + panel('事件对应趋势', U.chart(a.metric, records, { height: 275 }), '<span class="small muted">原始点：' + displayTime(r.time) + '</span>') + panel('对应量测图像', U.inspection(r), '<span class="muted small">演示素材 · 非现场图像</span>') + '</div>' +
      '<div class="split">' + panel('处置时间线', history.length ? '<div class="stack">' + history.map(h => '<div style="border-left:2px solid #dce8f7;padding:4px 0 15px 20px"><div class="row"><strong>' + E(h.actor || '质量管理员') + '</strong>' + alarmState(h.status) + '<span class="spacer"></span><span class="small muted">' + displayTime(h.time) + '</span></div><p>' + E(h.note || '记录报警状态变化') + '</p></div>').join('') + '</div>' : U.empty('尚无人工处置记录')) + panel('数据与证据', info([['原始记录', E(r.id)], ['执行设备', E(r.deviceId)], ['数据有效性', U.badge(r.validity === 'valid' ? '有效数据' : '无效数据', r.validity === 'valid' ? 'blue' : 'gray')], ['MES 状态', mesState(r.mesStatus)], ['任务执行状态', taskState(t && t.status)], ['原始记录保留', U.badge('保留，不覆盖', 'green')]]) + '<div style="margin-top:20px">' + U.note(a.status === 'resolved' ? '该事件已完成人工处理。原始超限值及后续补充记录继续保留。' : '完成复核后再填写处置结论。当前数值恢复不会自动修改此事件的处理状态。', a.status === 'resolved' ? 'green' : 'amber') + '</div>') + '</div>';
  };
  H.Actions['alarm-review'] = el => {
    if (!permit()) return;
    const a = S.alarm(el.dataset.id); if (!a) return;
    U.modal('报警复核与处置', U.note('原始测量值和当时判定规则保持不变。请记录实际复核依据及处理结果。', 'amber') + U.field('处理状态', U.select('status', [['processing', '处理中'], ['resolved', '已处理']], a.status === 'resolved' ? 'resolved' : 'processing')) + U.field('复核 / 处理结论', textarea('note', '', '例如：检查铜带张力，调整工艺后复测；记录复核依据。', true)) + U.field('处置人', inputRequired('actor', H.currentUser && H.currentUser.name || '质量管理员', '填写处置人')), fd => { S.updateAlarm(a.id, { status: fd.get('status'), note: String(fd.get('note')).trim(), actor: String(fd.get('actor')).trim() }); H.render(); U.toast('处置已保存，原始超限记录保留。'); });
  };

  function analyticsRecords() {
    const f = filter('analytics');
    return arr('records').filter(r => (!f.metric || f.metric === r.metric) && (!f.from || dateOnly(r.time) >= f.from) && (!f.to || dateOnly(r.time) <= f.to));
  }
  H.Pages.analytics = function () {
    const f = filter('analytics'), records = analyticsRecords(), stats = S.stats(records), rate = stats.valid ? n(stats.pass / stats.valid * 100) : '—';
    const ids = f.metric ? [f.metric] : ['dg', 'jx', 'by'];
    const groups = [...new Set(records.map(r => r.reelId))].map(id => ({ id, records: records.filter(r => r.reelId === id) }));
    const page = U.paginate(groups, 'analytics', 8);
    return title('质量统计分析', '按有效记录汇总过程检测表现，支持按检测项目和日期范围分析。', btn('导出统计明细', 'analytics-export', {}, false, 'download')) +
      U.filterForm('analytics', U.field('检测项目', metricSelect('metric', f.metric)) + U.field('开始日期', U.input('from', f.from || '', '', 'date')) + U.field('结束日期', U.input('to', f.to || '', '', 'date')), formButtons()) +
      (f.from && f.to && f.from > f.to ? U.note('开始日期晚于结束日期，请调整查询范围。', 'amber') : '') +
      '<div class="grid cols-4">' + U.kpi('有效量测记录', stats.valid, '无效 / 缺失 ' + stats.invalid + ' 条，不参与阈值统计', 'database', 'blue') + U.kpi('记录符合阈值比例', rate + (rate === '—' ? '' : '%'), '过程记录比例，不代表产品最终合格率', 'chart-line', 'green') + U.kpi('过程超限记录', stats.fail, '保留原始阈值判定', 'alert-triangle', 'red') + U.kpi('覆盖盘号', groups.length, '按查询范围内的关联盘号去重', 'box', 'blue') + '</div>' +
      '<div class="grid ' + (ids.length > 1 ? 'cols-3' : 'cols-1') + '">' + ids.map(id => { const rs = records.filter(r => r.metric === id), st = S.stats(rs), m = metric(id); return panel(m.name, '<div class="row"><strong style="font-size:28px;color:' + E(m.color) + '">' + measurement(st.avg, id) + ' <small>' + E(m.unit) + '</small></strong><span class="spacer"></span><span class="muted small">有效均值</span></div>' + U.chart(id, rs, { height: 205, mini: true }) + '<div class="metrics-strip" style="grid-template-columns:repeat(3,minmax(0,1fr));white-space:nowrap">' + kv('最小值', measurement(st.min, id) + ' ' + E(m.unit)) + kv('最大值', measurement(st.max, id) + ' ' + E(m.unit)) + kv('超限记录', '<span class="text-red">' + st.fail + '</span>') + '</div>'); }).join('') + '</div>' +
      panel('按盘号汇总', U.table(['盘号', '检测项目', '有效记录', '符合阈值', '超限记录', '记录符合阈值比例', 'MES 已确认', '操作'], page.items.map(g => { const st = S.stats(g.records); return [link(g.id, 'trace?reel=' + encodeURIComponent(g.id)), [...new Set(g.records.map(r => metric(r.metric).short || metric(r.metric).name))].map(E).join(' / '), st.valid, st.pass, st.fail ? '<span class="text-red">' + st.fail + '</span>' : '0', st.valid ? n(st.pass / st.valid * 100) + '%' : '—', g.records.filter(r => r.mesStatus === 'confirmed').length + ' / ' + g.records.length, link('盘号追溯', 'trace?reel=' + encodeURIComponent(g.id))]; })) + page.footer) + U.note('三项检测单位不同，曲线与极值分别计算；质量结论需结合任务完成情况与异常复核，不以单一过程比例代替。');
  };
  H.Actions['analytics-export'] = () => U.downloadCSV(analyticsRecords(), '慧眼智检-质量统计明细.csv');

  function filteredReports() { const f = filter('reports'); return arr('reports').filter(r => (!f.kind || r.kind === f.kind) && (!f.keyword || [r.id, r.taskId, r.snapshot && r.snapshot.task && r.snapshot.task.reelId].join(' ').toLowerCase().includes(f.keyword.toLowerCase()))).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  H.Pages.reports = function () {
    const f = filter('reports'), all = arr('reports'), reports = filteredReports(), page = U.paginate(reports, 'reports', 8);
    return title('质量报告管理', '按任务生成可追溯报告快照；运行中任务仅生成阶段报告。', btn('生成质量报告', 'report-create', {}, true, 'file-plus')) +
      '<div class="grid cols-3">' + U.kpi('报告总数', all.length, '每份报告保留生成时的数据快照', 'file-text') + U.kpi('阶段报告', all.filter(r => r.kind === 'stage').length, '任务尚未结束，不给出最终质量结论', 'clock', 'amber') + U.kpi('最终报告', all.filter(r => r.kind === 'final').length, '仅针对已完成检测任务', 'shield-check', 'green') + '</div>' +
      U.filterForm('reports', U.field('报告 / 任务 / 盘号', U.input('keyword', f.keyword, '输入报告编号、任务或盘号')) + U.field('报告类型', U.select('kind', [['', '全部类型'], ['stage', '阶段报告'], ['final', '最终报告']], f.kind)), formButtons()) +
      panel('报告记录', U.table(['报告编号', '关联任务 / 盘号', '检测项目', '报告类型', '有效 / 超限记录', '生成时间', '操作'], page.items.map(r => { const sn = r.snapshot || {}, t = sn.task || S.task(r.taskId) || {}, st = sn.stats || S.stats(sn.records || []); return [link(r.id, 'report?id=' + encodeURIComponent(r.id)), E(t.id || r.taskId) + '<div class="small muted">' + E(t.reelId) + '</div>', E(metric(t.metric).name), U.badge(r.kind === 'final' ? '最终报告' : '阶段报告', r.kind === 'final' ? 'green' : 'blue'), st.valid + ' / <span class="text-red">' + st.fail + '</span>', displayTime(r.createdAt), link('预览 / 导出', 'report?id=' + encodeURIComponent(r.id))]; })) + page.footer, '<span class="muted small">' + reports.length + ' 份报告</span>') + U.note('报告快照生成后保持不变。后续测量、报警处置或模板修改需要重新生成报告，以保留审计链路。');
  };
  H.Actions['report-create'] = el => {
    if (!permit()) return;
    const tasks = arr('tasks');
    if (!tasks.length) { U.toast('请先创建检测任务。'); return; }
    U.modal('生成质量报告', U.note('系统根据任务实际状态自动生成阶段或最终报告，并保留当前记录、规则与报警处置快照。') + U.field('关联检测任务', U.select('taskId', tasks.map(t => [t.id, t.id + ' · ' + metric(t.metric).short + ' · ' + (t.status === 'completed' ? '已完成 / 最终报告' : '未结束 / 阶段报告')]), el.dataset.taskId || tasks[0].id)), fd => { const report = S.createReport(fd.get('taskId')); H.navigate('report?id=' + encodeURIComponent(report.id)); U.toast('报告快照已生成。'); }, '生成报告');
  };
  H.Pages.report = function () {
    const report = H.params.has('id') ? arr('reports').find(r => r.id === H.params.get('id')) : arr('reports').slice(-1)[0];
    if (!report) return missing('尚无质量报告', 'reports');
    const sn = report.snapshot || {}, t = sn.task || {}, rs = sn.records || [], alarms = sn.alarms || [], st = S.stats(rs), template = sn.template || {}, m = metric(t.metric), sp = sn.spec || S.spec(t.specId) || {}, unresolved = alarms.filter(a => a.status !== 'resolved').length;
    const heading = template.title || template.header || '高压电缆质量检测报告', footer = template.footer || '山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来';
    const state = report.kind === 'stage' ? '阶段数据记录 · 任务未结束，最终质量结论尚未生成' : unresolved ? '检测已完成 · 存在待复核事件，待质量确认' : st.fail ? '检测已完成 · 过程存在超限记录，请依据复核结论确认质量' : st.valid ? '有效检测记录符合所配置阈值 · 最终放行由质量人员确认' : '无有效记录 · 不形成质量判定';
    const alarmSnapshot = alarms.length ? U.table(['时间', '原始超限值', '当时阈值', '处理状态', '复核记录'], alarms.map(a => { const r = rs.find(item => item.id === a.recordId) || {}; return [displayTime(a.createdAt), n(r.value) + ' ' + E(m.unit), E(ruleText(r.ruleSnapshot, a.metric)), alarmState(a.status), E(a.note || (a.history || []).slice(-1)[0]?.note || '暂无人工复核结论')]; })) : U.note('本报告无关联报警记录。', 'green');
    return title('报告预览与导出', '当前显示生成时快照。浏览器打印可保存为 PDF。', link('返回报告管理', 'reports') + btn('导出报告数据', 'report-data-export', { id: report.id }, false, 'download') + btn('打印 / 保存 PDF', 'report-print', {}, true, 'printer')) +
      '<article class="report-document" style="background:#fff;border:1px solid #e7edf5;border-radius:10px;padding:36px 46px;max-width:1220px;margin:auto">' +
      '<div class="row" style="border-bottom:2px solid #155ab6;padding-bottom:22px">' + (template.includeLogo !== false ? '<img src="assets/images/logo.png" alt="慧眼智检" style="width:190px;height:auto;object-fit:contain">' : '') + '<span class="spacer"></span><div style="text-align:right"><strong style="font-size:26px">' + E(heading) + '</strong><p class="muted">' + E(report.id) + ' · ' + (report.kind === 'final' ? '最终报告' : '阶段报告') + '</p></div></div>' +
      '<div style="margin:24px 0">' + U.note(state, report.kind === 'stage' || unresolved || st.fail ? 'amber' : 'green') + '</div>' +
      info([['任务编号', E(t.id)], ['工单 / 盘号', E(t.workOrder) + '<br>' + E(t.reelId)], ['电缆规格', E(sp.voltage || '—') + ' kV · ' + E(sp.cores || 1) + '×' + E(sp.area || '—') + ' mm²'], ['检测项目', E(m.name)], ['执行设备', E(t.deviceId)], ['规则快照', E(ruleText(t.ruleSnapshot, t.metric)) + '<br><span class="small muted">' + E(t.ruleSnapshot && t.ruleSnapshot.version) + '</span>'], ['任务时间', displayTime(t.startAt) + '<br>' + displayTime(t.endAt)], ['生成时间', displayTime(report.createdAt)]]) +
      '<h3 style="border-bottom:1px solid #e7edf5;padding-bottom:12px;margin-top:30px">检测数据汇总</h3><div class="grid cols-4">' + reportKpi('有效记录', st.valid, '无效记录 ' + st.invalid + ' 条', 'database') + reportKpi('最小 / 最大值', n(st.min) + ' / ' + n(st.max), m.unit, 'chart-line') + reportKpi('平均值', n(st.avg), m.unit, 'activity', 'green') + reportKpi('超限 / 待复核', st.fail + ' / ' + unresolved, '不以最新值替代过程记录', 'alert-triangle', st.fail ? 'amber' : 'green') + '</div>' +
      ((template.includeTrend === undefined ? template.showCharts !== false : template.includeTrend) ? '<h3 style="margin-top:28px">量测趋势</h3>' + U.chart(t.metric || 'dg', rs, { height: 265 }) : '') +
      ((template.includeAlarms === undefined ? template.showAlarms !== false : template.includeAlarms) ? '<h3 style="margin-top:26px">过程异常与复核快照</h3>' + alarmSnapshot : '') +
      ((template.includeDetails === undefined ? template.showRecords === true : template.includeDetails) ? '<h3 style="margin-top:26px">量测明细</h3>' + U.table(['时间', '米数 / m', '实测值', '规则快照', '数值判定', 'MES 状态'], rs.map(r => [displayTime(r.time), n(r.meter, 1), n(r.value) + ' ' + E(metric(r.metric).unit), E(ruleText(r.ruleSnapshot, r.metric)) + ' · ' + E(r.ruleSnapshot && r.ruleSnapshot.version), U.status(r.judgement), mesState(r.mesStatus)])) : '<p class="muted small" style="margin-top:20px">全部量测明细可通过“导出报告数据”下载；导出依据此报告快照。</p>') +
      '<div style="margin-top:30px;padding-top:20px;border-top:1px solid #e7edf5"><p class="small muted">量测图像与设备数据为原型演示。本报告只反映所关联任务和所配置检测项目，未检测或不适用项目不作质量推断。</p><div class="row"><span>' + E(template.signatory || template.reviewer || '复核人：____________') + '</span><span class="spacer"></span><span class="muted small">' + E(footer) + '</span></div></div></article>';
  };
  H.Actions['report-print'] = () => window.print();
  H.Actions['report-data-export'] = el => { const report = arr('reports').find(r => r.id === el.dataset.id); if (report) U.downloadCSV(report.snapshot.records || [], report.id + '-报告快照.csv'); };

  H.Pages.metrics = function () {
    const configs = S.state.settings && S.state.settings.metricDisplay || {};
    return title('三项检测指标配置', '维护三项检测的展示精度与说明；控制阈值由版本化配方管理。') +
      '<div class="grid cols-3">' + ['dg', 'jx', 'by'].map(id => { const m = metric(id), r = latestRecipe(id), cfg = configs[id] || {}, latest = S.stats(S.currentRecords(id)).last, value = latest && typeof latest === 'object' ? latest.value : latest; return panel(m.name, '<div class="row" style="gap:20px;align-items:center"><img src="assets/images/metric-' + E(id) + '.png" alt="' + E(m.short) + '专题图标" style="width:84px;height:84px;object-fit:contain;border-radius:16px"><div><div class="small muted">当前显示示例</div><strong style="font-size:30px">' + measurement(value, id) + '</strong> <span class="muted">' + E(m.unit) + '</span></div></div><div style="margin-top:25px">' + info([['指标编码', E(id.toUpperCase())], ['显示精度', (cfg.decimals === undefined ? 2 : cfg.decimals) + ' 位小数'], ['当前控制规则', E(ruleText(r, id))], ['启用规则版本', E(r && r.version || '—')]]) + '</div><p class="small muted" style="min-height:45px;margin-top:24px">' + E(cfg.description || (id === 'dg' ? '铜带屏蔽工序的金属屏蔽搭盖率。搭盖宽度与节距为辅助量测。' : id === 'jx' ? '以相邻铜丝间隙的平均值对照上限。保留每条原始量测记录。' : '不圆度为设备输入结果；双向外径仅作为辅助数据，不推算全周截面。')) + '</p><div class="toolbar">' + btn('显示设置', 'metric-edit', { metric: id }, false, 'settings') + link('查看配方', 'recipes?metric=' + id) + '</div>', U.badge('固定检测项目', 'blue')); }).join('') + '</div>' +
      panel('指标使用约束', U.table(['检测项目', '单位', '阈值方向', '适用结构', '数据来源与判定'], [['金属屏蔽搭盖率', '%', '不低于控制下限', '铜带屏蔽', '以记录绑定的规则快照进行判定'], ['铜丝屏蔽相邻铜丝间隙', 'mm', '不高于控制上限', '铜丝屏蔽', '平均间隙判定，原始分项间隙保留'], ['电缆不圆度', '%', '不高于控制上限', '按规格与工序配置', '直接采用设备不圆度结果，不编造计算公式']])) + U.note('平台仅包含以上三项检测。显示精度仅影响读数展示，不改变原始值、判定结果或历史报告。');
  };
  H.Actions['metric-edit'] = el => {
    if (!permit()) return;
    const id = el.dataset.metric, m = metric(id), settings = S.state.settings || (S.state.settings = {}), cfg = settings.metricDisplay && settings.metricDisplay[id] || {};
    U.modal(m.short + ' · 显示设置', U.field('小数位数', U.select('decimals', [[0, '0 位'], [1, '1 位'], [2, '2 位'], [3, '3 位'], [4, '4 位']], cfg.decimals === undefined ? 2 : cfg.decimals)) + U.field('指标说明', textarea('description', cfg.description || '', '记录指标展示与辅助数据说明')) + U.note('阈值判定始终使用原始精度。修改规则请前往“配方与判定规则”。'), fd => { settings.metricDisplay = settings.metricDisplay || {}; settings.metricDisplay[id] = { decimals: Number(fd.get('decimals')), description: String(fd.get('description')).trim() }; writeLog('更新指标显示配置', m.name); U.toast('显示设置已保存。'); });
  };
  H.Pages.recipes = function () {
    const f = filter('recipes'), chosen = f.metric || H.params.get('metric') || '', rows = arr('recipes').filter(r => !chosen || r.metric === chosen), page = U.paginate(rows.slice().reverse(), 'recipes', 8);
    return title('配方与判定规则', '每次修改生成新版本；历史任务与记录保留当时的规则快照。', btn('创建配方新版本', 'recipe-new', {}, true, 'plus')) +
      U.filterForm('recipes', U.field('检测项目', metricSelect('metric', chosen)), formButtons()) +
      '<div class="grid cols-3">' + ['dg', 'jx', 'by'].map(id => { const r = latestRecipe(id), m = metric(id); return U.kpi(m.short + ' · 当前规则', ruleText(r, id), r ? r.version + ' · ' + r.name : '未配置', m.icon || 'adjustments', id === 'by' ? 'green' : 'blue'); }).join('') + '</div>' +
      panel('规则版本记录', U.table(['配方名称', '检测项目', '规则版本', '控制阈值', '版本状态', '关联任务', '操作'], page.items.map(r => [E(r.name || metric(r.metric).short + '规则'), E(metric(r.metric).name), E(r.version), '<strong>' + E(ruleText(r, r.metric)) + '</strong>', U.badge(r.enabled !== false ? '当前版本' : '历史版本', r.enabled !== false ? 'green' : 'gray'), arr('tasks').filter(t => t.recipeId === r.id).length + ' 项', btn('派生新版本', 'recipe-edit', { id: r.id })])) + page.footer) + U.note('边界值等于阈值时符合规则。新版本用于后续创建的任务；进行中的任务、已完成任务、报警与报告不追溯改判。', 'amber');
  };
  function recipeModal(existing) {
    if (!permit()) return;
    const active = ['dg', 'jx', 'by'].map(latestRecipe).filter(Boolean);
    if (!active.length) { U.toast('未找到基础配方。'); return; }
    const base = existing || active[0];
    U.modal('创建配方新版本', (!existing ? U.field('基于已有配方', U.select('baseId', active.map(r => [r.id, metric(r.metric).name + ' · ' + r.version]), base.id)) : '<input type="hidden" name="baseId" value="' + E(base.id) + '">' + U.note(metric(base.metric).name + ' · 基于 ' + base.version + ' 派生')) + U.field('新版本名称', inputRequired('name', base.name || metric(base.metric).short + '控制规则', '填写配方名称')) + U.field('控制阈值', inputRequired('threshold', base.threshold, '输入非负数值', 'number', 'min="0" max="100" step="0.001"')) + U.field('变更说明', textarea('note', '', '记录本次规则变更依据', true)) + U.note('阈值单位和比较方向由所选检测项目固定。新版本不会覆盖任何历史记录。', 'amber'), fd => { const chosen = S.recipe(fd.get('baseId')); if (!chosen) throw new Error('所选基础配方不存在。'); const threshold = Number(fd.get('threshold')); if (!Number.isFinite(threshold) || threshold < 0 || (metric(chosen.metric).unit === '%' && threshold > 100)) throw new Error('百分比阈值须在 0–100 范围，间隙阈值须为非负数。'); S.reviseRecipe(chosen.id, { name: String(fd.get('name')).trim(), threshold, operator: chosen.operator, note: String(fd.get('note')).trim(), description: String(fd.get('note')).trim(), enabled: true }); H.render(); U.toast('新版本已创建，历史规则保持不变。'); }, '创建新版本');
  }
  H.Actions['recipe-new'] = () => {
    recipeModal();
    if (typeof document === 'undefined') return;
    const form = document.getElementById('active-modal-form');
    const chooser = form && form.querySelector('select[name="baseId"]');
    if (chooser) chooser.addEventListener('change', () => {
      const chosen = S.recipe(chooser.value);
      if (!chosen) return;
      form.elements.namedItem('name').value = chosen.name || metric(chosen.metric).short + '控制规则';
      form.elements.namedItem('threshold').value = chosen.threshold;
      form.elements.namedItem('threshold').closest('.field').querySelector('span').textContent = '控制阈值 / ' + metric(chosen.metric).unit + '（' + (chosen.operator === '>=' ? '下限' : '上限') + '）';
    });
  };
  H.Actions['recipe-edit'] = el => recipeModal(S.recipe(el.dataset.id));

  H.Pages.templates = function () {
    const t = S.state.reportTemplate || {};
    return title('报告模板配置', '维护统一的报告抬头、内容与签审栏；修改仅应用于之后生成的报告。', btn('编辑报告模板', 'template-edit', {}, true, 'edit')) +
      '<div class="split">' + panel('模板预览', '<div style="border:1px solid #e7edf5;padding:28px;border-radius:8px"><div class="row">' + (t.includeLogo !== false ? '<img src="assets/images/logo.png" alt="慧眼智检" style="width:160px">' : '') + '<span class="spacer"></span>' + U.badge('模板预览', 'blue') + '</div><h2 style="margin:30px 0;text-align:center">' + E(t.title || t.header || '高压电缆质量检测报告') + '</h2>' + info([['任务编号', 'T***********'], ['工单 / 盘号', '由任务自动填充'], ['检测项目', '由适用项目自动填充'], ['判定规则', '生成时规则快照']]) + '<div style="margin:24px 0;padding:20px;background:#f4f7fc;border-radius:6px">检测数据汇总' + ((t.includeTrend === undefined ? t.showCharts !== false : t.includeTrend) ? '<p class="muted small">已启用：量测趋势</p>' : '') + ((t.includeAlarms === undefined ? t.showAlarms !== false : t.includeAlarms) ? '<p class="muted small">已启用：报警与复核记录</p>' : '') + ((t.includeDetails === undefined ? t.showRecords === true : t.includeDetails) ? '<p class="muted small">已启用：全部量测明细</p>' : '') + '</div><p>' + E(t.signatory || t.reviewer || '复核人：____________') + '</p><p class="muted small" style="border-top:1px solid #e7edf5;padding-top:20px">' + E(t.footer || '山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来') + '</p></div>') + '<div class="stack">' + panel('模板信息', info([['模板版本', E(t.version || 'V1.0')], ['作用范围', '三项检测报告'], ['生成方式', '按任务状态生成'], ['历史报告', U.badge('保持原始快照', 'green')]])) + panel('内容组成', '<div class="stack">' + ['报告编号与生成时间', '任务、盘号与设备信息', '当时规则与统计结果', '阶段 / 最终报告标记', '数据来源与演示声明'].map(text => '<div class="row">' + U.icon('check', 17) + E(text) + '<span class="spacer"></span>' + U.badge('必备', 'gray') + '</div>').join('') + '</div>') + U.note('签审栏是报告展示内容。原型不模拟有效电子签名或生产放行授权。') + '</div></div>';
  };
  H.Actions['template-edit'] = () => {
    if (!permit()) return;
    const t = S.state.reportTemplate || {};
    U.modal('编辑报告模板', U.field('报告抬头', inputRequired('title', t.title || t.header || '高压电缆质量检测报告', '填写报告标题')) + U.field('签审栏', U.input('signatory', t.signatory || t.reviewer || '复核人：____________')) + U.field('页脚', textarea('footer', t.footer || '山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来')) + '<div class="grid cols-2">' + check('includeLogo', '显示品牌 Logo', t.includeLogo !== false) + check('includeTrend', '显示量测趋势', (t.includeTrend === undefined ? t.showCharts !== false : t.includeTrend)) + check('includeAlarms', '显示报警复核记录', (t.includeAlarms === undefined ? t.showAlarms !== false : t.includeAlarms)) + check('includeDetails', '显示全部量测明细', (t.includeDetails === undefined ? t.showRecords === true : t.includeDetails)) + '</div>', fd => { const revision = Number(t.revision || 1) + 1; S.state.reportTemplate = { ...t, title: String(fd.get('title')).trim(), header: String(fd.get('title')).trim(), signatory: String(fd.get('signatory')).trim(), footer: String(fd.get('footer')).trim(), includeLogo: fd.has('includeLogo'), includeTrend: fd.has('includeTrend'), includeAlarms: fd.has('includeAlarms'), includeDetails: fd.has('includeDetails'), revision, version: 'V1.' + (revision - 1), updatedAt: stamp() }; writeLog('修改报告模板', '版本 V1.' + (revision - 1)); U.toast('模板已保存，之后生成的报告将使用此版本。'); });
  };

  H.Pages.devices = function () {
    const f = filter('devices'), devices = arr('devices').filter(d => (!f.metric || d.metric === f.metric) && (!f.status || d.status === f.status) && (!f.keyword || [d.id, d.name, d.line].join(' ').toLowerCase().includes(f.keyword.toLowerCase())));
    return title('设备档案', '按独立工位管理三类检测设备、连接状态与关联任务。', btn('新增设备', 'device-add', {}, true, 'plus')) +
      U.filterForm('devices', U.field('设备 / 产线', U.input('keyword', f.keyword, '输入设备编号、名称或产线')) + U.field('设备类型', metricSelect('metric', f.metric)) + U.field('连接状态', U.select('status', [['', '全部状态'], ['online', '在线'], ['offline', '离线']], f.status)), formButtons()) +
      '<div class="grid cols-3">' + (devices.length ? devices.map(d => { const tasks = arr('tasks').filter(t => t.deviceId === d.id), current = tasks.find(t => t.status === 'running'); return panel(d.name, '<div class="row" style="gap:28px;margin-bottom:24px"><img src="assets/images/device-' + E(d.metric) + '.png" alt="' + E(d.name) + '设备外观参考" style="width:110px;height:175px;object-fit:contain"><div><p class="muted small">' + E(metric(d.metric).name) + '</p><h2>' + E(d.id) + '</h2><p>' + E(d.line || '独立检测工位') + '</p>' + U.badge(d.status === 'online' ? '设备在线' : '设备离线', d.status === 'online' ? 'green' : 'gray') + '</div></div>' + info([['数据来源', E(d.source || '设备自动采集')], ['最近连接', displayTime(d.lastSeen)], ['校准 / 检查日期', E(d.calibration || '未设置')], ['关联任务', tasks.length + ' 项']]) + '<div style="margin-top:20px">' + (current ? U.note('正在执行 ' + current.id) : U.note('当前无执行中的检测任务', 'gray')) + '</div><div class="toolbar">' + btn('编辑档案', 'device-edit', { id: d.id }, false, 'edit') + link('查看检测', 'detection?metric=' + d.metric) + '</div>', U.badge(d.status === 'online' ? '在线' : '离线', d.status === 'online' ? 'green' : 'gray')); }).join('') : U.empty('没有符合条件的设备')) + '</div>' + U.note('设备外观参考产品手册。不同检测对象与任务分别关联；此原型不表示三类设备一定安装在同一条生产线上。');
  };
  function deviceModal(d) {
    if (!permit(true)) return;
    const exists = !!d; d = d || {};
    const bound = exists && arr('records').some(r => r.deviceId === d.id);
    U.modal(exists ? '编辑设备档案' : '新增检测设备', U.field('设备编号', inputRequired('id', d.id || '', '例如 HY-DG-02', 'text', (exists ? 'readonly ' : '') + 'maxlength="40" pattern="[A-Za-z0-9_-]+"')) + U.field('设备名称', inputRequired('name', d.name || '', '填写设备名称')) + U.field('检测类型', bound ? '<input readonly value="' + E(metric(d.metric).name) + '"><input type="hidden" name="metric" value="' + E(d.metric) + '">' : U.select('metric', metricOptions.slice(1), d.metric || 'dg')) + U.field('产线 / 工位', inputRequired('line', d.line || '', '填写独立工位或产线')) + U.field('校准 / 检查日期', U.input('calibration', dateOnly(d.calibration), '', 'date')) + U.field('连接状态（模拟）', U.select('status', [['online', '在线'], ['offline', '离线']], d.status || 'online')) + U.note('已有测量记录的设备不能修改检测类型。连接状态仅控制本地演示。'), fd => { const id = String(fd.get('id')).trim(); if (!exists && arr('devices').some(item => item.id === id)) throw new Error('设备编号已存在。'); const value = { ...d, id, name: String(fd.get('name')).trim(), metric: fd.get('metric'), line: String(fd.get('line')).trim(), calibration: fd.get('calibration'), status: fd.get('status'), source: d.source || '设备自动采集', lastSeen: d.lastSeen || '2026-10-09 14:30:00' }; if (exists) Object.assign(d, value); else S.state.devices.push(value); writeLog(exists ? '编辑设备档案' : '新增设备', id); U.toast('设备档案已保存。'); });
  }
  H.Actions['device-add'] = () => deviceModal();
  H.Actions['device-edit'] = el => deviceModal(S.device(el.dataset.id));

  H.Pages.connections = function () {
    const c = S.state.connections || {};
    return title('数据接入配置', '配置设备量测数据的本地接入演示与字段映射。', btn('编辑接入配置', 'connection-edit', {}, true, 'settings')) +
      '<div class="grid cols-3">' + U.kpi('接入设备', arr('devices').length, '三类检测设备独立关联', 'plug') + U.kpi('在线设备', arr('devices').filter(d => d.status === 'online').length, '连接状态与数据有效性分别记录', 'wifi', 'green') + U.kpi('当前接入模式', c.protocol || 'HTTP', '本地模拟，无外部连接', 'database') + '</div>' +
      '<div class="split">' + panel('连接配置', info([['接入协议', E(c.protocol || 'HTTP')], ['演示地址', '<code>' + E(c.endpoint || 'http://127.0.0.1:8080/measurements') + '</code>'], ['采样间隔', E(c.interval || c.pollInterval || 1000) + ' ms'], ['心跳超时', E(c.heartbeat || 30) + ' s'], ['自动重连', U.badge(c.autoReconnect !== false ? '已启用' : '已关闭', c.autoReconnect !== false ? 'green' : 'gray')], ['执行环境', U.badge('本地模拟', 'blue')]]) + '<div class="toolbar">' + btn('运行接入自检', 'connection-test', {}, false, 'activity') + link('查看设备档案', 'devices') + '</div>') + panel('采集原则', '<div class="stack">' + ['记录设备编号、任务、工单与盘号，禁止混用检测对象', '保留时间与米数位置，支持跨页面定位同一条记录', '缺失 / 无效量测单独标识，不按零值统计', '平台接收与 MES 确认独立记录'].map((text, i) => '<div class="row" style="align-items:flex-start"><span class="badge blue">0' + (i + 1) + '</span><span>' + E(text) + '</span></div>').join('') + '</div>') + '</div>' +
      panel('量测字段映射', U.table(['平台字段', '设备字段', '格式', '处理约定'], [['record.id', 'record_id', '唯一字符串', '用于幂等接收与追溯'], ['record.taskId / reelId', 'task_id / reel_id', '关联编号', '必须与已登记的任务一致'], ['record.metric', 'metric_code', 'dg / jx / by', '仅接受三项检测'], ['record.time / meter', 'measured_at / meter', '时间 / m', '保留采样顺序与位置'], ['record.value / validity', 'value / validity', '数值 / valid、invalid', '缺失数据不转换成 0'], ['record.ruleSnapshot', '任务关联配方', '版本化规则', '按创建任务时规则判定']])) + U.note('自检只验证本地配置和模拟数据，不会向配置地址发送网络请求。');
  };
  H.Actions['connection-edit'] = () => {
    if (!permit(true)) return;
    const c = S.state.connections || {};
    U.modal('编辑数据接入配置', U.field('接入协议', U.select('protocol', [['HTTP', 'HTTP / JSON'], ['MQTT', 'MQTT'], ['OPC UA', 'OPC UA']], c.protocol || 'HTTP')) + U.field('演示接入地址', inputRequired('endpoint', c.endpoint || 'http://127.0.0.1:8080/measurements', '填写演示地址')) + U.field('采样间隔 / ms', inputRequired('interval', c.interval || c.pollInterval || 1000, '', 'number', 'min="100" max="60000" step="100"')) + U.field('心跳超时 / s', inputRequired('heartbeat', c.heartbeat || 30, '', 'number', 'min="1" max="300"')) + check('autoReconnect', '启用自动重连演示', c.autoReconnect !== false) + U.note('仅保存模拟配置，不连接生产设备或外部服务。'), fd => { S.state.connections = { ...c, protocol: fd.get('protocol'), endpoint: String(fd.get('endpoint')).trim(), interval: Number(fd.get('interval')), pollInterval: Number(fd.get('interval')), heartbeat: Number(fd.get('heartbeat')), autoReconnect: fd.has('autoReconnect') }; writeLog('修改数据接入配置', '本地模拟 · ' + fd.get('protocol')); U.toast('接入配置已保存。'); });
  };
  H.Actions['connection-test'] = () => {
    const devices = arr('devices'), result = devices.map(d => { const rs = arr('records').filter(r => r.deviceId === d.id), latest = rs.slice(-1)[0]; return [E(d.id), E(metric(d.metric).short), U.badge(d.status === 'online' ? '模拟连接正常' : '设备离线', d.status === 'online' ? 'green' : 'red'), latest ? E(latest.id) : '暂无采样', latest ? U.badge(latest.validity === 'valid' ? '字段完整 / 有效' : '已标记无效', latest.validity === 'valid' ? 'green' : 'amber') : U.badge('等待任务数据', 'gray')]; });
    U.drawer('数据接入自检结果', U.note('已检查本地设备状态、关联关系和最近记录。此自检未发起外部网络请求。') + U.table(['设备编号', '检测类型', '连接检查', '最近记录', '数据检查'], result));
  };

  H.Pages.mes = function () {
    const m = S.state.mes || {}, rs = S.currentRecords(), confirmed = rs.filter(r => r.mesStatus === 'confirmed').length;
    return title('MES 接口配置', '管理质量数据推送规则、业务关联字段与接收确认。', btn('编辑 MES 配置', 'mes-edit', {}, true, 'settings')) +
      '<div class="grid cols-3">' + U.kpi('当前窗口确认比例', rs.length ? n(confirmed / rs.length * 100, 0) + '%' : '—', confirmed + ' / ' + rs.length + ' 条记录已确认', 'cloud-upload', 'green') + U.kpi('接口模式', '本地模拟', '不连接生产 MES', 'plug', 'blue') + U.kpi('待同步 / 失败', rs.filter(r => r.mesStatus === 'pending').length + ' / ' + rs.filter(r => r.mesStatus === 'failed').length, '独立于检测任务执行状态', 'refresh', 'amber') + '</div>' +
      '<div class="split">' + panel('接口参数', info([['推送地址', '<code>' + E(m.endpoint || m.url || 'https://mes.example.local/api/quality') + '</code>'], ['接口启用', U.badge(m.enabled !== false ? '演示已启用' : '已停用', m.enabled !== false ? 'green' : 'gray')], ['推送方式', E(m.mode === 'batch' ? '任务批量推送' : '逐条记录推送')], ['请求超时', E(m.timeout || 5000) + ' ms'], ['重试上限', E(m.retries === undefined ? 3 : m.retries) + ' 次'], ['认证模式', '模拟令牌（无真实凭据）']]) + '<div class="toolbar">' + btn('检查接口配置', 'mes-test', {}, false, 'activity') + link('同步监控', 'sync') + '</div>') + panel('交互流程', '<div class="stack">' + [['01', '平台接收', '采样记录进入平台，独立标记数据有效性。'], ['02', '推送量测数据', '使用唯一记录编号关联任务、盘号与规则快照。'], ['03', 'MES 接收确认', '仅收到确认后标为已确认，失败记录可幂等重试。']].map(row => '<div class="row" style="align-items:flex-start"><span class="badge blue">' + row[0] + '</span><div><strong>' + row[1] + '</strong><p class="muted small">' + row[2] + '</p></div></div>').join('') + '</div>') + '</div>' +
      panel('数据推送与确认字段', U.table(['业务含义', '数据字段', '说明'], [['幂等键', 'recordId', '每条记录唯一，不因重试产生重复量测'], ['业务对象', 'taskId / workOrder / reelId', '任务、工单与盘号分别传递'], ['量测结果', 'metric / value / unit / validity', '原始量测值与数据有效性'], ['判定依据', 'ruleSnapshot / judgement', '记录产生时的规则与数值判定'], ['采样位置', 'time / meter', '保留事件时间和米数位置'], ['接收确认', 'platformStatus / mesStatus / confirmedAt', '平台接收与 MES 确认独立追踪']])) + U.note('接口状态不代替检测状态或质量结论。此页面配置只影响本地模拟，未配置或发送真实认证凭据。');
  };
  H.Actions['mes-edit'] = () => {
    if (!permit(true)) return;
    const m = S.state.mes || {};
    U.modal('编辑 MES 接口配置', U.field('演示推送地址', inputRequired('endpoint', m.endpoint || m.url || 'https://mes.example.local/api/quality', '', 'url')) + U.field('推送方式', U.select('mode', [['record', '逐条记录推送'], ['batch', '任务批量推送']], m.mode || 'record')) + U.field('请求超时 / ms', inputRequired('timeout', m.timeout || 5000, '', 'number', 'min="1000" max="60000" step="500"')) + U.field('重试上限', inputRequired('retries', m.retries === undefined ? 3 : m.retries, '', 'number', 'min="0" max="10" step="1"')) + check('enabled', '启用 MES 同步演示', m.enabled !== false) + U.note('演示配置不发起任何外部请求，也不接受真实密钥。'), fd => { const endpoint = String(fd.get('endpoint')).trim(); if (!/^https?:\/\//i.test(endpoint)) throw new Error('演示地址须为 http 或 https 地址。'); S.state.mes = { ...m, endpoint, url: endpoint, mode: fd.get('mode'), timeout: Number(fd.get('timeout')), retries: Number(fd.get('retries')), enabled: fd.has('enabled') }; writeLog('修改 MES 接口配置', '本地模拟配置'); U.toast('MES 配置已保存。'); });
  };
  H.Actions['mes-test'] = () => {
    const m = S.state.mes || {}, endpoint = m.endpoint || m.url || 'https://mes.example.local/api/quality', good = /^https?:\/\//i.test(endpoint), rows = [['地址格式', E(endpoint), U.badge(good ? '格式有效' : '格式无效', good ? 'green' : 'red')], ['运行模式', '本地模拟，不发起外部请求', U.badge('模拟', 'blue')], ['接口开关', m.enabled === false ? '已停用' : '已启用', U.badge(m.enabled === false ? '暂停推送' : '允许模拟推送', m.enabled === false ? 'amber' : 'green')], ['幂等键', 'record.id', U.badge('使用唯一记录编号', 'green')]];
    U.drawer('MES 配置检查', U.table(['检查项', '当前配置', '检查结果'], rows) + '<div style="margin-top:20px">' + U.note('检查结果仅证明本地配置可用于演示，不证明外部 MES 服务可连接。') + '</div>');
  };

  function syncRecords() { const f = filter('sync'); return arr('records').filter(r => (!f.status || r.mesStatus === f.status) && (!f.metric || r.metric === f.metric) && (!f.keyword || [r.id, r.taskId, r.reelId].join(' ').toLowerCase().includes(f.keyword.toLowerCase()))).sort((a, b) => String(b.time).localeCompare(String(a.time))); }
  H.Pages.sync = function () {
    const f = filter('sync'), all = arr('records'), records = syncRecords(), page = U.paginate(records, 'sync', 8);
    return title('MES 同步监控', '逐条追踪平台接收、推送与确认，失败记录支持幂等重试。', btn('重试筛选内未确认记录', 'sync-retry-filtered', {}, true, 'refresh')) +
      '<div class="grid cols-4">' + U.kpi('平台接收', all.filter(r => r.platformStatus === 'received').length, '平台端已接收记录', 'database') + U.kpi('MES 已确认', all.filter(r => r.mesStatus === 'confirmed').length, '已确认记录重试不会重复写入', 'cloud-check', 'green') + U.kpi('待同步', all.filter(r => r.mesStatus === 'pending').length, '保留业务对象关联', 'clock', 'amber') + U.kpi('同步失败', all.filter(r => r.mesStatus === 'failed').length, '可手动执行模拟重试', 'alert-triangle', 'red') + '</div>' +
      U.filterForm('sync', U.field('记录 / 任务 / 盘号', U.input('keyword', f.keyword, '输入记录编号、任务或盘号')) + U.field('检测项目', metricSelect('metric', f.metric)) + U.field('MES 状态', U.select('status', [['', '全部状态'], ['confirmed', '已确认'], ['pending', '待同步'], ['failed', '同步失败']], f.status)), formButtons()) +
      panel('同步记录', U.table(['记录编号 / 时间', '任务 / 盘号', '检测项目', '实测值', '平台接收', 'MES 状态', '确认时间', '操作'], page.items.map(r => [E(r.id) + '<div class="small muted">' + displayTime(r.time) + '</div>', link(r.taskId, 'task?id=' + encodeURIComponent(r.taskId)) + '<div class="small muted">' + E(r.reelId) + '</div>', E(metric(r.metric).short), measurement(r.value, r.metric) + ' ' + E(metric(r.metric).unit), U.badge(r.platformStatus === 'received' ? '已接收' : '待接收', r.platformStatus === 'received' ? 'blue' : 'gray'), mesState(r.mesStatus), displayTime(r.confirmedAt), r.mesStatus !== 'confirmed' ? btn('重试', 'sync-retry', { id: r.id }, false, 'refresh') : '<span class="small muted">已确认</span>'])) + page.footer, '<span class="muted small">' + records.length + ' 条记录</span>') + U.note('重试只更新同步状态，不会改变原始量测值、数据有效性、规则快照或报警处理状态。');
  };
  function retry(ids) {
    if (!permit()) return;
    if (S.state.mes && S.state.mes.enabled === false) { U.toast('MES 同步演示已停用，请先在接口配置中启用。'); return; }
    if (!ids.length) { U.toast('筛选范围内没有待重试记录。'); return; }
    const result = S.retrySync(ids); H.render(); U.toast('模拟重试完成：确认 ' + (result.count || 0) + ' 条，失败 ' + (result.failed || 0) + ' 条，待同步 ' + (result.pending || 0) + ' 条。');
  }
  H.Actions['sync-retry'] = el => retry([el.dataset.id]);
  H.Actions['sync-retry-filtered'] = () => retry(syncRecords().filter(r => r.mesStatus !== 'confirmed').map(r => r.id));

  H.Pages.users = function () {
    const f = filter('users'), users = arr('users').filter(u => (!f.role || u.role === f.role) && (!f.keyword || [u.name, u.account, u.username, u.id].join(' ').toLowerCase().includes(f.keyword.toLowerCase())));
    return title('用户角色与权限', '三个演示角色分级使用本地平台；用户配置与操作审计关联。', btn('新增用户', 'user-add', {}, true, 'user-plus')) +
      '<div class="grid cols-3">' + [['admin', 'settings', 'blue', '设备与接口、系统配置、用户管理及全部质量操作'], ['quality', 'shield-check', 'green', '检测任务、异常复核、规则配置与质量报告'], ['viewer', 'eye', 'gray', '查看全部演示数据、查询、打印与导出']].map(row => panel(roles[row[0]], '<div class="row"><span class="badge ' + row[2] + '">' + U.icon(row[1], 23) + '</span><strong style="font-size:30px">' + arr('users').filter(u => u.role === row[0]).length + '</strong><span class="muted small">名用户</span></div><p class="muted small">' + row[3] + '</p>')).join('') + '</div>' +
      U.filterForm('users', U.field('姓名 / 账号', U.input('keyword', f.keyword, '输入用户姓名或账号')) + U.field('角色', U.select('role', [['', '全部角色'], ...Object.entries(roles)], f.role)), formButtons()) +
      panel('用户列表', U.table(['姓名', '登录账号', '角色', '状态', '最近使用', '操作'], users.map(u => [E(u.name), E(u.account || u.username || u.id), U.badge(roles[u.role] || u.role, u.role === 'admin' ? 'blue' : u.role === 'quality' ? 'green' : 'gray'), U.badge(u.enabled !== false ? '已启用' : '已停用', u.enabled !== false ? 'green' : 'gray'), displayTime(u.lastLogin), btn('编辑用户', 'user-edit', { id: u.id }, false, 'edit')]))) + U.note('当前身份：' + (H.currentUser && H.currentUser.name || '演示用户') + ' · ' + (roles[H.currentUser && H.currentUser.role] || '未登录') + '。此处为本地原型权限，用户数据不构成真实身份认证。');
  };
  function userModal(user) {
    if (!permit(true)) return;
    const exists = !!user; user = user || {};
    U.modal(exists ? '编辑演示用户' : '新增演示用户', U.field('姓名', inputRequired('name', user.name || '', '填写用户姓名')) + U.field('登录账号', inputRequired('account', user.account || user.username || '', '例如 inspector01', 'text', 'pattern="[A-Za-z0-9_.-]{3,40}"')) + U.field('角色', U.select('role', Object.entries(roles), user.role || 'quality')) + U.field('启用状态', U.select('enabled', [['true', '启用'], ['false', '停用']], user.enabled !== false ? 'true' : 'false')) + U.note('演示登录由页面选择角色，不设置或存储真实用户密码。'), fd => { const account = String(fd.get('account')).trim(), role = fd.get('role'), enabled = fd.get('enabled') === 'true'; if (arr('users').some(u => u.id !== user.id && (u.account || u.username) === account)) throw new Error('该账号已经存在。'); if (exists && user.role === 'admin' && user.enabled !== false && (role !== 'admin' || !enabled) && arr('users').filter(u => u.role === 'admin' && u.enabled !== false).length <= 1) throw new Error('至少保留一位启用的系统管理员。'); if (H.currentUser && user.id === H.currentUser.id && !enabled) throw new Error('当前会话用户不能停用自己。'); const value = { ...user, id: user.id || S.id('U'), name: String(fd.get('name')).trim(), account, username: account, role, enabled }; if (exists) Object.assign(user, value); else S.state.users.push(value); if (H.currentUser && value.id === H.currentUser.id) { H.currentUser = { ...H.currentUser, name: value.name, role: value.role }; sessionStorage.setItem('hy-session-v1', JSON.stringify(H.currentUser)); } writeLog(exists ? '修改用户与角色' : '新增演示用户', account + ' · ' + roles[role]); U.toast('用户配置已保存。'); });
  }
  H.Actions['user-add'] = () => userModal();
  H.Actions['user-edit'] = el => userModal(arr('users').find(u => u.id === el.dataset.id));

  function auditRows() { const f = filter('audit'); return arr('audits').filter(a => (!f.keyword || [a.action, a.detail, a.actor, a.user].join(' ').toLowerCase().includes(f.keyword.toLowerCase())) && (!f.from || dateOnly(a.time || a.createdAt) >= f.from) && (!f.to || dateOnly(a.time || a.createdAt) <= f.to)).slice().sort((a, b) => String(b.time || b.createdAt).localeCompare(String(a.time || a.createdAt))); }
  H.Pages.audit = function () {
    const f = filter('audit'), rows = auditRows(), page = U.paginate(rows, 'audit', 10);
    return title('操作审计', '追溯任务、配方、复核、报告与系统配置的本地操作。', btn('导出审计记录', 'audit-export', {}, false, 'download')) +
      U.filterForm('audit', U.field('操作 / 操作人', U.input('keyword', f.keyword, '输入动作、内容或操作人')) + U.field('开始日期', U.input('from', f.from || '', '', 'date')) + U.field('结束日期', U.input('to', f.to || '', '', 'date')), formButtons()) +
      panel('审计日志', U.table(['时间', '操作人', '操作类型', '操作内容', '记录编号'], page.items.map(a => [displayTime(a.time || a.createdAt), E(a.actor || a.user || '系统'), U.badge(a.action || '系统操作', 'blue'), E(typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail), '<span class="small muted">' + E(a.id) + '</span>'])) + page.footer, '<span class="muted small">查询结果 ' + rows.length + ' 条</span>') + U.note('审计记录保存在当前浏览器。恢复初始演示数据会重置本地记录，不影响项目源码与图片素材。');
  };
  H.Actions['audit-export'] = () => U.downloadFile('慧眼智检-操作审计.csv', rawCSV(auditRows(), [['时间', a => a.time || a.createdAt], ['操作人', a => a.actor || a.user || '系统'], ['操作类型', a => a.action], ['操作内容', a => typeof a.detail === 'object' ? JSON.stringify(a.detail) : a.detail], ['记录编号', a => a.id]]), 'text/csv;charset=utf-8');

  H.Pages.settings = function () {
    const s = S.state.settings || {}, rs = arr('records'), stats = S.stats(rs), scenario = s.scenario || S.state.scenario || 'normal', scenarioNames = { normal: '正常演示', offline: '设备离线', invalid: '无效量测', 'mes-failure': 'MES 同步失败' };
    return title('系统设置与运行状态', '设置本地演示偏好、检查数据状态并切换验收场景。', btn('编辑系统设置', 'settings-edit', {}, true, 'settings')) +
      '<div class="grid cols-4">' + U.kpi('运行环境', '本地原型', 'HTML · CSS · JavaScript', 'browser') + U.kpi('当前场景', scenarioNames[scenario] || '正常演示', '可通过下方卡片切换', 'activity', 'blue') + U.kpi('数据有效性', stats.invalid + ' 条无效', stats.valid + ' 条有效记录', 'database', stats.invalid ? 'amber' : 'green') + U.kpi('存储方式', S.memoryOnly ? '内存模式' : '浏览器本地', S.memoryOnly ? '当前浏览器存储不可用，关闭后不保留' : '刷新后保留演示修改', 'device-floppy', 'green') + '</div>' +
      '<div class="split">' + panel('平台设置', info([['平台名称', E(s.platformName || '慧眼智检 · 线缆质量管控平台')], ['所属机构', E(s.organization || s.company || '山东沉积岩信息科技有限公司')], ['回放刷新间隔', E(s.refreshInterval || 5) + ' 秒'], ['默认分页大小', E(s.pageSize || 8) + ' 条 / 页'], ['数据范围', '35–220 kV 高压电缆'], ['检测范围', '搭盖率 / 铜丝间隙 / 不圆度']])) + panel('运行检查', '<div class="stack">' + [['本地数据仓库', U.badge('可用', 'green')], ['登记检测设备', arr('devices').length + ' 台'], ['在线设备', arr('devices').filter(d => d.status === 'online').length + ' 台'], ['MES 未确认记录', rs.filter(r => r.mesStatus !== 'confirmed').length + ' 条'], ['未完成复核事件', arr('alarms').filter(a => a.status !== 'resolved').length + ' 条']].map(row => '<div class="row" style="padding:9px 0;border-bottom:1px solid #eef2f7"><span class="muted">' + row[0] + '</span><span class="spacer"></span><strong>' + row[1] + '</strong></div>').join('') + '</div>') + '</div>' +
      panel('演示场景', '<div class="grid cols-4">' + [['normal', '正常演示', '恢复设备在线；已产生的无效和失败记录保留，可继续复核或重试。', 'shield-check', 'green'], ['offline', '设备离线', '模拟检测设备离线，检查连接状态与量测状态的区别。', 'wifi-off', 'amber'], ['invalid', '无效量测', '添加无效量测，验证缺失值不按零值进入统计。', 'database-off', 'amber'], ['mes-failure', 'MES 同步失败', '产生待重试记录，验证数值判定与同步状态独立。', 'cloud-off', 'red']].map(item => '<div style="padding:20px;border:1px solid #e7edf5;border-radius:8px"><span class="badge ' + item[4] + '">' + U.icon(item[3], 22) + '</span><h3>' + item[1] + '</h3><p class="muted small" style="min-height:58px">' + item[2] + '</p>' + btn(scenario === item[0] ? '重新应用' : '切换场景', 'scenario-set', { name: item[0] }, scenario === item[0]) + '</div>').join('') + '</div>') +
      panel('演示数据管理', '<div class="row" style="flex-wrap:wrap"><div><strong>恢复初始演示数据</strong><p class="muted small">恢复 12 个任务、3 台设备、当前窗口 90 条有效记录与初始配置。清除当前浏览器的演示修改。</p></div><span class="spacer"></span>' + btn('恢复初始数据', 'settings-reset', {}, false, 'restore') + '</div>') + U.note('所有连接、账户和数据均为本地演示。设备离线不会改写历史测量，MES 故障不会自动变更质量判定。');
  };
  H.Actions['settings-edit'] = () => {
    if (!permit(true)) return;
    const s = S.state.settings || {};
    U.modal('编辑系统设置', U.field('平台名称', inputRequired('platformName', s.platformName || '慧眼智检 · 线缆质量管控平台', '填写平台名称')) + U.field('所属机构', inputRequired('organization', s.organization || s.company || '山东沉积岩信息科技有限公司', '填写机构名称')) + U.field('回放刷新间隔 / 秒', U.select('refreshInterval', [[2, '2 秒'], [5, '5 秒'], [10, '10 秒'], [30, '30 秒']], s.refreshInterval || 5)) + U.field('默认分页大小', U.select('pageSize', [[8, '8 条'], [10, '10 条'], [20, '20 条']], s.pageSize || 8)), fd => { S.state.settings = { ...s, platformName: String(fd.get('platformName')).trim(), organization: String(fd.get('organization')).trim(), company: String(fd.get('organization')).trim(), refreshInterval: Number(fd.get('refreshInterval')), pageSize: Number(fd.get('pageSize')) }; writeLog('修改系统设置', '平台名称、机构与演示偏好'); U.toast('系统设置已保存。'); });
  };
  H.Actions['scenario-set'] = el => { if (!permit(true)) return; S.setScenario(el.dataset.name); S.state.settings = S.state.settings || {}; S.state.settings.scenario = el.dataset.name; S.save(); H.render(); U.toast('已应用演示场景，可查看监控、历史数据及同步状态。'); };
  H.Actions['settings-reset'] = () => {
    if (!permit(true)) return;
    U.modal('恢复初始演示数据', U.note('当前浏览器中新建的任务、导入的数据、报警处置、报告与配置修改将被清除。项目源码和图片素材保留。', 'amber') + '<p>恢复后可以重新从初始场景演示全部流程。</p>' + check('confirmReset', '我已确认恢复初始演示数据', false), fd => { if (!fd.has('confirmReset')) throw new Error('请勾选确认后再恢复。'); S.reset(); H.navigate('dashboard'); H.render(); U.toast('已恢复初始演示数据。'); }, '确认恢复');
  };
})();
