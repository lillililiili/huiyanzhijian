/* 慧眼智检 — deterministic local demonstration data and domain service. */
(function (root) {
  'use strict';
  const HY = root.HY = root.HY || { Pages: {}, Actions: {} };
  HY.Pages = HY.Pages || {}; HY.Actions = HY.Actions || {};
  const KEY = 'huiyan-native-prototype:v1';
  const clone = value => JSON.parse(JSON.stringify(value));
  const clean = value => String(value == null ? '' : value).trim();
  const round = value => Math.round(value * 100) / 100;
  const pad = value => String(value).padStart(2, '0');
  const actualTime = () => new Date().toISOString();
  const timeAdd = (value, seconds) => new Date(Date.parse(value.replace(' ', 'T') + 'Z') + seconds * 1000).toISOString().slice(0, 19).replace('T', ' ');
  const metrics = {
    dg: { id: 'dg', name: '金属屏蔽搭盖率', short: '搭盖率', unit: '%', threshold: 10, operator: '>=', color: '#155ab6', icon: 'layers-intersect', image: 'assets/images/copper-inspection.png' },
    jx: { id: 'jx', name: '铜丝屏蔽相邻铜丝间隙', short: '铜丝间隙', unit: 'mm', threshold: 3, operator: '<=', color: '#1289ad', icon: 'ruler-measure', image: 'assets/images/wire-inspection.png' },
    by: { id: 'by', name: '电缆不圆度', short: '不圆度', unit: '%', threshold: 8, operator: '<=', color: '#079981', icon: 'circle-dashed', image: 'assets/images/roundness.png' }
  };
  function judge(value, metric, rule, validity) {
    if (!metrics[metric]) throw new Error('仅支持搭盖率、铜丝间隙和不圆度三项检测');
    if (validity === 'invalid' || value === null || value === undefined || clean(value) === '' || typeof value === 'boolean' || !Number.isFinite(Number(value))) return 'invalid';
    const r = rule || metrics[metric];
    if (!['>=', '<='].includes(r.operator) || !Number.isFinite(Number(r.threshold))) return 'invalid';
    return (r.operator === '>=' ? Number(value) >= Number(r.threshold) : Number(value) <= Number(r.threshold)) ? 'pass' : 'fail';
  }
  function stats(records) {
    const rows = Array.isArray(records) ? records : [];
    const valid = rows.filter(r => r.validity === 'valid' && r.value !== null && r.value !== '' && Number.isFinite(Number(r.value)) && r.judgement !== 'invalid');
    const values = valid.map(r => Number(r.value));
    return { total: rows.length, valid: valid.length, invalid: rows.length - valid.length, pass: valid.filter(r => r.judgement === 'pass').length, fail: valid.filter(r => r.judgement === 'fail').length, min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null, avg: values.length ? round(values.reduce((a, b) => a + b, 0) / values.length) : null, last: rows.length ? rows.slice().sort((a, b) => a.time.localeCompare(b.time)).at(-1) : null };
  }
  const snapshot = recipe => ({ id: recipe.id, version: recipe.version, threshold: recipe.threshold, operator: recipe.operator });
  function aux(metric, value, sample) {
    if (value === null) return {};
    if (metric === 'dg') return { overlapWidth: round(value / 100 * 30), tapeWidth: 30, pitch: round(30 - value / 100 * 30), description: '演示量测：搭盖宽度与节距为辅助量，不替代设备输出的搭盖率' };
    if (metric === 'jx') return { localGaps: [round(value - .14), round(value + .03), round(value + .08), round(value + .03)], meanGap: value, description: '四处局部间隙的平均值作为当前平均间隙演示' };
    return { xDiameter: round(66.42 + ((sample + 1) % 3) * .01), yDiameter: 63.52, description: 'X / Y 外径为辅助数据；不圆度取设备输出，计算口径另行确认，不代表全周重建' };
  }
  function seed() {
    const state = { schemaVersion: 1, tasks: [], specs: [], devices: [], records: [], alarms: [], recipes: [], reports: [], audits: [], users: [], settings: {}, mes: {}, connections: {}, reportTemplate: {} };
    state.specs = [
      ['SP035-400',35,400,'tape'], ['SP035-300',35,300,'tape'], ['SP066-630',66,630,'wire'],
      ['SP110-800',110,800,'wire'], ['SP110-1000',110,1000,'wire'], ['SP220-1200',220,1200,'wire']
    ].map(([id,voltage,area,structure]) => ({ id, voltage, area, cores:1, structure, metrics: structure === 'tape' ? ['dg','by'] : ['jx','by'], enabled:true, productType:'交联聚乙烯绝缘电缆', customerCode:'HV-' + id.slice(2), description:'35–220 kV 高压电缆演示规格，适用范围应结合设备量程与工艺确认' }));
    state.devices = [
      {id:'HY-DG-01',name:'金属屏蔽搭盖率检测设备',metric:'dg',line:'铜带屏蔽工位',status:'online',source:'设备自动采集',lastSeen:'2026-10-09 14:30:00',calibration:'2026-12-31',model:'HY-DG',image:'assets/images/device-dg.png',ip:'192.168.10.101'},
      {id:'HY-JX-01',name:'铜丝屏蔽相邻铜丝间隙检测设备',metric:'jx',line:'铜丝屏蔽工位',status:'online',source:'设备自动采集',lastSeen:'2026-10-09 14:30:00',calibration:'2026-12-31',model:'HY-JX',image:'assets/images/device-jx.png',ip:'192.168.10.102'},
      {id:'HY-BY-01',name:'电缆不圆度检测设备',metric:'by',line:'不圆度检测工位',status:'online',source:'设备自动采集',lastSeen:'2026-10-09 14:30:00',calibration:'2026-12-31',model:'HY-BY',image:'assets/images/device-by.png',ip:'192.168.10.103'}
    ];
    state.recipes = Object.values(metrics).map(m => ({ id:m.id.toUpperCase()+'-V1.0',metric:m.id,version:'V1.0',threshold:m.threshold,operator:m.operator,name:m.short+'默认演示配方',enabled:true,createdAt:'2026-10-09 08:00:00',description:'依据原型设定的演示阈值' }));
    for (let i=0; i<12; i++) {
      const metric = ['dg','jx','by'][i%3], recipe=state.recipes.find(r=>r.metric===metric);
      const number=String(i+1).padStart(3,'0');
      const startAt=i<3 ? ['2026-10-09 13:00:00','2026-10-09 12:30:00','2026-10-09 12:10:00'][i] : '2026-10-09 '+pad(8+Math.floor((i-3)/3))+':'+pad(5+15*((i-3)%3))+':00';
      state.tasks.push({id:'T20261009'+number,workOrder:'WO20261009'+number,reelId:'P20261009'+number,specId:['SP035-400','SP110-800','SP220-1200'][i%3],metric,deviceId:state.devices[i%3].id,recipeId:recipe.id,ruleSnapshot:snapshot(recipe),status:i<3?'running':'completed',startAt,endAt:i<3?null:timeAdd(startAt,1200),createdAt:timeAdd(startAt,-600),plannedLength:[2000,3000,4000][i%3],measuredLength:i<3?[1232,2261,3217.5][i%3]:[2000,3000,4000][i%3]});
    }
    const samples={
      dg:[12.70,13.03,13.23,13.21,12.99,9.20,12.16,11.94,11.85,12.03,12.30,12.61,12.80,12.83,12.59,12.25,11.97,11.76,11.81,11.93,12.26,12.61,12.96,13.12,13.18,12.96,12.63,12.32,12.18,12.36],
      jx:[1.80,1.92,1.99,2.01,2.01,1.92,1.81,1.65,1.59,1.46,1.43,3.24,1.62,1.71,1.74,1.71,1.61,1.55,1.45,1.43,1.52,1.60,1.75,1.92,2.02,2.04,2.08,2.04,1.95,1.52],
      by:[4.39,4.57,4.71,4.74,4.73,4.59,4.39,4.18,3.96,3.79,3.67,3.60,3.67,3.82,3.96,4.17,4.36,4.48,4.57,4.60,4.53,4.42,4.26,4.13,4.02,4.02,4.10,4.24,4.51,4.37]
    };
    state.tasks.forEach((task,t) => {
      const count=t<3?30:12;
      for(let i=0;i<count;i++) {
        const time=t<3?'2026-10-09 14:'+pad(i+1)+':00':timeAdd(task.startAt,i*60);
        const value=t<3?samples[task.metric][i]:round(metrics[task.metric].threshold*(task.metric==='dg'?1.25:.55)+Math.sin(i)*.12);
        const meter=t<3?round(task.measuredLength-(29-i)*[8,9,7.5][t]):round(task.plannedLength*(i+1)/count);
        state.records.push({id:'R-'+task.id+'-'+pad(i+1),taskId:task.id,metric:task.metric,deviceId:task.deviceId,reelId:task.reelId,workOrder:task.workOrder,time,meter,value,validity:'valid',judgement:judge(value,task.metric,task.ruleSnapshot),ruleSnapshot:clone(task.ruleSnapshot),image:metrics[task.metric].image,source:'设备自动采集',platformStatus:'received',mesStatus:'confirmed',receivedAt:time,confirmedAt:time,aux:aux(task.metric,value,i)});
      }
    });
    const dg=state.records.find(r=>r.metric==='dg'&&r.judgement==='fail'),jx=state.records.find(r=>r.metric==='jx'&&r.judgement==='fail');
    state.alarms=[
      {id:'AL20261009001',recordId:dg.id,taskId:dg.taskId,metric:'dg',active:false,status:'pending',createdAt:dg.time,recoveredAt:'2026-10-09 14:07:00',note:'搭盖率低于控制下限；当前数值已恢复，原始超限记录保留，等待人工复核。',history:[{time:dg.time,actor:'系统',note:'检测到搭盖率 9.20%，低于控制下限 10%',status:'pending'},{time:'2026-10-09 14:07:00',actor:'系统',note:'当前量测恢复阈值范围，报警处理状态保持待复核',status:'pending'}]},
      {id:'AL20261009002',recordId:jx.id,taskId:jx.taskId,metric:'jx',active:false,status:'resolved',createdAt:jx.time,recoveredAt:'2026-10-09 14:13:00',note:'已复核工艺调整及后续连续记录，原始超限记录保留。',history:[{time:jx.time,actor:'系统',note:'平均铜丝间隙 3.24 mm，高于上限 3 mm',status:'pending'},{time:'2026-10-09 14:18:00',actor:'质量管理员',note:'复核后续记录并确认调整结果，完成处置；不覆盖原始超限记录',status:'resolved'}]}
    ];
    state.settings={name:'慧眼智检',company:'山东沉积岩信息科技有限公司',platformName:'线缆质量管控平台',currentRole:'admin',currentUser:'质量管理员',refreshInterval:5,autoRefresh:false,demoTime:'2026-10-09 14:30:00',demoDate:'2026-10-09',scenario:'normal',timezone:'Asia/Shanghai',retentionDays:365,notifications:true,storageMode:'local',loginRequired:true,metricConfig:clone(metrics)};
    state.mes={enabled:true,url:'https://mes.example.local/api/inspection',endpoint:'https://mes.example.local/api/inspection',method:'POST',timeout:10000,retries:3,token:'',authType:'Bearer Token',mode:'simulation',status:'connected',lastSync:'2026-10-09 14:30:00',mapping:{taskId:'task_code',reelId:'reel_no',metric:'inspection_item',value:'measured_value',time:'measured_at'}};
    state.connections={protocol:'HTTP',mode:'simulation',host:'127.0.0.1',port:8080,interval:1000,enabled:true,timeout:10000,retries:3,mapping:{taskId:'task_id',value:'value',time:'timestamp',meter:'meter'},dg:{protocol:'HTTP',host:'192.168.10.101',port:8080,enabled:true},jx:{protocol:'HTTP',host:'192.168.10.102',port:8080,enabled:true},by:{protocol:'HTTP',host:'192.168.10.103',port:8080,enabled:true}};
    state.reportTemplate={name:'高压电缆检测报告',version:'V1.0',company:'山东沉积岩信息科技有限公司',title:'高压电缆质量检测报告',showCharts:true,showImages:true,showAlarms:true,showMES:true,showRecords:true,signatory:'质量管理员',footer:'本报告为原型演示数据，不作为产品出厂证明。'};
    state.users=[{id:'U001',name:'质量管理员',username:'admin',role:'admin',enabled:true,department:'质量管理部',lastLogin:'2026-10-09 08:00:00'},{id:'U002',name:'检测操作员',username:'operator',role:'quality',enabled:true,department:'检测车间',lastLogin:'2026-10-09 12:00:00'},{id:'U003',name:'质量审核员',username:'quality',role:'quality',enabled:true,department:'质量管理部',lastLogin:'2026-10-09 13:45:00'},{id:'U004',name:'访客',username:'viewer',role:'viewer',enabled:true,department:'演示用户',lastLogin:null}];
    for(let i=0;i<9;i++) {const task=state.tasks[i+3],rs=state.records.filter(r=>r.taskId===task.id);state.reports.push({id:'RP20261009'+String(i+1).padStart(3,'0'),taskId:task.id,kind:'final',createdAt:task.endAt,snapshot:clone({task,spec:state.specs.find(s=>s.id===task.specId),device:state.devices.find(d=>d.id===task.deviceId),records:rs,alarms:[],stats:stats(rs),template:state.reportTemplate})});}
    state.audits=[{id:'AU00001',time:'2026-10-09 08:00:00',actor:'质量管理员',action:'登录系统',detail:'进入本地演示平台',role:'admin'},{id:'AU00002',time:'2026-10-09 12:50:00',actor:'质量管理员',action:'创建检测任务',detail:'T20261009001 · 金属屏蔽搭盖率',role:'admin'},{id:'AU00003',time:'2026-10-09 13:00:00',actor:'质量管理员',action:'开始检测',detail:'T20261009001 · HY-DG-01',role:'admin'},{id:'AU00004',time:'2026-10-09 14:06:00',actor:'系统',action:'记录超限事件',detail:'9.20% < 10%，保留原始记录',role:'system'},{id:'AU00005',time:'2026-10-09 14:18:00',actor:'质量管理员',action:'报警复核',detail:'AL20261009002 · 处置完成',role:'admin'},{id:'AU00006',time:'2026-10-09 14:30:00',actor:'系统',action:'MES确认',detail:'当前窗口 90 / 90 条记录已确认',role:'system'}];
    return state;
  }
  let state, sequence=0, memoryOnly=false;
  function load() {
    const initial=seed();
    try {
      const raw=root.localStorage && root.localStorage.getItem(KEY);
      if(!raw) return initial;
      const parsed=JSON.parse(raw);
      if(parsed.schemaVersion!==1) return initial;
      for(const field of ['tasks','specs','devices','records','alarms','recipes','reports','audits','users']) if(!Array.isArray(parsed[field])) return initial;
      for(const field of ['settings','mes','connections','reportTemplate']) parsed[field]={...initial[field],...(parsed[field]&&typeof parsed[field]==='object'?parsed[field]:{})};
      parsed.records.forEach(r=>{if(r.value===null||r.value===''||!Number.isFinite(Number(r.value))||r.validity==='invalid'){r.value=null;r.validity='invalid';r.judgement='invalid';} r.aux=r.aux||{};});
      return parsed;
    } catch(error) { memoryOnly=true; return initial; }
  }
  state=load();
  function id(prefix) {sequence++;return clean(prefix||'ID')+Date.now().toString(36).toUpperCase()+sequence.toString(36).toUpperCase();}
  const get = (array, key) => state[array].find(row=>row.id===key);
  function requireRow(array,key,message) {const row=get(array,key);if(!row)throw new Error(message||'记录不存在');return row;}
  function save() {try{if(root.localStorage){root.localStorage.setItem(KEY,JSON.stringify(state));memoryOnly=false;}else memoryOnly=true;}catch(error){memoryOnly=true;}return !memoryOnly;}
  function log(action,detail) {const entry={id:id('AU'),time:actualTime(),actor:HY.currentUser&&HY.currentUser.name||state.settings.currentUser||'质量管理员',role:HY.currentUser&&HY.currentUser.role||state.settings.currentRole||'admin',action:clean(action),detail:clean(detail)};state.audits.push(entry);save();return entry;}
  function commit(action,detail) {log(action,detail);save();}
  function currentRecords(metric) {const end=state.settings.demoTime;const start=timeAdd(end,-29*60);return state.records.filter(r=>r.time>=start&&r.time<=end&&(!metric||r.metric===metric)).sort((a,b)=>a.time.localeCompare(b.time));}
  function recordsFor(taskId) {return state.records.filter(r=>r.taskId===taskId).sort((a,b)=>a.time.localeCompare(b.time));}
  function createTask(input) {
    if(!input||typeof input!=='object')throw new Error('请输入任务信息');
    const workOrder=clean(input.workOrder),reelId=clean(input.reelId);
    if(!workOrder||!reelId)throw new Error('工单号和盘号不能为空');
    if(workOrder.length>80||reelId.length>80)throw new Error('工单号和盘号不能超过 80 个字符');
    const spec=requireRow('specs',input.specId,'请选择有效产品规格');
    if(!spec.enabled||![35,66,110,220].includes(Number(spec.voltage)))throw new Error('请选择启用的 35–220 kV 高压电缆规格');
    if(!metrics[input.metric]||!spec.metrics.includes(input.metric))throw new Error('此规格不适用于所选检测项目');
    const device=requireRow('devices',input.deviceId,'请选择执行设备');
    if(device.metric!==input.metric)throw new Error('设备与检测项目不匹配');
    const recipe=input.recipeId?requireRow('recipes',input.recipeId,'配方不存在'):state.recipes.filter(r=>r.metric===input.metric&&r.enabled).at(-1);
    if(!recipe||!recipe.enabled||recipe.metric!==input.metric)throw new Error('请选择适用于该检测项目的启用配方');
    const plannedLength=Number(input.plannedLength);
    if(!Number.isFinite(plannedLength)||plannedLength<=0||plannedLength>1000000)throw new Error('计划长度应在 0–1,000,000 米之间');
    if(state.tasks.some(t=>t.reelId===reelId&&t.metric===input.metric&&t.status!=='completed'))throw new Error('该盘号已有未完成的同项目检测任务');
    const task={id:id('T'),workOrder,reelId,specId:spec.id,metric:input.metric,deviceId:device.id,recipeId:recipe.id,ruleSnapshot:snapshot(recipe),status:'pending',startAt:null,endAt:null,createdAt:state.settings.demoTime,plannedLength,measuredLength:0};
    state.tasks.push(task);commit('创建检测任务',task.id+' · '+metrics[task.metric].name);return task;
  }
  function startTask(key) {
    const task=requireRow('tasks',key,'任务不存在');
    if(task.status!=='pending')throw new Error('只有待执行任务可以开始检测');
    const device=requireRow('devices',task.deviceId,'设备不存在');
    if(device.status!=='online')throw new Error('执行设备离线，请先恢复设备连接');
    if(state.tasks.some(t=>t.id!==key&&t.deviceId===task.deviceId&&t.status==='running'))throw new Error('该设备已有检测中的任务，请先完成当前任务');
    task.status='running';task.startAt=state.settings.demoTime;commit('开始检测',key);return task;
  }
  function updateAlarmRecovery(taskId,record) {
    if(record.judgement==='invalid')return;
    if(record.judgement==='pass')state.alarms.filter(a=>a.taskId===taskId&&a.active&&a.createdAt<record.time).forEach(a=>{a.active=false;a.recoveredAt=record.time;a.history.push({time:record.time,actor:'系统',note:'量测值恢复至阈值范围；人工处置状态保持不变',status:a.status});});
    if(record.judgement==='fail') {
      const recovery=recordsFor(taskId).find(r=>r.time>record.time&&r.judgement==='pass');
      state.alarms.push({id:id('AL'),recordId:record.id,taskId,metric:record.metric,active:!recovery,recoveredAt:recovery?recovery.time:null,status:'pending',createdAt:record.time,note:'检测到超限记录，请复核原始量测与工艺状态',history:[{time:record.time,actor:'系统',note:'记录超限事件，原始量测不会被后续恢复覆盖',status:'pending'}]});
    }
  }
  function advanceTask(key) {
    const task=requireRow('tasks',key,'任务不存在');
    if(task.status!=='running')throw new Error('只有检测中的任务可以生成下一条演示记录');
    const device=requireRow('devices',task.deviceId,'设备不存在');
    if(device.status!=='online')throw new Error('设备离线，未生成量测数据');
    const last=recordsFor(key).at(-1), time=timeAdd(last&&last.time>state.settings.demoTime?last.time:state.settings.demoTime,60), index=recordsFor(key).length;
    const value=state.settings.scenario==='invalid'?null:round(({dg:12.5,jx:1.8,by:4.3}[task.metric])+Math.sin(index*.55)*({dg:.55,jx:.24,by:.35}[task.metric]));
    const record={id:id('R'),taskId:key,metric:task.metric,deviceId:task.deviceId,reelId:task.reelId,workOrder:task.workOrder,time,meter:round(Math.min(task.plannedLength,task.measuredLength+10)),value,validity:value===null?'invalid':'valid',judgement:judge(value,task.metric,task.ruleSnapshot),ruleSnapshot:clone(task.ruleSnapshot),image:metrics[task.metric].image,source:'设备自动采集',platformStatus:'received',mesStatus:state.settings.scenario==='mes-failure'?'failed':state.mes.enabled?'confirmed':'pending',receivedAt:time,confirmedAt:state.settings.scenario==='mes-failure'||!state.mes.enabled?null:time,aux:aux(task.metric,value,index)};
    state.records.push(record);task.measuredLength=record.meter;state.settings.demoTime=time;device.lastSeen=time;updateAlarmRecovery(key,record);commit('生成演示量测',record.id+' · '+(value===null?'无效数据':value+' '+metrics[task.metric].unit));return record;
  }
  function completeTask(key) {
    const task=requireRow('tasks',key,'任务不存在');
    if(task.status!=='running')throw new Error('只有检测中的任务可以结束');
    if(!recordsFor(key).length)throw new Error('任务尚无检测记录，请先生成演示量测');
    task.status='completed';task.endAt=state.settings.demoTime;commit('完成检测任务',key+' · 完成状态不替代最终质量结论');return task;
  }
  function updateAlarm(key,input) {
    const alarm=requireRow('alarms',key,'报警不存在');
    if(!input||!['pending','processing','resolved'].includes(input.status))throw new Error('请选择有效的报警处理状态');
    const note=clean(input.note);
    if(!note)throw new Error('请输入复核或处置说明');
    if(input.status==='resolved'&&alarm.active)throw new Error('当前超限尚未恢复，需恢复量测后再完成处置');
    alarm.status=input.status;alarm.note=note;alarm.history.push({time:state.settings.demoTime,actor:clean(input.actor)||state.settings.currentUser||'质量管理员',note,status:input.status});commit('报警复核',key+' · '+note);return alarm;
  }
  function reviseRecipe(key,input) {
    const old=requireRow('recipes',key,'配方不存在');
    const threshold=Number(input&&input.threshold),operator=input&&input.operator||old.operator;
    if(!input||input.threshold===''||input.threshold===null||!Number.isFinite(threshold)||threshold<0||threshold>(old.metric==='jx'?100:100))throw new Error('请输入 0–100 范围内的有效阈值');
    if(operator!==metrics[old.metric].operator)throw new Error('搭盖率使用下限 ≥，铜丝间隙与不圆度使用上限 ≤');
    const versions=state.recipes.filter(r=>r.metric===old.metric);const minor=Math.max(...versions.map(r=>Number((r.version||'V1.0').split('.')[1])||0))+1;
    const next={...clone(old),id:old.metric.toUpperCase()+'-V1.'+minor,version:'V1.'+minor,threshold,operator,name:clean(input.name)||old.name,enabled:input.enabled===undefined?true:Boolean(input.enabled),createdAt:state.settings.demoTime,description:clean(input.description)||old.description};
    versions.forEach(r=>r.enabled=false);state.recipes.push(next);commit('发布配方新版本',old.id+' → '+next.id+'；历史任务与记录规则保持不变');return next;
  }
  function createReport(taskId) {
    const task=requireRow('tasks',taskId,'任务不存在'),records=recordsFor(taskId),alarms=state.alarms.filter(a=>a.taskId===taskId);
    if(!records.length)throw new Error('尚无检测记录，不能生成报告');
    if(task.status==='pending')throw new Error('待执行任务不能生成报告');
    const kind=task.status==='completed'?'final':'stage';
    if(kind==='final'&&alarms.some(a=>a.status!=='resolved'))throw new Error('请先完成关联报警的复核处置，再生成最终报告');
    if(kind==='final'&&!stats(records).valid)throw new Error('任务没有有效量测记录，不能生成最终报告');
    const report={id:id('RP'),taskId,kind,createdAt:state.settings.demoTime,snapshot:clone({task,spec:get('specs',task.specId),device:get('devices',task.deviceId),records,alarms,stats:stats(records),template:state.reportTemplate})};
    state.reports.push(report);commit('生成'+(kind==='stage'?'阶段':'最终')+'报告',report.id+' · '+taskId);return report;
  }
  function retrySync(recordIds) {
    if(recordIds!==undefined&&!Array.isArray(recordIds))throw new Error('待同步记录应为编号数组');
    if(!state.mes.enabled)throw new Error('MES 接口未启用');
    const requested=recordIds?new Set(recordIds):null;
    if(requested&&[...requested].some(key=>!get('records',key)))throw new Error('包含不存在的检测记录');
    const records=state.records.filter(r=>(!requested||requested.has(r.id))&&r.mesStatus!=='confirmed');
    let count=0;records.forEach(r=>{if(r.platformStatus!=='received')return;if(state.settings.scenario==='mes-failure'){r.mesStatus='failed';r.lastSyncError='演示 MES 连接失败，请切换正常场景后重试';return;}r.mesStatus='confirmed';r.confirmedAt=state.settings.demoTime;r.lastSyncError=null;count++;});
    state.mes.lastSync=state.settings.demoTime;commit('MES 同步重试',count+' 条已确认，'+(records.length-count)+' 条未确认；已确认记录不重复发送');return {count,failed:records.filter(r=>r.mesStatus==='failed').length,pending:records.filter(r=>r.mesStatus==='pending').length};
  }
  function importRecords(rows) {
    if(!Array.isArray(rows))throw new Error('导入内容必须为检测记录数组');
    if(rows.length>10000)throw new Error('单次最多导入 10,000 条记录');
    const errors=[],accepted=[];const seen=new Set(state.records.map(r=>[r.taskId,r.time,r.meter].join('|')));
    rows.forEach((row,index)=>{
      try{
        if(!row||typeof row!=='object')throw new Error('记录格式无效');
        const task=requireRow('tasks',clean(row.taskId),'请填写已存在的任务编号');
        const metric=clean(row.metric)||task.metric;
        if(!metrics[metric]||metric!==task.metric)throw new Error('检测项目必须为 dg / jx / by，且与任务一致');
        if(row.deviceId&&row.deviceId!==task.deviceId||row.reelId&&row.reelId!==task.reelId||row.workOrder&&row.workOrder!==task.workOrder)throw new Error('设备、盘号或工单号与任务不匹配');
        const time=clean(row.time).replace('T',' ').replace(/Z$/,'');
        if(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(time)||!Number.isFinite(Date.parse(time.replace(' ','T')+'Z')))throw new Error('时间格式应为 YYYY-MM-DD HH:mm:ss');
        if(new Date(time.replace(' ','T')+'Z').toISOString().slice(0,19).replace('T',' ')!==time)throw new Error('日期或时间超出有效范围');
        const meter=Number(row.meter);if(row.meter===''||row.meter===null||row.meter===undefined||!Number.isFinite(meter)||meter<0)throw new Error('米数位置必须为非负数字');
        const validity=clean(row.validity)||'valid';if(!['valid','invalid'].includes(validity))throw new Error('有效性仅支持 valid / invalid');
        let value=null;
        if(validity==='valid'){if(row.value===null||row.value===undefined||clean(row.value)===''||typeof row.value==='boolean'||!Number.isFinite(Number(row.value))||Number(row.value)<0)throw new Error('有效记录必须包含非负量测值，缺失值不能按零处理');value=Number(row.value);}
        const duplicate=[task.id,time,meter].join('|');if(seen.has(duplicate))throw new Error('同一任务、时间和米数的记录已存在');
        const record={id:id('R'),taskId:task.id,metric,deviceId:task.deviceId,reelId:task.reelId,workOrder:task.workOrder,time,meter,value,validity,judgement:judge(value,metric,task.ruleSnapshot,validity),ruleSnapshot:clone(task.ruleSnapshot),image:metrics[metric].image,source:'人工导入补录',platformStatus:'received',mesStatus:'pending',receivedAt:state.settings.demoTime,confirmedAt:null,aux:aux(metric,value,index)};
        accepted.push(record);seen.add(duplicate);
      }catch(error){errors.push({row:index+1,line:index+2,message:error.message});}
    });
    accepted.forEach(record=>{state.records.push(record);updateAlarmRecovery(record.taskId,record);});
    commit('导入检测记录',accepted.length+' 条成功，'+errors.length+' 条未导入');return {count:accepted.length,errors};
  }
  function setScenario(name) {
    if(!['offline','invalid','mes-failure','normal'].includes(name))throw new Error('未知演示场景');
    state.settings.scenario=name;
    state.devices.forEach(d=>d.status=name==='offline'&&d.metric==='dg'?'offline':'online');
    state.mes.status=name==='mes-failure'?'error':'connected';
    if(name==='mes-failure')currentRecords().slice(-3).forEach(r=>{if(!r.scenarioOriginal)r.scenarioOriginal={mesStatus:r.mesStatus,confirmedAt:r.confirmedAt};r.mesStatus='failed';r.confirmedAt=null;r.lastSyncError='演示 MES 连接失败';});
    if(name==='invalid') {
      const task=state.tasks.find(t=>t.status==='running'&&t.metric==='dg');
      if(task){const latest=recordsFor(task.id).at(-1);const time=timeAdd(state.settings.demoTime,60);const record={...clone(latest),id:id('R'),time,value:null,validity:'invalid',judgement:'invalid',aux:{},receivedAt:time,confirmedAt:time,scenarioGenerated:true};state.records.push(record);state.settings.demoTime=time;}
    }
    commit('切换演示场景',name==='normal'?'正常场景；历史无效、超限和失败记录保留，失败同步可单独重试':name);return state;
  }
  const Store={metrics,KEY,judge,stats,save,log,id,recordsFor,currentRecords,createTask,startTask,advanceTask,completeTask,updateAlarm,reviseRecipe,createReport,retrySync,importRecords,setScenario,
    task:key=>get('tasks',key),spec:key=>get('specs',key),device:key=>get('devices',key),recipe:key=>get('recipes',key),record:key=>get('records',key),alarm:key=>get('alarms',key),
    reset(){state=seed();sequence=0;save();return state;},
    get state(){return state;},get memoryOnly(){return memoryOnly;}
  };
  HY.Store=Store;
  if(typeof module!=='undefined'&&module.exports)module.exports=Store;
})(typeof window!=='undefined'?window:globalThis);
