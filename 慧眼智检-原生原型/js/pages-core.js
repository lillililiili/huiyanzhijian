(function () {
  'use strict';
  const H = window.HY, S = H.Store, U = Object.create(H.UI);
  // Core views own their content spacing; the shared panel stays unchanged.
  U.panel = (title, body, tools = '', cls = '') => H.UI.panel(title, `<div class="panel-body core-panel-body ${String(body).startsWith('<div class="table-wrap">') ? 'core-panel-table' : ''}">${body}</div>`, tools, `core-panel ${cls}`);
  const P = H.Pages, A = H.Actions;
  const E = U.esc;
  const hero = (value, unit = '', tone = '') => `<div class="metric-hero ${E(tone)}"><strong>${value}<small>${E(unit)}</small></strong></div>`;
  H.filters = H.filters || {};
  const metric = key => S.metrics[key] || S.metrics.dg;
  const newest = rows => rows.slice().sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
  const latest = rows => newest(rows)[0];
  const number = (value, digits = 2) => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : U.fmt(value, digits);
  const thresholdNumber = value => value === null || value === undefined || !Number.isFinite(Number(value)) ? '—' : String(Number(value));
  const labelRule = (m, rule) => `${(rule || m).operator === '>=' ? '≥' : '≤'} ${thresholdNumber((rule || m).threshold)} ${m.unit}`;
  const specLabel = spec => spec ? `${spec.voltage}kV · ${spec.cores || 1}×${spec.area}mm²` : '—';
  const taskLink = task => task ? U.link(task.id, `task?id=${encodeURIComponent(task.id)}`) : '—';
  const reelLink = reel => U.link(reel, `trace?reel=${encodeURIComponent(reel)}`);
  const info = (label, value) => `<div class="meta-item"><span class="muted small">${E(label)}</span><div>${value}</div></div>`;
  const action = (text, name, data, primary = false, icon = '') => U.button(text, `core-${name}`, data || {}, primary, icon);
  const field = (name, label, value = '', placeholder = '', type = 'text') => U.field(label, U.input(name, value, placeholder, type));
  const select = (name, label, options, value = '') => U.field(label, U.select(name, options, value));
  const status = value => U.status(value);
  const taskStatus = value => value === 'pending' ? U.badge('待开始','gray') : status(value);
  const detectionLink = task => `detection?metric=${task.metric}&task=${encodeURIComponent(task.id)}`;
  function detectionRows(task) {
    if (!task) return [];
    const records = S.recordsFor(task.id).slice().sort((a,b)=>a.time.localeCompare(b.time));
    if (!records.length) return [];
    const end = records[records.length-1].time;
    const start = new Date(Date.parse(end.replace(' ','T')+'Z')-29*60000).toISOString().slice(0,19).replace('T',' ');
    return records.filter(r=>r.time>=start&&r.time<=end);
  }
  function detectionContext() {
    const requested=H.params.get('task'),fallbackMetric=metric(H.params.get('metric')||'dg');
    const task=requested?S.task(requested):S.state.tasks.find(t=>t.metric===fallbackMetric.id&&t.status==='running')||S.state.tasks.filter(t=>t.metric===fallbackMetric.id).slice().sort((a,b)=>String(b.startAt||b.createdAt||'').localeCompare(String(a.startAt||a.createdAt||'')))[0];
    return {task,metric:task?metric(task.metric):fallbackMetric,records:detectionRows(task),missing:!!requested&&!task};
  }
  const timeOnly = value => String(value || '').slice(11, 19) || '—';
  const meta = items => `<div class="metrics-strip core-metadata">${items.map(([l,v]) => info(l,v)).join('')}</div>`;
  const render = () => H.render();
  const formValues = fd => Object.fromEntries(fd.entries());
  const requiredInput = (name, value = '', type = 'text', extra = '') => `<input name="${E(name)}" type="${E(type)}" value="${E(value)}" required ${extra}>`;
  const filters = id => H.filters[id] || {};
  const reportAction = task => {
    const pending = S.state.alarms.find(a => a.taskId === task.id && a.status !== 'resolved');
    return task.status === 'completed' && pending ? U.link('先复核异常', `alarm?id=${encodeURIComponent(pending.id)}`) : action(task.status === 'completed' ? '生成最终报告' : '预览阶段报告', 'report', {id:task.id},false,'file-text');
  };
  function taskRows(rows) {
    return rows.map(t => [taskLink(t), reelLink(t.reelId), `${E((S.spec(t.specId) || {}).voltage || '—')}kV`, E(specLabel(S.spec(t.specId)).split(' · ')[1] || '—'), E(metric(t.metric).name), E(t.deviceId), taskStatus(t.status), taskSync(t), timeOnly(t.startAt), U.link('查看', `task?id=${encodeURIComponent(t.id)}`)]);
  }
  function taskSync(t) {
    const rows = S.recordsFor(t.id);
    if (!rows.length) return U.badge('待采集', 'gray');
    if (rows.some(r => r.mesStatus === 'failed')) return U.badge('同步失败', 'red');
    if (rows.some(r => r.mesStatus !== 'confirmed')) return U.badge('同步中', 'blue');
    return U.badge(t.status === 'running' ? '同步中' : '已确认', t.status === 'running' ? 'blue' : 'green');
  }
  function lineHeader(m, last, stats) {
    return `<div class="row core-metric-summary"><div>${hero(U.metricFmt(last && last.value,m.id),m.unit)}<div class="muted small">${E(m.short || m.name)} ${E(labelRule(m, last && last.ruleSnapshot))}</div></div><div class="spacer"></div><div class="stack" style="gap:10px;align-items:flex-end">${last ? status(last.judgement) : U.badge('暂无数据','gray')}<span class="muted small">${E(last && last.deviceId || '—')} · ${stats.valid} 条有效记录</span></div></div>`;
  }
  function metricCard(key, rows, small) {
    const m = metric(key), last = latest(rows), stats = S.stats(rows);
    return U.panel(m.name, `${small ? '' : lineHeader(m, last, stats)}${U.chart(key, rows, {height:small ? 150 : 215,mini:!!small})}`, U.link('查看检测 ›', last ? detectionLink(S.task(last.taskId)) : `detection?metric=${key}`), 'metric-panel');
  }
  function recordsTable(rows, compact) {
    if (!rows.length) return U.empty('当前条件下没有检测记录');
    return U.table(compact ? ['时间','米数位置 / m','实测值','当时判定规则','数值判定','MES状态','操作'] : ['时间','盘号','电压等级','检测项目','实测值','当时判定阈值','数值判定','数据来源','MES状态','操作'], rows.map(r => {
      const m = metric(r.metric), task = S.task(r.taskId), sp = task && S.spec(task.specId);
      const value = r.validity === 'valid' ? `${U.metricFmt(r.value,r.metric)} ${E(m.unit)}` : '—';
      const shared = [E(labelRule(m,r.ruleSnapshot)),status(r.judgement)];
      return compact ? [E(timeOnly(r.time)),number(r.meter,1),value,...shared,status(r.mesStatus),U.button('查看','record-view',{id:r.id})] : [E(timeOnly(r.time)),reelLink(r.reelId),sp ? `${sp.voltage}kV` : '—',E(m.name),value,...shared,E(r.source || '设备自动采集'),status(r.mesStatus),U.button('查看','record-view',{id:r.id})];
    }));
  }

  P.dashboard = () => {
    const rows = S.currentRecords(), stats = S.stats(rows), active = S.state.tasks.filter(t => t.status === 'running'), pending = S.state.alarms.filter(a => a.status !== 'resolved'), alarms = S.state.alarms.filter(a => active.some(t => t.id === a.taskId));
    const online = S.state.devices.filter(d => d.status === 'online').length, received = rows.filter(r => r.platformStatus === 'received').length, synced = rows.filter(r => r.mesStatus === 'confirmed').length, last = latest(rows);
    const kpis = [U.kpi('今日检测任务',S.state.tasks.length,`检测中 ${active.length} · 已完成 ${S.state.tasks.filter(t=>t.status==='completed').length}`,'clipboard'),U.kpi('在线检测设备',`${online} <small>/ ${S.state.devices.length}</small>`,'三款设备连接状态','monitor','green'),U.kpi('当前任务超限事件',alarms.length,'原始超限记录持续保留','bell','red'),U.kpi('待复核事件',pending.length,'恢复正常后仍需人工复核','shield','amber'),U.kpi('MES记录同步',`${stats.total ? number(synced / stats.total * 100,0) : '0'} <small>%</small>`,`当前窗口 ${synced} / ${stats.total} 条`,'cloud-upload')];
    const pendingCard = pending.length ? pending.slice(0,2).map(a => {
      const r = S.record(a.recordId);
      return `<div class="todo-item row"><div class="stat-icon red">${U.icon('bell')}</div><div class="stack" style="gap:6px"><strong>${U.link(metric(a.metric).short + (a.metric === 'dg' ? '低于控制下限' : '超过控制上限'),`alarm?id=${encodeURIComponent(a.id)}`)}</strong><span class="muted small">${E(r && r.reelId || '')} · ${E(timeOnly(a.createdAt))} · ${U.metricFmt(r && r.value,a.metric)} ${E(metric(a.metric).unit)}</span></div><div class="spacer"></div>${status(a.status)}</div>`;
    }).join('') : `<div class="todo-item row"><div class="stat-icon green">${U.icon('shield-check')}</div><strong>当前没有待复核事件</strong>${U.badge('已处理','green')}</div>`;
    const todo = `${pendingCard}<div class="key-value"><span>已处理超限事件</span><span>${S.state.alarms.filter(a=>a.status==='resolved').length} 项</span></div><div class="key-value"><span>平台接收当前窗口记录</span><span>${received} / ${stats.total} 条</span></div><div class="key-value"><span>MES确认接收记录</span><span class="text-green">${synced} / ${stats.total} 条</span></div><p class="muted small">检测状态、数据判定和 MES 接收状态分别记录。</p>`;
    const taskTable = U.table(['任务编号','检测项目','规格','盘号','任务状态','操作'], active.slice(0,4).map(t=>[taskLink(t),E(metric(t.metric).name),E(specLabel(S.spec(t.specId))),reelLink(t.reelId),taskStatus(t.status),U.link('进入检测',detectionLink(t))]));
    return U.title('工作台首页','35–220kV高压电缆 · 三项检测运行概况与待办事项',U.badge(`数据更新 ${timeOnly(last && last.time)}`,'blue')) + `<div class="grid cols-5">${kpis.join('')}</div><div class="grid cols-3">${['dg','jx','by'].map(k=>{const task=active.find(t=>t.metric===k);return metricCard(k,task?detectionRows(task):rows.filter(r=>r.metric===k));}).join('')}</div><div class="split">${U.panel('当前检测任务',taskTable,U.link('全部任务 →','tasks'))}${U.panel('待办与同步状态',todo,U.link('查看报警','alarms'))}</div>` + U.note('当前值符合阈值不代表整盘最终合格；过程超限保留原始记录，完成复核后形成质量结论。');
  };

  P.monitor = () => {
    const f=filters('monitor'), devices=S.state.devices.filter(d=>(!f.line||d.line===f.line)&&(!f.metric||d.metric===f.metric)&&(!f.status||d.status===f.status));
    const form = select('line','产线',[['','全部产线'],...Array.from(new Set(S.state.devices.map(d=>d.line))).map(x=>[x,x])],f.line) + select('metric','设备类型',[['','全部三类设备'],...Object.values(S.metrics).map(m=>[m.id,m.name])],f.metric) + select('status','连接状态',[['','全部状态'],['online','在线'],['offline','离线']],f.status);
    const cards=devices.map(d=>{
      const m=metric(d.metric),t=S.state.tasks.find(t=>t.deviceId===d.id&&t.status==='running'),r=latest(detectionRows(t));
      return U.panel(m.name,`<div class="device-visual"><img src="assets/images/device-${d.metric}.png" alt="${E(d.name)}"><div><p class="muted small">当前量测值</p>${hero(U.metricFmt(r&&r.value,m.id),m.unit)}${r?status(r.judgement):U.badge('暂无数据','gray')}<p class="muted small">${E(labelRule(m,r&&r.ruleSnapshot))}</p></div></div><div class="detail-grid">${info('设备编号',E(d.id))}${info('电压等级',t?`${E((S.spec(t.specId)||{}).voltage)}kV`:'—')}${info('当前盘号',t?reelLink(t.reelId):'—')}${info('任务状态',t?taskStatus(t.status):U.badge('空闲','gray'))}</div>`,`${status(d.status)} ${U.link('进入检测 ›',t?detectionLink(t):`detection?metric=${d.metric}`)}`,'monitor-card');
    });
    const recent=newest(S.currentRecords()).filter(r=>devices.some(d=>d.id===r.deviceId)).slice(0,6);
    return U.title('产线与设备实时总览','各工位独立检测；不同设备的检测对象与任务分别关联。',U.badge(`${S.state.devices.filter(d=>d.status==='online').length} 台在线 · ${S.state.devices.filter(d=>d.status==='offline').length} 台离线`,'green'))+U.filterForm('monitor',form)+`<div class="grid cols-3">${cards.join('')||U.empty('没有匹配的设备')}</div>`+U.panel('最近数据更新',U.table(['更新时间','设备编号','检测项目','盘号','实测值','数据有效性','MES状态'],recent.map(r=>[E(timeOnly(r.time)),E(r.deviceId),U.link(metric(r.metric).name,detectionLink(S.task(r.taskId))),reelLink(r.reelId),`${U.metricFmt(r.value,r.metric)} ${metric(r.metric).unit}`,status(r.validity),status(r.mesStatus)])),`<span class="muted small">当前 ${devices.length} 台设备 · ${recent.length} 条最新记录</span>`)+`<p class="muted small">设备外形参考产品手册；此图不表示三款设备安装在同一条产线上。</p>`;
  };

  const playback = {};
  P.detection = () => {
    const contextState=detectionContext();
    if(contextState.missing)return U.title('检测任务不存在','请从检测任务列表选择有效任务。',U.link('返回任务列表','tasks'))+U.empty('未找到指定检测任务');
    const m=contextState.metric,t=contextState.task,all=contextState.records,p=t?playback[t.id]:null,rows=p&&p.cursor?all.slice(0,p.cursor):all,last=latest(rows),stats=S.stats(rows),device=t?S.device(t.deviceId):null;
    const related=S.state.alarms.filter(a=>a.taskId===(t&&t.id)), f=filters(`axis-${m.id}`), rule=last&&last.ruleSnapshot||t&&t.ruleSnapshot||m;
    const names={dg:['当前搭盖率','搭盖率实时趋势','铜带搭盖率量测示意'],jx:['当前平均间隙','平均间隙实时趋势','相邻铜丝间隙量测示意'],by:['当前不圆度','不圆度实时趋势','双向测径示意']};
    const title=names[m.id];
    const kpis=[U.kpi(title[0],`${U.metricFmt(last&&last.value,m.id)}<small> ${m.unit}</small>`,last&&last.judgement==='pass'?'当前值符合阈值':last&&last.judgement==='fail'?'当前值超出阈值':'等待有效记录','target'),U.kpi('本窗口最小值',`${U.metricFmt(stats.min,m.id)}<small> ${m.unit}</small>`,'按当前有效数据统计','chart-line','green'),U.kpi('本窗口最大值',`${U.metricFmt(stats.max,m.id)}<small> ${m.unit}</small>`,`${stats.valid} 条有效量测记录`,'chart-line'),U.kpi('本窗口平均值',`${U.metricFmt(stats.avg,m.id)}<small> ${m.unit}</small>`,'无效记录不参与统计','database'),U.kpi('控制阈值',E(labelRule(m,rule)),'按任务关联的演示规则','shield-check','green')];
    const context=meta([['执行设备',E(t&&t.deviceId||'—')],['任务编号',taskLink(t)],['工单号',E(t&&t.workOrder||'—')],['当前盘号',t?reelLink(t.reelId):'—'],['高压电缆规格',E(specLabel(t&&S.spec(t.specId)))],['数据时间',E(timeOnly(last&&last.time))]]);
    const tools=`<div class="toolbar">${action('最近30分钟','axis',{metric:m.id,axis:'time'},f.axis!=='meter')}${action('按米数','axis',{metric:m.id,axis:'meter'},f.axis==='meter')}${all.length?action(p&&p.playing?'暂停回放':p&&p.cursor?'继续回放':'检测回放','replay',{metric:m.id,task:t.id},false,p&&p.playing?'pause':'player-play'):''}${p&&p.cursor?action('回到当前','live',{metric:m.id,task:t.id}):''}</div>`;
    const alarmBody=related.length?related.map(a=>{
      const r=S.record(a.recordId);
      return `<div class="alarm-summary"><div class="row"><strong>${U.link(`${timeOnly(a.createdAt)} · ${m.short}${m.id==='dg'?'低于下限':'超过上限'}`,`alarm?id=${encodeURIComponent(a.id)}`)}</strong><div class="spacer"></div>${status(a.status)}</div><p class="muted small">${number(r&&r.meter,1)} m · 实测 ${U.metricFmt(r&&r.value,m.id)} ${m.unit} · ${E(labelRule(m,r&&r.ruleSnapshot))}</p></div>`;
    }).join(''):`<div class="row todo-item"><div class="stat-icon green">${U.icon('shield-check')}</div><div><strong>本窗口无${E(m.short)}超限事件</strong><p class="muted small">${stats.valid} 条有效记录 · ${E(labelRule(m,rule))}</p></div></div>`;
    const sync=`${alarmBody}<div class="key-value"><span>原始超限记录</span><span>保留，不覆盖</span></div><div class="key-value"><span>最近 MES 确认</span><span>${E(timeOnly(latest(rows.filter(r=>r.mesStatus==='confirmed'))?.time))}</span></div>`;
    return U.title(m.name+'检测',m.id==='by'?'不圆度结果展示；外径为本项检测的辅助数据':m.id==='jx'?'铜丝屏蔽相邻铜丝间隙实时量测与平均统计':'金属屏蔽搭盖率实时量测、过程趋势与质量追溯',device&&device.status==='online'?U.badge('设备在线 · '+(last&&last.validity==='valid'?'数据有效':'等待数据'),'green'):U.badge('设备离线','gray'))+context+`<div class="grid cols-5">${kpis.join('')}</div><div class="split">${U.panel(title[1],U.chart(m.id,rows,{height:290,axis:f.axis||'time'}),tools)}${U.panel(title[2],last?U.inspection(last):U.empty('暂无量测记录'),'<span class="muted small">非现场图像</span>')}</div><div class="split">${U.panel('检测明细记录',recordsTable(newest(rows).slice(0,4),true),U.link('历史数据 →',`history?metric=${m.id}`))}${U.panel('报警与同步状态',sync)}</div>`;
  };
  A['core-axis']=el=>{H.filters[`axis-${el.dataset.metric}`]={axis:el.dataset.axis};render();};
  A['core-replay']=el=>{
    const contextState=detectionContext(),taskId=el.dataset.task||contextState.task?.id;
    if(!taskId||!contextState.task||contextState.task.id!==taskId||!contextState.records.length){U.toast('该任务暂无可回放的量测记录');return;}
    const p=playback[taskId]||(playback[taskId]={cursor:1,playing:false});
    if(p.playing){p.playing=false;clearInterval(p.timer);render();return;}
    if(p.cursor>=contextState.records.length)p.cursor=1;
    p.playing=true;
    p.timer=setInterval(()=>{const current=detectionContext();if(H.route!=='detection'||current.task?.id!==taskId){p.playing=false;clearInterval(p.timer);return;}p.cursor++;if(p.cursor>=current.records.length){p.playing=false;clearInterval(p.timer);}render();},Math.max(1,Number(S.state.settings.refreshInterval)||5)*1000);render();
  };
  A['core-live']=el=>{const taskId=el.dataset.task||detectionContext().task?.id,p=playback[taskId];if(p)clearInterval(p.timer);delete playback[taskId];render();};

  P.tasks = () => {
    const f=filters('tasks'),rows=S.state.tasks.filter(t=>(!f.query||`${t.id} ${t.reelId} ${t.workOrder}`.toLowerCase().includes(f.query.toLowerCase()))&&(!f.metric||t.metric===f.metric)&&(!f.status||t.status===f.status)&&(!f.date||String(t.startAt||'').startsWith(f.date)));
    const pg=U.paginate(rows,'tasks',8);
    const form=field('query','工单 / 盘号',f.query,'输入工单号或盘号')+select('metric','检测项目',[['','全部检测项目'],...Object.values(S.metrics).map(m=>[m.id,m.name])],f.metric)+select('status','任务状态',[['','全部状态'],['pending','待开始'],['running','检测中'],['completed','已完成']],f.status)+field('date','日期',f.date||'','','date');
    return U.title('检测任务列表','按工单、盘号、检测项目管理任务；任务执行与 MES 同步状态分别展示。',action('新建检测任务','task-new',{},true,'plus'))+U.filterForm('tasks',form)+`<div class="grid cols-4">${U.kpi('今日任务总数',S.state.tasks.length,'仅三类检测任务','clipboard')}${U.kpi('检测中',S.state.tasks.filter(t=>t.status==='running').length,'当前正在执行的任务','player-play')}${U.kpi('已完成',S.state.tasks.filter(t=>t.status==='completed').length,'完成状态不替代质量结论','check','green')}${U.kpi('待复核过程异常',S.state.alarms.filter(a=>a.status!=='resolved').length,'独立于任务执行状态','bell','amber')}</div>`+U.panel('任务记录',(rows.length?U.table(['任务编号','盘号','电压等级','电缆规格','检测项目','执行设备','执行状态','MES状态','开始时间','操作'],taskRows(pg.items)):U.empty('没有匹配的检测任务'))+pg.footer,`<span class="muted small">共 ${rows.length} 项 · 当前显示 ${pg.items.length} 项</span>`)+U.note('每个任务只关联实际适用的检测项目，不默认每一种规格都同时开展三项检测。');
  };

  A['core-task-new']=()=>{
    const specs=S.state.specs.filter(s=>s.enabled), devices=S.state.devices, recipes=S.state.recipes.filter(r=>r.enabled);
    const body=`<div class="grid cols-2">${U.field('工单号',requiredInput('workOrder',`WO${Date.now().toString().slice(-10)}`))}${U.field('盘号',requiredInput('reelId',`P${Date.now().toString().slice(-10)}`))}${select('specId','产品规格',specs.map(s=>[s.id,`${s.id} · ${specLabel(s)}`]))}${select('metric','检测项目',Object.values(S.metrics).map(m=>[m.id,m.name]))}${select('deviceId','执行设备',devices.map(d=>[d.id,`${d.id} · ${metric(d.metric).short}`]))}${select('recipeId','检测配方',recipes.map(r=>[r.id,`${r.name} · V${r.version}`]))}${U.field('计划检测长度 / m',requiredInput('plannedLength','2000','number','min="0.1" step="0.1"'))}</div>${U.note('规格、检测项目、设备与配方必须匹配。创建后可在任务详情开始检测；设备同一时间仅执行一个任务。')}`;
    U.modal('新建检测任务',body,fd=>{const t=S.createTask({...formValues(fd),plannedLength:Number(fd.get('plannedLength'))});U.closeModal();U.toast('检测任务已创建');H.navigate(`task?id=${encodeURIComponent(t.id)}`);});
    const specSelect=document.querySelector('#active-modal-form [name="specId"]'),metricSelect=document.querySelector('#active-modal-form [name="metric"]'),deviceSelect=document.querySelector('#active-modal-form [name="deviceId"]'),recipeSelect=document.querySelector('#active-modal-form [name="recipeId"]');
    const options=(control,rows)=>{const previous=control.value;control.innerHTML=rows.map(([v,l])=>`<option value="${E(v)}">${E(l)}</option>`).join('');if(rows.some(([v])=>v===previous))control.value=previous;};
    const updateDevices=()=>{options(deviceSelect,devices.filter(d=>d.metric===metricSelect.value).map(d=>[d.id,`${d.id} · ${metric(d.metric).short}`]));options(recipeSelect,recipes.filter(r=>r.metric===metricSelect.value).map(r=>[r.id,`${r.name} · ${r.version}`]));};
    const updateMetric=()=>{const chosen=S.spec(specSelect.value);options(metricSelect,(chosen?chosen.metrics:[]).map(k=>[k,metric(k).name]));updateDevices();};
    if(specSelect&&metricSelect&&deviceSelect&&recipeSelect){specSelect.addEventListener('change',updateMetric);metricSelect.addEventListener('change',updateDevices);updateMetric();}
  };
  A['core-task-start']=el=>{S.startTask(el.dataset.id);U.toast('任务已开始，可模拟采集下一条记录');render();};
  A['core-task-advance']=el=>{S.advanceTask(el.dataset.id);U.toast('已采集并保存一条模拟检测记录');render();};
  A['core-task-complete']=el=>{
    const t=S.task(el.dataset.id);
    U.modal('结束本次检测',`${U.note(`任务 ${t.id} 已检测 ${number(t.measuredLength,1)} / ${number(t.plannedLength,1)} m。结束后保留实际检测长度、全部超限和同步记录。`,'amber')}<p>完成任务不会自动关闭待复核报警，也不会将超限判定改为合格。</p>`,()=>{S.completeTask(t.id);U.closeModal();U.toast('任务已完成，质量结论仍按原始记录及复核状态呈现');render();},'确认结束');
  };
  A['core-report']=el=>{const report=S.createReport(el.dataset.id);H.navigate(`report?id=${encodeURIComponent(report.id)}`);};
  function executionLog(task,records,alarms) {
    const events=[],add=(time,text,actor='系统')=>{if(time)events.push({time:U.date(time),text,actor});};
    add(task.createdAt||task.startAt,'创建检测任务','质量管理员');
    const assigned=task.assignedAt||(/^T20261009\d{3}$/.test(task.id)&&task.startAt?new Date(Date.parse(task.startAt.replace(' ','T')+'Z')-5*60000).toISOString().slice(0,19).replace('T',' '):task.createdAt);
    add(assigned,'关联设备与检测配方','质量管理员');
    add(task.startAt,'开始采集量测数据',task.deviceId);
    alarms.forEach(a=>{
      const record=S.record(a.recordId);
      add(a.createdAt,`记录${metric(a.metric).short}超限：${U.metricFmt(record?.value,a.metric)} ${metric(a.metric).unit}`);
      (a.history||[]).filter(entry=>entry.time!==a.createdAt).forEach(entry=>add(entry.time,entry.note,entry.actor||'系统'));
    });
    S.state.audits.filter(a=>String(a.detail||'').includes(task.id)&&/采集|补录|导入|重试|修改/.test(a.action)).forEach(a=>add(a.time||a.createdAt,a.action,a.actor||'质量管理员'));
    const confirmed=records.filter(r=>r.mesStatus==='confirmed').sort((a,b)=>String(b.confirmedAt||b.time).localeCompare(String(a.confirmedAt||a.time)))[0];
    if(confirmed)add(confirmed.confirmedAt||confirmed.time,'MES确认接收最新记录');
    add(task.endAt,'完成本次检测',task.deviceId);
    const unique=Array.from(new Map(events.map(event=>[`${event.time}|${event.text}|${event.actor}`,event])).values()).sort((a,b)=>a.time.localeCompare(b.time));
    return U.table(['时间','记录内容','执行主体'],unique.map(event=>[E(timeOnly(event.time)),E(event.text),E(event.actor)]));
  }

  P.task=()=>{
    const requestedId=H.params.get('id'),t=requestedId?S.task(requestedId):S.state.tasks[0];if(!t)return U.title('检测任务详情','该任务不存在，或已从本地演示数据移除。',U.link('返回任务列表','tasks'))+U.empty('任务不存在');
    const m=metric(t.metric),rows=S.recordsFor(t.id),stats=S.stats(rows),last=latest(rows),alarms=S.state.alarms.filter(a=>a.taskId===t.id),pending=alarms.filter(a=>a.status!=='resolved'),progress=Math.min(100,t.plannedLength?Number(t.measuredLength)/Number(t.plannedLength)*100:0),confirmed=rows.filter(r=>r.mesStatus==='confirmed').length;
    const taskActions=`${t.status==='pending'?action('开始检测','task-start',{id:t.id},true,'player-play'):t.status==='running'?action('采集下一条','task-advance',{id:t.id},true,'plus')+action('结束检测','task-complete',{id:t.id}):''}${U.link('返回任务列表','tasks')} ${t.status==='pending'?'':reportAction(t)}`;
    const header=`<div class="row"><div class="stat-icon blue">${U.icon('clipboard')}</div><div><h2 style="margin:0 0 5px">${E(t.id)}</h2><span class="muted small">${E(m.name)} · ${E(t.deviceId)}</span></div>${taskStatus(t.status)}<div class="spacer"></div>${pending.length?U.badge(`过程存在超限 · 待复核 ${pending.length} 项`,'amber'):U.badge(alarms.length?'历史超限已处理':'暂无过程超限','green')}</div><div class="detail-grid" style="margin-top:22px;padding-top:18px;border-top:1px solid var(--line)">${info('工单号',E(t.workOrder))}${info('盘号',reelLink(t.reelId))}${info('高压电缆规格',E(specLabel(S.spec(t.specId))))}${info('执行设备',E(t.deviceId))}${info('检测项目',E(m.name))}${info('规则版本',E(`${t.ruleSnapshot.id || t.recipeId} · ${labelRule(m,t.ruleSnapshot)}`))}${info('开始时间',E(t.startAt||'尚未开始'))}${info('结束时间',E(t.endAt||'—'))}</div>`;
    const steps=`<div class="steps">${['已创建','已分配','检测中','已完成'].map((label,index)=>`<div class="step ${t.status==='completed'||index<(t.status==='running'?3:2)?'done':''}"><span>${t.status==='completed'||index<(t.status==='running'?2:1)?'✓':index+1}</span><strong>${label}</strong><small>${index===2?E(t.startAt?timeOnly(t.startAt)+'开始':'等待开始'):index===3?E(t.endAt?timeOnly(t.endAt):'尚未结束'):'已记录'}</small></div>`).join('')}</div><div class="row"><span class="muted">累计计米进度</span><div class="spacer"></div><strong class="text-blue">${number(t.measuredLength,1)} / ${number(t.plannedLength,1)} m</strong></div><div class="progress"><span style="width:${progress}%"></span></div><p class="muted small">${number(progress,1)}% · 按本任务计划长度计算</p>`;
    const result=`<div class="grid cols-3 core-result-grid">${info('最新'+m.short,`${hero(U.metricFmt(last&&last.value,m.id),m.unit)}${last?status(last.judgement):U.badge('待采集','gray')}`)}${info('控制'+(m.id==='dg'?'下限':'上限'),`${hero(thresholdNumber(t.ruleSnapshot.threshold),m.unit)}<span class="small muted">${E(labelRule(m,t.ruleSnapshot))}</span>`)}${info(m.id==='dg'?'本窗口最小值':'本窗口最大值',`${hero(U.metricFmt(m.id==='dg'?stats.min:stats.max,m.id),m.unit,stats.fail?'text-red':'')}<span class="small muted">原始记录保留</span>`)}</div>${U.note(t.status==='completed'?(pending.length?'任务已结束；请先完成异常复核，再生成最终报告。':'任务已结束，可生成最终报告。'):'任务未结束，最终质量结论尚未生成。',t.status==='completed'&&!pending.length?'green':'amber')}`;
    const log=executionLog(t,rows,alarms);
    const abnormal=alarms.length?alarms.map(a=>{const r=S.record(a.recordId);return `<div class="stack" style="gap:10px"><div class="row">${U.link(m.short+(m.id==='dg'?'低于控制下限':'超过控制上限'),`alarm?id=${a.id}`)}${status(a.status)}</div><div class="muted small">${timeOnly(r&&r.time)} · 米数位置 ${number(r&&r.meter,1)} m</div>${hero(U.metricFmt(r&&r.value,m.id),m.unit,'text-red')}<span class="muted small">当前值恢复正常，不自动关闭历史异常。</span></div>`;}).join('<hr>'):U.empty('本任务暂无超限事件');
    const sync=`<div class="key-value"><span>本任务有效记录</span><span>${stats.valid} 条</span></div><div class="key-value"><span>平台已接收</span><span>${rows.filter(r=>r.platformStatus==='received').length} / ${rows.length}</span></div><div class="key-value"><span>MES已确认</span><span class="text-green">${confirmed} / ${rows.length}</span></div><div class="key-value"><span>最终质量报告</span>${t.status==='completed'?(pending.length?U.badge('待异常复核','amber'):U.badge('可生成','green')):U.badge('待任务完成','gray')}</div><div class="row" style="margin-top:20px">${action('导出阶段数据明细.csv','task-export',{id:t.id},false,'download')}${U.link('查看同步','sync')}</div>`;
    return U.title('检测任务详情','单次检测任务的执行记录、过程结果与 MES 同步状态。',taskActions)+U.panel('',header,'','task-summary')+`<div class="split">${U.panel('任务执行进度',steps)}${U.panel('关联检测结果',result,U.link('进入实时检测 →',detectionLink(t)))}</div><div class="grid cols-3">${U.panel('执行日志',log)}${U.panel('关联异常',abnormal)}${U.panel('数据与 MES 同步',sync)}</div>`;
  };
  A['core-task-export']=el=>U.downloadCSV(S.recordsFor(el.dataset.id),`${el.dataset.id}-检测明细.csv`);

  P.specs=()=>{
    const f=filters('specs'),rows=S.state.specs.filter(s=>(!f.query||s.id.toLowerCase().includes(f.query.toLowerCase()))&&(!f.voltage||String(s.voltage)===f.voltage)&&(!f.area||String(s.area)===f.area)&&(!f.enabled||String(s.enabled)===f.enabled)),selected=S.spec(H.params.get('id'))||rows[0];
    const form=field('query','规格编号',f.query,'输入规格编号')+select('voltage','电压等级',[['','35 / 66 / 110 / 220kV'],...[35,66,110,220].map(v=>[v,`${v}kV`])],f.voltage)+select('area','导体截面积',[['','全部截面积'],...Array.from(new Set(S.state.specs.map(s=>s.area))).sort((a,b)=>a-b).map(v=>[v,`${v}mm²`])],f.area)+select('enabled','启用状态',[['','全部状态'],['true','启用'],['false','停用']],f.enabled);
    const table=U.table(['规格编号','电压等级','芯数 × 截面积','屏蔽结构','适用检测项目','状态','操作'],rows.map(s=>[U.link(s.id,`specs?id=${encodeURIComponent(s.id)}`),`${s.voltage}kV`,`${s.cores||1}×${s.area}mm²`,s.structure==='tape'?'铜带屏蔽':'铜丝屏蔽',E(s.metrics.map(k=>metric(k).short).join(' / ')),U.badge(s.enabled?'启用':'停用',s.enabled?'green':'gray'),action('编辑','spec-edit',{id:s.id})]));
    const details=selected?`<div class="row"><strong class="text-blue">${E(selected.id)}</strong><div class="spacer"></div>${U.badge(selected.enabled?'启用':'停用',selected.enabled?'green':'gray')}</div><div class="core-spec-hero">${hero(selected.voltage,`kV　${selected.cores||1}×${selected.area}mm²`)}</div><div class="key-value"><span>检测对象</span><span>高压电缆</span></div><div class="key-value"><span>屏蔽结构</span><span>${selected.structure==='tape'?'铜带屏蔽':'铜丝屏蔽'}</span></div><div class="key-value"><span>产品类型</span><span>交联聚乙烯绝缘电缆</span></div><div class="key-value"><span>客户规格代号</span><span>${E(selected.customerCode||'HV-'+selected.voltage+'-'+selected.area)}</span></div><p class="muted">本规格适用项目</p><div class="toolbar">${selected.metrics.map(k=>U.badge(metric(k).name,'blue')).join('')}</div><p class="muted small">检测项目按照屏蔽结构与生产工序配置，不默认全部适用。</p>`:U.empty('请选择产品规格');
    const ruleTable=U.table(['检测项目','演示规则版本','量测指标','演示阈值','当前规格适用性'],Object.values(S.metrics).map(m=>{const r=S.state.recipes.find(r=>r.metric===m.id&&r.enabled);return[E(m.name),E(r?r.id:'—'),E(m.short),E(labelRule(m,r)),selected&&selected.metrics.includes(m.id)?U.badge('本规格适用','green'):U.badge('本规格不适用','gray')];}));
    return U.title('高压电缆产品规格档案','仅管理35–220kV高压电缆；检测项目按实际屏蔽结构和工序配置。',action('新增规格','spec-edit',{},true,'plus'))+U.filterForm('specs',form)+`<div class="split">${U.panel('规格列表',rows.length?table:U.empty('没有匹配的规格'),`<span class="muted small">${rows.length} 项规格</span>`)}${U.panel('选中规格详情',details)}</div>`+U.panel('三项检测规则与适用关系',ruleTable,'<span class="muted small">阈值为演示规则 · 适用性按规格配置</span>')+`<p class="muted small">本页为产品规格管理原型，不表示单台检测硬件覆盖全部规格；实际适用范围需结合设备量程与工艺确认。</p>`;
  };
  A['core-spec-edit']=el=>{
    const old=S.spec(el.dataset.id),s=old||{id:'',voltage:35,area:400,cores:1,structure:'tape',metrics:['dg','by'],enabled:true};
    U.modal(old?'编辑产品规格':'新增产品规格',`<div class="grid cols-2">${U.field('规格编号',requiredInput('id',s.id,'text',old?'readonly':''))}${select('voltage','电压等级',[35,66,110,220].map(v=>[v,`${v}kV`]),s.voltage)}${U.field('导体截面积 / mm²',requiredInput('area',s.area,'number','min="1" step="1"'))}${U.field('芯数',requiredInput('cores',s.cores,'number','min="1" max="10" step="1"'))}${select('structure','屏蔽结构',[['tape','铜带屏蔽'],['wire','铜丝屏蔽']],s.structure)}${select('enabled','启用状态',[['true','启用'],['false','停用']],String(s.enabled))}</div><div class="field"><label>适用检测项目</label><div class="stack" style="gap:12px">${Object.values(S.metrics).map(m=>`<label class="checkbox"><input type="checkbox" name="metrics" value="${m.id}" ${s.metrics.includes(m.id)?'checked':''}>${E(m.name)}</label>`).join('')}</div></div>${U.note('铜带屏蔽可配置搭盖率；铜丝屏蔽可配置相邻铜丝间隙。不圆度可独立配置。至少选一个项目。')}`,fd=>{
      const input=formValues(fd),keys=fd.getAll('metrics');
      if(!keys.length)throw Error('至少选择一个适用检测项目');
      if(input.structure==='tape'&&keys.includes('jx'))throw Error('铜带屏蔽规格不适用铜丝间隙检测');
      if(input.structure==='wire'&&keys.includes('dg'))throw Error('铜丝屏蔽规格不适用金属屏蔽搭盖率检测');
      if(!old&&S.spec(input.id.trim()))throw Error('规格编号已存在');
      const updated={...s,...input,id:input.id.trim(),voltage:Number(input.voltage),area:Number(input.area),cores:Number(input.cores),metrics:keys,enabled:input.enabled==='true'};
      if(old)Object.assign(old,updated);else S.state.specs.push(updated);
      S.log(old?'修改产品规格':'新增产品规格',updated.id);S.save();U.closeModal();U.toast('产品规格已保存');H.navigate(`specs?id=${encodeURIComponent(updated.id)}`);render();
    });
  };

  function historyRows() {
    if(!H.filters.history){const end=S.state.settings.demoTime||'2026-10-09 14:30:00';const endDate=new Date(end.replace(' ','T')+'Z'),startDate=new Date(endDate.getTime()-29*60000);H.filters.history={start:startDate.toISOString().slice(0,16),end:end.replace(' ','T').slice(0,16)};}
    const f=filters('history'),wanted=f.metric!==undefined?f.metric:H.params.get('metric')||'',start=f.start?f.start.replace('T',' '):'',end=f.end?f.end.replace('T',' ')+':59':'';
    return newest(S.state.records.filter(r=>(!f.query||`${r.reelId} ${r.workOrder} ${r.id}`.toLowerCase().includes(f.query.toLowerCase()))&&(!wanted||r.metric===wanted)&&(!f.judgement||r.judgement===f.judgement)&&(!start||r.time>=start)&&(!end||r.time<=end)));
  }
  P.history=()=>{
    const rows=historyRows(),f=filters('history'),stats=S.stats(rows),pg=U.paginate(rows,'history',8),confirmed=rows.filter(r=>r.mesStatus==='confirmed').length;
    const form=field('query','盘号 / 工单',f.query,'输入盘号或工单号')+select('metric','检测项目',[['','全部三项'],...Object.values(S.metrics).map(m=>[m.id,m.name])],f.metric!==undefined?f.metric:H.params.get('metric')||'')+field('start','开始时间',f.start||'','','datetime-local')+field('end','结束时间',f.end||'','','datetime-local')+select('judgement','数值判定',[['','全部'],['pass','符合阈值'],['fail','超限'],['invalid','无效数据']],f.judgement);
    return U.title('历史检测数据查询','按时间、盘号、工单和三项检测内容查询原始记录。',action('导出查询结果','history-export',{},false,'download'))+U.filterForm('history',form)+`<div class="grid cols-4">${U.kpi('当前查询有效记录',stats.valid,`共 ${stats.total} 条 · 无效 ${stats.invalid} 条`,'database')}${U.kpi('符合阈值记录',stats.pass,`占有效记录 ${stats.valid?number(stats.pass/stats.valid*100):'0.00'}%`,'check','green')}${U.kpi('超限记录',stats.fail,'处理后仍保留原始判定','bell','red')}${U.kpi('MES确认接收',`${confirmed}<small> / ${rows.length}</small>`,`同步成功率 ${rows.length?number(confirmed/rows.length*100,0):0}%`,'cloud-upload')}</div><div class="grid cols-3">${['dg','jx','by'].map(k=>metricCard(k,rows.filter(r=>r.metric===k).slice().reverse(),true)).join('')}</div>`+U.panel('检测记录',recordsTable(pg.items,false)+pg.footer,'<span class="muted small">原始超限记录保留 · 统计与导出严格按当前查询条件</span>');
  };
  A['core-history-export']=()=>{const rows=historyRows();if(!rows.length){U.toast('当前查询无可导出的记录');return;}U.downloadCSV(rows,`慧眼智检-查询结果-${rows.length}条.csv`);S.log('导出历史记录',`按当前筛选条件导出 ${rows.length} 条记录`);};

  P.trace=()=>{
    const reel=H.params.get('reel')||S.state.tasks[0]?.reelId||'', tasks=S.state.tasks.filter(t=>t.reelId===reel),rows=newest(S.state.records.filter(r=>r.reelId===reel)),stats=S.stats(rows),alarms=S.state.alarms.filter(a=>tasks.some(t=>t.id===a.taskId)),pg=U.paginate(rows,'trace',8);
    const reelOptions=Array.from(new Set(S.state.tasks.map(t=>t.reelId))).map(id=>[id,id]);
    const form=`<div class="filters">${select('trace-reel','选择盘号',reelOptions,reel)}${action('查询追溯','trace-select',{},true,'search')}</div>`;
    const tasksBody=tasks.length?U.table(['任务编号','检测项目','规格','执行设备','任务状态','关联报告'],tasks.map(t=>[taskLink(t),E(metric(t.metric).name),E(specLabel(S.spec(t.specId))),E(t.deviceId),taskStatus(t.status),t.status==='pending'?U.badge('待开始检测','gray'):reportAction(t)])):U.empty('该盘号不存在检测任务');
    const charts=['dg','jx','by'].map(key=>{const metricRows=rows.filter(r=>r.metric===key);return metricRows.length?metricCard(key,metricRows.slice().reverse(),true):U.panel(metric(key).name,U.empty(tasks.some(t=>t.metric===key)?'等待量测数据':'本盘未关联该项检测'));}).join('');
    return U.title('盘号追溯详情','将检测任务、量测原始记录、过程异常与质量报告关联到同一盘号。',U.link('返回历史数据','history'))+form+U.panel('盘号 '+reel,`<div class="grid cols-4">${info('检测任务',hero(tasks.length,'项'))}${info('有效记录',hero(stats.valid,'条'))}${info('过程超限',hero(stats.fail,'条',stats.fail?'text-red':''))}${info('MES确认',hero(rows.filter(r=>r.mesStatus==='confirmed').length,`/ ${rows.length}`))}</div>`)+U.panel('关联检测任务',tasksBody)+`<div class="grid cols-3">${charts}</div>`+U.panel('过程异常',alarms.length?U.table(['事件编号','检测项目','发生时间','原始记录','处置状态','操作'],alarms.map(a=>[E(a.id),E(metric(a.metric).name),E(a.createdAt),U.button(a.recordId,'record-view',{id:a.recordId}),status(a.status),U.link('查看处置',`alarm?id=${encodeURIComponent(a.id)}`)])):U.empty('本盘号暂无过程超限事件'))+U.panel('完整检测记录',recordsTable(pg.items,false)+pg.footer);
  };
  A['core-trace-select']=()=>{const select=document.querySelector('[name="trace-reel"]');H.navigate(`trace?reel=${encodeURIComponent(select.value)}`);};

  let importPreview=null;
  function parseCSV(text) {
    const result=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))result.push(row);row=[];cell='';}else cell+=c;}
    if(quoted)throw Error('CSV 引号未闭合');row.push(cell);if(row.some(x=>x.trim()))result.push(row);
    if(result.length<2)throw Error('CSV 至少需要表头和一条数据');
    const headers=result.shift().map(x=>x.replace(/^\uFEFF/,'').trim()),required=['taskId','metric','time','meter','value'];
    if(required.some(h=>!headers.includes(h)))throw Error('CSV 缺少必要表头：taskId, metric, time, meter, value');
    return result.map((values,i)=>({...Object.fromEntries(headers.map((h,j)=>[h,(values[j]||'').trim()])),_row:i+2}));
  }
  function validateImport(rows) {
    return rows.map(row=>{
      const errors=[],t=S.task(row.taskId),value=row.value===''?null:Number(row.value),meter=row.meter===''?null:Number(row.meter),validity=row.validity||'valid';
      if(!t)errors.push('任务不存在');else if(t.metric!==row.metric)errors.push('检测项目与任务不一致');
      if(!['dg','jx','by'].includes(row.metric))errors.push('仅支持 dg / jx / by');
      if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.time)||!Number.isFinite(Date.parse(row.time.replace(' ','T'))))errors.push('时间格式应为 YYYY-MM-DD HH:mm:ss');
      if(meter===null||!Number.isFinite(meter)||meter<0)errors.push('米数必须是非负数字');
      if(!['valid','invalid'].includes(validity))errors.push('有效性仅支持 valid / invalid');
      if(validity==='valid'&&(value===null||!Number.isFinite(value)||value<0))errors.push('有效数据必须填写非负实测值');
      return {...row,value,meter,validity,errors};
    });
  }
  P.import=()=>{
    const preview=importPreview,valid=preview?preview.rows.filter(r=>!r.errors.length):[];
    const upload=`<div class="upload-zone"><div class="stat-icon blue" style="margin:0 auto">${U.icon('upload',30)}</div><h3>导入检测数据 CSV</h3><p class="muted">先校验，再保存；仅接受三项检测记录，并绑定已存在的任务。</p><input type="file" id="core-import-file" accept=".csv,text/csv" aria-label="选择检测记录 CSV 文件"><div class="toolbar" style="justify-content:center;margin-top:18px">${action('读取并校验文件','import-read',{},true,'upload')}${action('下载 CSV 模板','import-template',{},false,'download')}</div></div>`;
    const manual=`<p class="muted">用于补充单条有效量测或标记缺失数据。补录来源和操作日志自动保留。</p>${action('新增一条补录','import-manual',{},true,'plus')}<div class="key-value" style="margin-top:24px"><span>允许的检测项目</span><span>搭盖率 / 铜丝间隙 / 不圆度</span></div><div class="key-value"><span>关联方式</span><span>任务 → 盘号 / 工单 / 设备</span></div><div class="key-value"><span>历史规则</span><span>使用任务冻结的规则快照</span></div><div class="key-value"><span>MES同步</span><span>补录后待同步，可在同步监控重试</span></div>`;
    const validation=preview?`<div class="row" style="margin-bottom:18px">${U.badge(`${preview.rows.length} 条待导入`,'blue')}${U.badge(`${valid.length} 条通过`,'green')}${U.badge(`${preview.rows.length-valid.length} 条错误`,preview.rows.length===valid.length?'gray':'red')}<span class="muted small">${E(preview.name)}</span><div class="spacer"></div>${action('保存校验通过的记录','import-save',{},true,'check')}${action('清空','import-clear')}</div>${U.table(['CSV行','关联任务','检测项目','时间','米数 / m','实测值','校验结果'],preview.rows.slice(0,100).map(r=>[r._row,E(r.taskId),E(r.metric),E(r.time),number(r.meter,1),U.metricFmt(r.value,r.metric),r.errors.length?`<span class="text-red">${E(r.errors.join('；'))}</span>`:U.badge('可导入','green')]))}${preview.rows.length>100?U.note('预览仅展示前100行；保存处理全部校验通过的记录。'):''}`:U.empty('选择 CSV 文件或新增补录，校验结果将在这里展示');
    return U.title('数据导入与补录','校验数据结构、任务关联与量测有效性；原始记录保留来源，补录操作可追溯。')+`<div class="split">${U.panel('批量导入',upload)}${U.panel('人工补录',manual)}</div>`+U.panel('导入校验预览',validation)+U.note('无效或缺失量测以“无效数据”保存，实测值不替换为 0，不参与阈值与统计计算。导入不覆盖已有原始记录。');
  };
  A['core-import-template']=()=>{
    const t=S.state.tasks.find(t=>t.status==='running')||S.state.tasks[0];
    U.downloadFile('慧眼智检-检测数据导入模板.csv','\uFEFFtaskId,metric,time,meter,value,validity\r\n'+`${t.id},${t.metric},2026-10-09 14:31:00,1240,12.36,valid\r\n`,'text/csv;charset=utf-8');
  };
  A['core-import-read']=async()=>{
    const file=document.getElementById('core-import-file').files[0];if(!file)throw Error('请先选择 CSV 文件');if(file.size>5*1024*1024)throw Error('请将单个导入文件控制在 5MB 以内');
    const rows=parseCSV(await file.text());importPreview={name:file.name,rows:validateImport(rows)};U.toast('文件校验完成，请查看预览');render();
  };
  A['core-import-clear']=()=>{importPreview=null;render();};
  A['core-import-manual']=()=>{
    const tasks=S.state.tasks;
    U.modal('补录检测数据',`<div class="grid cols-2">${select('taskId','关联任务',tasks.map(t=>[t.id,`${t.id} · ${metric(t.metric).short}`]))}${select('metric','检测项目',Object.values(S.metrics).map(m=>[m.id,m.name]))}${U.field('记录时间',requiredInput('time','2026-10-09T14:31','datetime-local','step="1"'))}${U.field('米数位置 / m',requiredInput('meter','1240','number','min="0" step="0.1"'))}${U.field('实测值（无效数据可留空）','<input name="value" type="number" step="0.01" min="0">')}${select('validity','数据有效性',[['valid','有效数据'],['invalid','无效 / 缺失数据']])}</div>${U.note('选择的检测项目须与任务一致，单位随项目确定：搭盖率 %、铜丝间隙 mm、不圆度 %。')}`,fd=>{
      const data=formValues(fd);data.time=data.time.replace('T',' ');if(data.time.length===16)data.time+=':00';const checked=validateImport([{...data,_row:1}]);if(checked[0].errors.length)throw Error(checked[0].errors.join('；'));
      importPreview={name:'人工补录',rows:checked};U.closeModal();U.toast('补录已校验，请在预览中保存');H.navigate('import');render();
    },'校验并预览');
  };
  A['core-import-save']=()=>{
    if(!importPreview)throw Error('暂无待保存的记录');const rows=importPreview.rows.filter(r=>!r.errors.length);if(!rows.length)throw Error('没有校验通过的记录，请修正后重新导入');
    const result=S.importRecords(rows.map(({errors,_row,...r})=>({...r,source:importPreview.name==='人工补录'?'人工补录':'CSV导入'})));
    U.toast(`已保存 ${result.count} 条记录${result.errors.length?`，${result.errors.length} 条被拒绝`:''}`);
    if(result.errors.length){const errors=result.errors.map(e=>typeof e==='string'?e:JSON.stringify(e));U.drawer('导入结果',U.note(`成功 ${result.count} 条，失败 ${result.errors.length} 条。`,'amber')+`<ul>${errors.map(e=>`<li>${E(e)}</li>`).join('')}</ul>`);}
    importPreview=null;render();
  };
  ['task-new','task-start','task-advance','task-complete','report','spec-edit','import-manual','import-save'].forEach(name=>{const handler=A['core-'+name];A['core-'+name]=(...args)=>{if(H.canWrite&&!H.canWrite())throw Error('当前为只读角色，请切换质量管理员或检测操作员后操作');return handler(...args);};});
})();
