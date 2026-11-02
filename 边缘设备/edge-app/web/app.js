const $ = s => document.querySelector(s);
const UI_VERSION='1.9.0';
function syncUIVersion(s){
 const changed=Boolean(s.version&&s.version!==UI_VERSION),button=$('#ui-update');button.hidden=!changed;
 if(!changed)return;button.onclick=()=>location.reload();
 if(!['IDLE','ENDED'].includes(s.state)||document.querySelector('dialog[open]'))return;
 try{if(sessionStorage.getItem('edge-ui-reload')===s.version)return;sessionStorage.setItem('edge-ui-reload',s.version);location.reload()}catch{}
}
let state, csrf='', incoming=[], historyRun='', after=0, recordChart;
const chart=echarts.init($('#chart'),null,{renderer:'canvas'});
const time = (v,full=false) => v ? new Date(v).toLocaleString('sv-SE',{timeZone:'Asia/Shanghai',...(full?{}:{hour:'2-digit',minute:'2-digit',second:'2-digit'})}) : '—';
const text=(id,v)=>{$('#'+id).textContent=v};
const num=(v,d=3)=>v==null?'—':Number(v).toFixed(d);
const names={IDLE:'已关机',WAITING_SCAN:'已开机 · 等待扫码',RUNNING:'已开机 · 采集中',PAUSED:'已暂停',STOPPING:'正在关机',SYNC_PENDING:'任务同步中',ENDED:'已关机',FAULT:'保存异常',INTERRUPTED:'采集中断'};
async function api(path,body,method='POST') { const r=await fetch('/api/'+path,body===undefined?{}:{method,headers:{'Content-Type':'application/json','X-Edge-CSRF':csrf},body:JSON.stringify(body)});if(!r.ok){let msg;try{msg=(await r.json()).error}catch{msg=await Promise.resolve('请求失败，请重试（'+r.status+'）')};throw Error(msg)}return r.json() }
function warn(msg){$('#alert').hidden=!msg;text('alert',msg||'')}
function show(id){$('#'+id).querySelectorAll('.form-error').forEach(x=>x.textContent='');$('#'+id).showModal()}
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('#fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch(e){warn('无法切换全屏，请使用键盘 F11')}};
const bFields=['transport','endpoint','baud','parity','stopBits','slave','address','scale','intervalMs','timeoutMs'];
const bName=k=>'b'+k[0].toUpperCase()+k.slice(1);
function toggleB(){const f=$('#settings-form');for(const k of bFields){const input=f.elements[bName(k)];input.disabled=!f.elements.bEnabled.checked;input.required=f.elements.bEnabled.checked}}
$('#settings-form').elements.bEnabled.onchange=toggleB;
$('#settings').onclick=()=>{const f=$('#settings-form');Object.entries(state.config).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=v??''});
 const b=state.config.b||{...state.config,enabled:false,transport:'rtu',endpoint:''};f.elements.bEnabled.checked=!!b.enabled;for(const k of bFields)f.elements[bName(k)].value=b[k]??'';toggleB();
 const configs=state.syncConfigs||[];text('sync-config-summary',configs.length?configs.map(v=>v.deviceId+' · V'+v.revision+' · '+(v.distanceMm==null?'旧时间配置，请重新填写距离':v.distanceMm+' mm · 时间取自计米器')).join('；'):'尚未收到安装距离；请在4182初始化配置中填写并推送。');show('settings-dialog')};
$('#settings-form').onsubmit=async ev=>{ev.preventDefault();const f=ev.target,d={...state.config,b:{...state.config.b,enabled:f.elements.bEnabled.checked}};
 for(const k of ['deviceId','transport','endpoint','parity'])d[k]=f.elements[k].value;
 for(const k of ['baud','stopBits','slave','address','scale','intervalMs','timeoutMs'])d[k]=Number(f.elements[k].value);
 d.lower=f.elements.lower.value===''?null:Number(f.elements.lower.value);delete d.sync;
 if(d.b.enabled)for(const k of bFields)d.b[k]=['transport','endpoint','parity'].includes(k)?f.elements[bName(k)].value:Number(f.elements[bName(k)].value);
 await submit(f,async()=>{await api('config',d);$('#settings-dialog').close()})};
async function submit(f,fn){const b=f.querySelector('[type=submit]');if(b)b.disabled=true;try{await fn()}catch(e){f.querySelector('.form-error').textContent=e.message}finally{if(b)b.disabled=false}}
let scanSending=false,scanError='',scanRequest=null;
$('#primary').onclick=async()=>{try{scanError='';apply(await api('start',{}))}catch(e){warn(e.message)}};
async function submitScan(code){
 if(scanSending||!code.trim())return;
 scanSending=true;scanError='';
 try{if(!scanRequest||scanRequest.code!==code.trim())scanRequest={code:code.trim(),id:crypto.randomUUID()};apply(await api('scan',{barcode:code.trim(),request_id:scanRequest.id}));scanRequest=null}
 catch(e){scanError='扫码失败：'+e.message;warn(scanError)}
 finally{scanSending=false}
}
$('#end').onclick=()=>show('confirm-dialog');$('#confirm-end').onclick=async()=>{try{$('#confirm-end').disabled=true;apply(await api('end',{}));$('#confirm-dialog').close()}catch(e){$('#confirm-dialog .form-error').textContent=e.message}finally{$('#confirm-end').disabled=false}};
// Keyboard-wedge scanners deliver text followed by Enter, including while the
// dashboard is showing the current run. Editable fields retain normal input.
let wedge='',wedgeAt=0;
document.addEventListener('keydown',ev=>{if(ev.target.closest('input,textarea,select')||document.querySelector('dialog[open]')||!['WAITING_SCAN','RUNNING','PAUSED'].includes(state?.state))return;const now=Date.now();if(now-wedgeAt>1000)wedge='';wedgeAt=now;if(ev.key==='Enter'){if(wedge){const code=wedge;wedge='';ev.preventDefault();void submitScan(code)}}else if(ev.key.length===1&&!ev.ctrlKey&&!ev.metaKey)wedge+=ev.key;});
function el(tag,textValue,cls){let n=document.createElement(tag);n.textContent=textValue;if(cls)n.className=cls;return n}
$('#history').onclick=async()=>{try{const runs=await api('runs');$('#run-list').replaceChildren();$('#record-detail').hidden=true;$('#run-list').hidden=false;if(!runs.length)$('#run-list').append(el('p','暂无检测记录，开始采集后将自动保存。'));for(const r of runs){let card=el('div','','run-card'),info=el('div','');info.append(el('strong',r.order.code+' · '+r.order.spool+(r.order.scanRound?' · 第'+r.order.scanRound+'次采集':'')),el('p',time(r.started,true)+' · '+(names[r.state]||r.state)),el('p','采样 '+r.count+' 条 · 无效 '+r.invalid+' 条 · 圆整度低于下限 '+r.below+' 条'));let b=el('button','查看记录');b.onclick=()=>openRun(r);card.append(info,b);$('#run-list').append(card)}show('history-dialog')}catch(e){warn(e.message)}};
async function openRun(r){historyRun=r.id;after=0;$('#run-list').hidden=true;$('#record-detail').hidden=false;text('detail-title',r.order.code+' · '+r.order.spool+(r.order.scanRound?' · 第'+r.order.scanRound+'次采集':''));$('#export').href='/api/export?run='+encodeURIComponent(r.id);$('#record-rows').replaceChildren();if(!recordChart)recordChart=echarts.init($('#record-chart'));recordChart.resize();await loadRecords(r.config.lower)}
async function loadRecords(lower){try{
 const rows=await api('records?run='+encodeURIComponent(historyRun)+'&after='+after);if(rows.length)after=rows.at(-1).id;historyChartRows=rows;
 $('#record-rows').replaceChildren(...rows.slice(0,100).map(s=>{const tr=document.createElement('tr');
 [time(s.at,true)+'.'+new Date(s.at).getMilliseconds().toString().padStart(3,'0'),gaugeOf(s),s.x??'—',s.y??'—',gaugeOf(s)==='A'?(axialMean(s)??'—'):'—',gaugeOf(s)==='A'?(s.ratio??'—'):'—',s.sheath?.value??'—',s.reason||(s.verdict==='FAIL'?'圆整度低于下限':s.verdict==='PASS'?'圆整度符合':'仅测量')].forEach(v=>tr.append(el('td',String(v))));return tr}));
 drawHistory(lower);text('record-summary','本页 '+rows.length+' 条，表格显示前100条；护套厚度按当时配对结果保存，CSV包含原始时间与配对记录ID。');$('#more-records').disabled=rows.length<5000;$('#more-records').onclick=()=>loadRecords(lower)
 }catch(e){text('record-summary',e.message)}}
$('#back-runs').onclick=()=>{$('#run-list').hidden=false;$('#record-detail').hidden=true};
new ResizeObserver(()=>chart.resize()).observe($('#chart'));new ResizeObserver(()=>recordChart?.resize()).observe($('#record-chart'));refresh();




