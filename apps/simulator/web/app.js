'use strict';
const $=id=>document.getElementById(id);
const labels={SHIELD_OVERLAP_RATE:'金属屏蔽搭盖率',WIRE_GAP:'铜丝屏蔽间隙',OVALITY:'电缆不圆度'};
const scene={cable:'线缆过料检测',mixed:'混合场景',normal:'正常值',boundary:'阈值边界',over:'超限值',invalid:'无效值'};
const escape=value=>String(value??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const date=value=>value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'—';
let csrf='',connected=false,devices=[],selected='',before=0,nextBefore=null,polling=false,busy=false,lastDevices=0,runSignature='',state=null;

function signedIn(yes){$('login-view').hidden=yes;$('app-view').hidden=!yes;if(!yes){csrf='';connected=false;document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());}}
function error(message){$('global-error').textContent=message;$('global-error').hidden=!message;}
async function api(path,body){
  const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json','X-Sim-CSRF':csrf},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const value=await response.json();
  if(!response.ok){if(response.status===401&&path!=='/login')signedIn(false);throw Error(value.message||'请求未完成');}
  return value;
}
function assignment(){
  const device=devices.find(d=>d.device_id===$('device').value),a=device?.assignment;
  $('start-run').disabled=busy||!connected||!a;
  $('assignment').className='assignment'+(a?'':' missing');
  if(!connected){$('assignment').textContent='后端离线时不能启动新采样。本地历史与队列仍可查看。';return;}
  if(!a){$('assignment').textContent='该设备暂无运行中的任务。请先在平台创建并开始检测任务，再刷新设备状态。';return;}
  $('assignment').innerHTML=`<strong>${escape(labels[a.metric_code]||a.metric_code)} · 已分配任务</strong><br>任务：<span class="mono">${escape(a.task_id)}</span><br>盘号ID：<span class="mono">${escape(a.spool_id)}</span><br>规格：${escape(a.specification_id)} · 绑定版本 ${escape(a.binding_version)}`;
}
async function refreshDevices(){
  const result=await api('/devices');lastDevices=Date.now();connected=result.connected;devices=result.devices;
  $('connection-pill').textContent=connected?'后端已连接':'后端不可用';$('connection-pill').className='pill '+(connected?'good':'bad');
  $('connection-banner').className='banner'+(connected?'':' offline');$('connection-banner').hidden=connected;
  $('connection-banner').textContent=connected?'通过独立设备接口读取平台分配。先在平台准备任务，再开始模拟；所有数据均标记为 SIMULATED。':result.message+'。暂停、停止和历史查询仍可使用。';
  const selectedDevice=$('device').value;
  const html=devices.map(d=>`<option value="${escape(d.device_id)}">${escape(labels[d.metric_codes[0]]||d.metric_codes[0])} · ${escape(d.device_id)}</option>`).join('')||'<option value="">暂无可用设备</option>';
  if($('device').innerHTML!==html){$('device').innerHTML=html;if(devices.some(d=>d.device_id===selectedDevice))$('device').value=selectedDevice;}
  const productionSelected=$('production-device').value;
  $('production-device').innerHTML=html;if(devices.some(d=>d.device_id===productionSelected))$('production-device').value=productionSelected;
  syncDetectorDevices();previewFeed();
  assignment();
}
function runStatus(run){
  const job=run.job;
  if(job?.status==='STOPPING')return ['停止中','warn'];
  if(['RUNNING','STARTING'].includes(job?.status))return run.control==='PAUSED'&&job.command==='run'?['已暂停','warn']:[job.command==='replay'?'重放中':job.command==='drain'?'补传中':'采集中','good'];
  if(job?.status==='FAILED')return ['执行失败','bad'];
  if(job?.status==='INTERRUPTED')return ['服务中断','warn'];
  if(run.control==='STOPPED')return ['已停止',''];
  if(run.pending)return ['等待补传','warn'];
  return [run.generated>=run.target?'已完成':'采样未完成',''];
}
function button(action,name,disabled=false,danger=false){return `<button data-action="${action}" ${disabled?'disabled':''} class="${danger?'danger':''}">${name}</button>`;}
function renderRuns(data){
  const signature=JSON.stringify([data.runs,data.starting,selected,connected]);if(signature===runSignature)return;runSignature=signature;
  const focused=document.activeElement,focusRun=focused?.closest('[data-run]')?.dataset.run,focusAction=focused?.dataset.action;
  $('run-count').textContent=data.runs.length;
  $('starting').hidden=!data.starting.length;$('starting').textContent=data.starting.length?'正在准备设备绑定与采集进程…':'';
  if(!data.runs.length){$('run-list').innerHTML='<div class="empty"><svg viewBox="0 0 80 80" fill="none" aria-hidden="true"><rect x="17" y="12" width="46" height="56" rx="6" stroke="currentColor" stroke-width="2"/><path d="M27 28h26M27 39h17M27 50h22" stroke="currentColor" stroke-width="2"/><circle cx="59" cy="59" r="13" fill="#f5f9ff" stroke="currentColor" stroke-width="2"/><path d="M53 59h12M59 53v12" stroke="currentColor" stroke-width="2"/></svg><h3>还没有模拟运行</h3><p>选择设备和场景后开始模拟。<br>服务启动不会自动生成检测数据。</p></div>';return;}
  $('run-list').innerHTML=data.runs.map(run=>{
    const [name,tone]=runStatus(run),active=['STARTING','RUNNING','STOPPING'].includes(run.job?.status),sampling=active&&run.job?.command==='run',paused=run.control==='PAUSED',stopping=run.job?.status==='STOPPING';
    return `<article class="run-card ${selected===run.id?'selected':''}" data-run="${escape(run.id)}"><div class="run-heading"><span class="run-title">${escape(labels[run.metric_code]||run.device_id)} · ${escape(scene[run.scenario])}</span><span class="badge ${tone}">${name}</span></div><p class="run-meta">${escape(run.device_id)} · ${escape(date(run.created_at))}<br><span class="mono">${escape(run.id)}</span></p><div class="run-progress"><div class="track"><span style="width:${Math.min(100,100*run.generated/run.target)}%"></span></div><span>${run.generated} / ${run.target} 条</span></div><div class="run-counts"><span>已存储<b>${run.stored}</b></span><span>待确认<b>${run.pending}</b></span><span>隔离<b>${run.quarantined}</b></span><span>拒绝<b>${run.rejected}</b></span></div><div class="actions">${button('detail','查看明细')}${run.scenario==='cable'?button('finish','重试出料',active):''}${sampling&&!paused?button('pause','暂停',stopping):button('resume','继续采集',stopping||(!sampling&&active)||run.generated>=run.target||!connected)}${button('stop','停止',!active||stopping,true)}${button('drain','补传队列',active||run.pending===0)}${button('replay','原键重放',active||run.generated===0)}</div>${run.job?.message?`<p class="error">${escape(run.job.message)}</p>`:''}</article>`;
  }).join('');
  if(focusRun&&focusAction){const card=[...$('run-list').querySelectorAll('[data-run]')].find(node=>node.dataset.run===focusRun);const replacement=card?.querySelector(`[data-action="${focusAction}"]`);if(replacement&&!replacement.disabled)replacement.focus({preventScroll:true});}
}
function drawChart(items){
  const samples=[...items].reverse(),valid=samples.filter(r=>r.payload.values[0].value!==null);
  if(!valid.length){$('chart').innerHTML='<p class="muted small">当前窗口暂无有效数值；无效值不绘制为零。</p>';return;}
  const values=valid.map(r=>Number(r.payload.values[0].value)),min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.15,Math.abs(max)*.005,.000001),low=min-pad,high=max+pad;
  const x=i=>55+i*890/Math.max(1,samples.length-1),y=v=>140-(v-low)/(high-low)*115;
  let path='',open=false;
  for(let i=0;i<samples.length;i++){const value=samples[i].payload.values[0].value;if(value===null){open=false;continue;}path+=(open?' L':' M')+x(i).toFixed(2)+' '+y(Number(value)).toFixed(2);open=true;}
  const dots=samples.map((r,i)=>r.payload.values[0].value===null?'':`<circle cx="${x(i)}" cy="${y(Number(r.payload.values[0].value))}" r="3" fill="#5189d3"><title>${escape(r.record_id)}：${escape(r.payload.values[0].value)}</title></circle>`).join('');
  $('chart').innerHTML=`<div class="chart-label"><span>当前窗口测量值 · ${escape(valid[0].payload.values[0].unit)}（无效点断开）</span><span>采样序号 ${samples[0].sequence}—${samples.at(-1).sequence}</span></div><svg viewBox="0 0 1000 170" preserveAspectRatio="none" role="img" aria-label="当前窗口真实样本数值趋势"><path d="M55 25H945M55 82H945M55 140H945" stroke="#e8eef6"/><path d="${path}" fill="none" stroke="#5189d3" stroke-width="2"/>${dots}</svg><p class="muted small">窗口范围 ${escape(min.toPrecision(6))} — ${escape(max.toPrecision(6))} ${escape(valid[0].payload.values[0].unit)}；精确值见下表。</p>`;
}
async function detail(){
  if(!selected||!state?.runs.some(r=>r.id===selected))return;
  const runId=selected,pageBefore=before;
  const result=await api('/runs/'+encodeURIComponent(runId)+(pageBefore?'?before='+pageBefore:''));
  if(result.run.id!==selected||before!==pageBefore)return;
  $('detail-panel').hidden=false;$('detail-name').textContent=result.run.id;
  $('detail-context').innerHTML=`<span>设备：${escape(result.run.device_id)}</span><span>任务：<span class="mono">${escape(result.run.assignment.task_id)}</span></span><span>固定种子：${result.run.seed}</span><span>位置资格：未验证</span>`;
  nextBefore=result.next_before;$('older').disabled=!result.has_more;$('latest').disabled=before===0;
  drawChart(result.items);if(result.run.scenario==='cable')await comparison(runId);else $('comparison-panel').hidden=true;
  $('samples').innerHTML=result.items.map(r=>{
    const value=r.payload.values[0],receipt=r.receipt,status=receipt?.receipt_status||r.state;
    const tone=['REJECTED','QUARANTINED'].includes(status)?'bad':['STORED','DUPLICATE'].includes(status)?'good':'warn';
    return `<tr><td>${r.sequence}<span class="record-key mono">${escape(r.record_id)}</span></td><td class="mono">${escape(r.payload.sample_time)}</td><td>${escape(r.payload.position_m)}</td><td>${value.value===null?'—':escape(value.value)+' '+escape(value.unit)}<br><span class="muted">设备：${value.source_quality_result==='FAIL'?'异常':value.source_quality_result==='PASS'?'正常':'未判定'}</span></td><td>${value.data_status==='VALID'?'有效':value.data_status==='INVALID'?'无效':'缺失'}</td><td><span class="badge ${tone}">${escape(status)}</span><br>尝试 ${r.attempts} 次</td><td class="mono">${escape(receipt?.stored_id)}${receipt?.error_code?'<br>'+escape(receipt.error_code):''}</td></tr>`;
  }).join('')||'<tr><td colspan="7" class="muted">尚无样本；不会补造记录。</td></tr>';
  $('logs').innerHTML=result.logs.map(log=>`<div class="log-row"><span>${escape(date(log.at))}</span><span>${escape(log.event)}</span><code>${escape(log.detail)}</code></div>`).join('')||'<p class="muted small">暂无Web执行日志</p>';
}
async function refresh(forceDevices=false){
  if(!csrf||polling)return;polling=true;
  try{
    state=await api('/state');lastStateAt=Date.now();liveRequestFailed=false;if(lastRefreshError&&$('global-error').textContent===lastRefreshError)error('');lastRefreshError='';const t=state.totals;
    $('total-generated').textContent=t.generated;$('total-pending').textContent=t.pending;$('total-stored').textContent=t.stored;$('total-exceptions').textContent=t.quarantined+' / '+t.rejected;
    $('updated').textContent='更新于 '+new Date(state.as_of).toLocaleTimeString('zh-CN',{hour12:false});
    renderRuns(state);renderLive(state);if(forceDevices||Date.now()-lastDevices>30000)await refreshDevices();if(forceDevices||Date.now()-lastModels>5000)await refreshModels();
    if(selected&&activeTab==='settings'&&$('run-history').open)await detail();
  }catch(e){liveRequestFailed=true;updateFreshness();lastRefreshError=e.message==='Failed to fetch'?'模拟器服务暂时不可用，恢复后会继续读取历史。':e.message;error(lastRefreshError);}finally{polling=false;}
}
$('login-form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;$('login-error').textContent='';try{const result=await api('/login',{username:form.username.value,password:form.password.value});form.password.value='';csrf=result.csrf;signedIn(true);error('');await refresh(true);}catch(e){$('login-error').textContent=e.message;}finally{button.disabled=false;}});
$('logout').addEventListener('click',async()=>{try{await api('/logout',{});signedIn(false);}catch(e){error(e.message);}});
$('run-history').addEventListener('toggle',()=>{if($('run-history').open&&selected)void detail().catch(e=>error(e.message));});
$('device').addEventListener('change',assignment);
$('run-form').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;busy=true;assignment();$('form-error').textContent='';
  try{const result=await api('/runs',{request_id:crypto.randomUUID(),device_id:$('device').value,scenario:$('scenario').value,count:Number($('count').value),interval_ms:Number($('interval').value),seed:Number($('seed').value)});selected=result.run_id;before=0;$('detail-panel').hidden=true;error('');await refresh();}
  catch(e){$('form-error').textContent=e.message;}finally{busy=false;assignment();}
});
$('run-list').addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;const id=button.closest('[data-run]').dataset.run,action=button.dataset.action;
  if(action==='finish'){button.disabled=true;try{await api('/passes/'+encodeURIComponent(id)+'/finish',{});selected=id;await refresh();}catch(e){error(e.message);}return;}
  if(action==='detail'){$('run-history').open=true;selected=id;before=0;runSignature='';renderRuns(state);try{await detail();$('detail-panel').scrollIntoView({behavior:'smooth',block:'start'});}catch(e){error(e.message);}return;}
  button.disabled=true;try{await api('/runs/'+encodeURIComponent(id)+'/control',{action});liveRunId=id;error('');await refresh();}catch(e){error(e.message);}finally{runSignature='';}
});
$('refresh').addEventListener('click',()=>refresh(true));
$('older').addEventListener('click',()=>{if(nextBefore){before=nextBefore;detail().catch(e=>error(e.message));}});
$('latest').addEventListener('click',()=>{before=0;detail().catch(e=>error(e.message));});
setInterval(()=>{if(Date.now()-lastPollAt>=pollMs){lastPollAt=Date.now();void refresh();}updateFreshness();},250);
api('/session').then(result=>{csrf=result.csrf;signedIn(true);refresh(true);}).catch(()=>signedIn(false));

const productionForm=$('production-form');
productionForm.elements.encounter_id.value='pass-'+crypto.randomUUID();
let productionRetry=JSON.parse(sessionStorage.getItem('production-retry')||'null');
if(productionRetry)for(const [k,v] of Object.entries(productionRetry.input))if(productionForm.elements[k]&&k!=='device_id')productionForm.elements[k].value=v;
$('new-encounter').onclick=()=>{productionForm.elements.encounter_id.value='pass-'+crypto.randomUUID();productionForm.elements.phase.value='ENTER';productionForm.elements.task_id.value='';productionForm.elements.spool_id.value='';productionForm.elements.material_ref.value='';productionForm.elements.value_m.value='';};
async function productionHistory(){const rows=await api('/production-events');$('production-history').innerHTML=rows.map(x=>`<p>${escape(x.device_id)} · ${escape(x.payload.phase)} · ${escape(x.payload.encounter_id)} · ${escape(x.response?.task_code||'未取得成功回执')} · ${escape(x.response?.reported_length_m??'长度未知')}</p>`).join('')||'暂无事件';}
productionForm.onsubmit=async e=>{e.preventDefault();const input=Object.fromEntries(new FormData(productionForm));const signature=JSON.stringify(input);if(productionRetry?.signature!==signature)productionRetry={signature,input,request_id:crypto.randomUUID()};sessionStorage.setItem('production-retry',JSON.stringify(productionRetry));const button=productionForm.querySelector('[type=submit]');button.disabled=true;
try{const r=await api('/production-events',{...input,request_id:productionRetry.request_id});$('production-result').textContent=`任务 ${r.task_code} · 盘ID ${r.spool_id} · ${r.state} · 上报长度 ${r.reported_length_m??'未知'} m · ${r.duplicate?'重复回执':'已接收'}`;await refreshDevices();await productionHistory();}catch(err){$('production-result').textContent=err.message;}finally{button.disabled=false;}};
$('production-history').parentElement.addEventListener('toggle',()=>{if($('production-history').parentElement.open)productionHistory().catch(e=>error(e.message));});
