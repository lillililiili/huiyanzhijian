'use strict';
// Four business results, three physical producers. All choices come from the
// authenticated server; stale selection is revalidated when a pass is created.
const parallelMetricNames={...labels,SHEATH_THICKNESS:'护套厚度'};
let parallelData=null,parallelLoading=false,parallelFresh=false,parallelBusy=false,parallelCable='',parallelSelected=new Set(),parallelAttempt=null,parallelLast=0;
const legacyFeedPanel=$('feed-form').closest('section');
legacyFeedPanel.insertAdjacentHTML('beforebegin',`<section class="panel parallel-panel" id="parallel-panel">
 <div class="parallel-heading"><div><span class="eyebrow">多设备并行送料</span><h2>一盘线缆，同时检测</h2><p class="muted small">不同设备独立送料；双测径设备一次采集，同时生成不圆度与护套厚度两项结果。</p></div><button type="button" id="parallel-refresh">刷新可用任务</button></div>
 <form id="parallel-form"><label>选择可送料线缆<select id="parallel-cable" required><option value="">正在读取…</option></select></label>
 <div class="parallel-selection"><strong id="parallel-context">已扫码、已配置且空闲的设备才可选择</strong><button type="button" class="quiet" id="parallel-all">全选可用设备</button></div>
 <div id="parallel-routes" class="parallel-grid"></div><div class="parallel-submit"><button class="primary" type="submit" id="parallel-start" disabled>开始送料</button><span id="parallel-count" class="muted small"></span></div>
 </form><p id="parallel-status" role="status" aria-live="polite"></p><div id="parallel-results" aria-live="polite"></div><button id="parallel-retry" type="button" hidden>重试未确认设备</button>
 <details class="parallel-help"><summary>没有找到要送料的设备？</summary><p class="small muted">先创建检测任务并扫码，再配置线缆规格与设备参数。正在送料的设备请在下方运行卡片操作；不可用设备不进入选择列表。</p><div id="parallel-unavailable" class="small"></div><a href="#scanner">去扫码</a> · <a href="#specs">配置规格与缺陷</a></details>
</section>`);
$('live-panel').insertAdjacentHTML('beforebegin','<section class="panel parallel-panel" id="parallel-runs-panel"><div class="parallel-heading"><h2>并行送料状态</h2><span class="small muted">各设备独立暂停、停止与调速</span></div><div class="parallel-grid" id="parallel-runs"></div></section>');
$('parallel-runs-panel').before($('parallel-panel'));
$('parallel-panel').insertAdjacentHTML('beforebegin','<div class="parallel-heading"><label class="small">送料方式 <select id="parallel-mode"><option value="BOUND">已扫码任务 · 支持多设备</option><option value="AUTO">自动发现 · 单设备</option></select></label></div>');
$('parallel-mode').onchange=()=>{$('feed-mode').value=$('parallel-mode').value;previewFeed();};
const liveDetails=document.createElement('details');liveDetails.className='parallel-live-details';liveDetails.innerHTML='<summary>单路详细控制 · 暂停、继续、调速与检测记录</summary>';$('live-panel').before(liveDetails);liveDetails.append($('live-panel'));
$('scanner-flow').insertAdjacentHTML('afterend','<section class="panel parallel-panel"><div class="parallel-heading"><div><h2>各设备订单</h2><p class="small muted">可连续扫描不同设备的任务码并行检测；同设备换码只切换该设备。双测径同步启动不圆度与护套两个任务。</p></div><button id="parallel-scanner-refresh" type="button">刷新设备状态</button></div><div id="parallel-scanners" class="parallel-grid"></div><p id="parallel-scanner-error" role="status"></p></section>');

function parallelCount(){
 const cable=parallelData?.cables.find(c=>c.id===parallelCable),chosen=cable?.routes.filter(r=>parallelSelected.has(r.device_id))||[];
 $('parallel-start').disabled=parallelBusy||!parallelFresh||!chosen.length;
 $('parallel-start').textContent=parallelBusy?'正在启动…':`开始 ${chosen.length} 路送料`;
 $('parallel-count').textContent=chosen.length?`${chosen.reduce((n,r)=>n+r.metrics.length,0)} 项检测 · 每台设备独立运行`:'勾选本次需要送料的设备';
}
function renderParallelChoices(){
 const cables=parallelData?.cables||[];
 if(!cables.some(c=>c.id===parallelCable)){parallelCable=cables.length===1?cables[0].id:'';parallelSelected.clear();}
 const html='<option value="">'+(cables.length?'请选择可送料线缆':'暂无可送料线缆')+'</option>'+cables.map(c=>`<option value="${escape(c.id)}">${escape(c.name)} · ${escape(c.order)} · ${c.routes.length} 台可用设备</option>`).join('');
 if($('parallel-cable').innerHTML!==html)$('parallel-cable').innerHTML=html;
 $('parallel-cable').value=parallelCable;$('parallel-cable').disabled=parallelBusy||!parallelFresh;
 const cable=cables.find(c=>c.id===parallelCable);
 parallelSelected=new Set([...parallelSelected].filter(id=>cable?.routes.some(r=>r.device_id===id)));
 $('parallel-context').textContent=cable?`${cable.name} · 线长 ${cable.length_m} m`:'选择线缆后勾选检测设备';
 $('parallel-all').disabled=!cable||parallelBusy||!parallelFresh;
 $('parallel-routes').innerHTML=cable?cable.routes.map(r=>`<label class="parallel-route ${parallelSelected.has(r.device_id)?'selected':''}"><div class="parallel-route-title"><input type="checkbox" data-parallel-device="${escape(r.device_id)}" ${parallelSelected.has(r.device_id)?'checked':''} ${parallelBusy||!parallelFresh?'disabled':''}><strong>${escape(r.name)}</strong></div><span class="small muted">${escape(r.device_id)}</span><div class="parallel-metrics">${r.metrics.map(metric=>`<span class="badge good">${escape(parallelMetricNames[metric])}</span>`).join('')}</div><p class="small">任务 ${escape(r.task_code)}${r.paired_task_code?' / '+escape(r.paired_task_code):''}</p><p class="small muted">${escape(r.speed_m_min)} m/min · ${r.interval_ms} ms/点 · 预计 ${r.count} 点${r.metrics.length===2?' · 同步采集两项':''}</p></label>`).join(''):'<div class="parallel-empty">'+(cables.length?'请选择线缆，查看可并行检测的设备。':'当前没有满足送料条件的任务。请先扫码并完成规格配置，或等待正在运行的送料结束。')+'</div>';
 $('parallel-unavailable').innerHTML=(parallelData?.unavailable||[]).map(r=>`<p>${escape(r.device_id)}：${escape(r.reason)}</p>`).join('');
 parallelCount();
}
async function refreshParallelChoices(force=false){
 if(parallelLoading||parallelBusy||activeTab!=='feed'||$('app-view').hidden||(!force&&Date.now()-parallelLast<5000))return;
 parallelLoading=true;parallelLast=Date.now();$('parallel-refresh').disabled=true;
 try{parallelData=await api('/feed-options');parallelFresh=true;parallelLast=Date.now();$('parallel-status').textContent='可用任务更新于 '+date(parallelData.checked_at);renderParallelChoices();}
 catch(e){parallelFresh=false;$('parallel-status').textContent='可用任务读取失败：'+e.message;renderParallelChoices();}
 finally{parallelLoading=false;$('parallel-refresh').disabled=false;}
}
$('parallel-cable').onchange=()=>{parallelCable=$('parallel-cable').value;parallelSelected.clear();renderParallelChoices();};
$('parallel-routes').onchange=e=>{const id=e.target.dataset.parallelDevice;if(!id)return;e.target.checked?parallelSelected.add(id):parallelSelected.delete(id);renderParallelChoices();};
$('parallel-all').onclick=()=>{const routes=parallelData?.cables.find(c=>c.id===parallelCable)?.routes||[];parallelSelected=new Set(routes.map(r=>r.device_id));renderParallelChoices();};
$('parallel-refresh').onclick=()=>void refreshParallelChoices(true);
function persistParallelAttempt(){try{if(parallelAttempt)sessionStorage.setItem('par01-pending',JSON.stringify(parallelAttempt));else sessionStorage.removeItem('par01-pending');}catch{}}
try{parallelAttempt=JSON.parse(sessionStorage.getItem('par01-pending')||'null');}catch{}
if(parallelAttempt?.items?.length){$('parallel-retry').hidden=false;$('parallel-results').textContent='上次送料请求尚有未确认项，重试将使用原请求编号，不会重复启动已成功设备。';}
async function submitParallel(){
 if(parallelBusy||!parallelAttempt?.items.length)return;
 parallelBusy=true;$('parallel-retry').disabled=true;renderParallelChoices();
 const attempt=parallelAttempt;
 try{const result=await api('/parallel-passes',{items:attempt.items});
  const accepted=new Set(result.results.filter(r=>r.ok).map(r=>r.request_id));
  $('parallel-results').innerHTML=result.results.map(r=>{const info=attempt.names[r.request_id];return `<p class="${r.ok?'':'error'}">${escape(info)} · ${r.ok?'启动请求已受理，运行结果见下方状态卡':escape(r.message)}</p>`;}).join('');
  parallelAttempt={...attempt,items:attempt.items.filter(i=>!accepted.has(i.request_id))};
  if(!parallelAttempt.items.length)parallelAttempt=null;
  const run=result.results.find(r=>r.ok)?.job?.run_id;if(run)liveRunId=run;
  parallelSelected.clear();await refresh();
 }catch(e){$('parallel-results').textContent='请求结果未确认：'+e.message+'。请重试原请求。';}
 finally{persistParallelAttempt();parallelBusy=false;$('parallel-retry').disabled=false;$('parallel-retry').hidden=!parallelAttempt;renderParallelChoices();void refreshParallelChoices(true);}
}
$('parallel-form').onsubmit=e=>{
 e.preventDefault();if(parallelBusy||!parallelFresh)return;
 if(parallelAttempt){$('parallel-results').textContent='请先重试未确认设备，避免重复发起送料。';return;}
 const routes=parallelData?.cables.find(c=>c.id===parallelCable)?.routes.filter(r=>parallelSelected.has(r.device_id))||[];
 if(!routes.length)return;const names={};const items=routes.map(r=>{const request_id=crypto.randomUUID();names[request_id]=r.name+' · '+r.task_code;return {...r.input,request_id};});
 parallelAttempt={items,names};persistParallelAttempt();void submitParallel();
};
$('parallel-retry').onclick=()=>void submitParallel();

const previousLive=renderLive;
renderLive=function(data){previousLive(data);
 const rows=[...(data.starting||[]).map(j=>({id:j.run_id,device_id:j.device_id,job:j,generated:0,target:0})),...(data.runs||[])].filter(r=>['STARTING','RUNNING','STOPPING'].includes(r.job?.status)||r.pending>0);
 $('parallel-runs').innerHTML=rows.map(r=>`<article class="parallel-run"><div class="parallel-heading"><strong>${escape(r.device_id)}</strong><span class="badge ${r.control==='PAUSED'?'warn':'good'}">${r.job.status==='STOPPING'?'停止中':r.job.command==='drain'&&r.job.status==='RUNNING'?'补传中':r.control==='PAUSED'&&r.job.status==='RUNNING'?'已暂停':['STARTING','RUNNING'].includes(r.job.status)?'送料中':'待补传'}</span></div><p class="small">${escape(r.feed?.cable_name||r.task_id||'正在准备任务')}</p><p class="small muted">${r.metric_code==='OVALITY'?'不圆度 + 护套厚度 · 同步检测':escape(labels[r.metric_code]||'准备采集')}</p><strong>${r.generated} / ${r.target||'—'} 点</strong><p class="small muted">已存 ${r.stored??0} · 待确认 ${r.pending??0}</p><div class="parallel-actions"><button type="button" data-parallel-run="${escape(r.id)}">查看 / 调速</button>${['STARTING','RUNNING','STOPPING'].includes(r.job.status)?`<button type="button" data-parallel-stop="${escape(r.id)}" ${r.job.status==='STOPPING'?'disabled':''}>停止送料</button>`:`<button type="button" data-parallel-drain="${escape(r.id)}">补传已采集数据</button>`}</div></article>`).join('')||'<p class="parallel-empty">当前没有运行中的送料。选择上方线缆与设备开始。</p>';
};
$('parallel-runs').onclick=async e=>{const id=e.target.dataset.parallelRun,stop=e.target.dataset.parallelStop,drain=e.target.dataset.parallelDrain;if(id){liveRunId=id;liveDetails.open=true;renderLive(state);$('live-panel').scrollIntoView({behavior:'smooth',block:'start'});}if(stop||drain){e.target.disabled=true;try{await api('/runs/'+encodeURIComponent(stop||drain)+'/control',{action:drain?'drain':'stop'});await refresh();void refreshParallelChoices(true);}catch(err){error(err.message);}}};

let parallelScannerBusy=false,parallelScannerData=[];
async function refreshParallelScanners(){
 if(parallelScannerBusy||activeTab!=='scanner'||$('app-view').hidden||document.hidden)return;
 parallelScannerBusy=true;
 try{const result=await api('/scanner/states');parallelScannerData=result.devices;
  $('parallel-scanners').innerHTML=result.devices.map(d=>{const s=d.state,r=s?.run;return `<article class="parallel-run"><div class="parallel-heading"><strong>${escape(d.device_id)}</strong><span class="badge ${d.error?'bad':r?'good':''}">${escape(d.error?'状态未知':scannerNames[s?.state]||s?.state||'未知')}</span></div><p>${escape(d.metric_code==='OVALITY'?'电缆不圆度 + 护套厚度':labels[d.metric_code])}</p><p class="small">${r?'工单 '+escape(r.order?.code)+' · '+escape(r.order?.spool):'尚未绑定当前任务'}</p><p class="small muted">${d.error?escape(d.error):r?'任务 '+escape(r.order?.taskCode||r.taskId)+' · 已保存 '+(s.stored??0)+' · 待确认 '+(s.centerPending??0):'扫码后独立启动，不影响其他设备'}</p><button type="button" data-scanner-device="${escape(d.device_id)}">查看此设备状态</button></article>`;}).join('');
  $('parallel-scanner-error').textContent='状态更新于 '+date(result.checked_at);
 }catch(e){$('parallel-scanner-error').textContent='设备状态读取失败：'+e.message;}
 finally{parallelScannerBusy=false;}
}
$('parallel-scanners').onclick=e=>{const d=parallelScannerData.find(d=>d.device_id===e.target.dataset.scannerDevice);if(!d)return;showScannerTarget(d);$('scanner-feed').hidden=true;if(d.state)renderScanner(d.state);else{$('scanner-edge-state').textContent='状态未知';$('scanner-health').textContent=d.error;}void refreshScanner();};
$('parallel-scanner-refresh').onclick=()=>void refreshParallelScanners();
let parallelLastPin='';
const previousPreview=previewFeed;
previewFeed=function(){previousPreview();$('parallel-mode').value=$('feed-mode').value;legacyFeedPanel.hidden=$('feed-mode').value!=='AUTO';$('parallel-panel').hidden=$('feed-mode').value==='AUTO';
 const pin=$('feed-cable').value;if(pin&&pin!==parallelLastPin&&parallelData?.cables.some(c=>c.id===pin)&&pin!==parallelCable){parallelCable=pin;parallelSelected.clear();renderParallelChoices();}parallelLastPin=pin;
};
const previousChooseTab=chooseTab;
chooseTab=function(tab){previousChooseTab(tab);previewFeed();if(tab==='feed')void refreshParallelChoices(true);if(tab==='scanner')void refreshParallelScanners();};
legacyFeedPanel.hidden=true;
setInterval(()=>{if(!document.hidden){void refreshParallelChoices();void refreshParallelScanners();}},5000);
window.addEventListener('hashchange',()=>{void refreshParallelChoices(true);void refreshParallelScanners();});

const parallelSignedIn=signedIn; signedIn=function(yes){parallelSignedIn(yes);if(yes){void refreshParallelChoices(true);void refreshParallelScanners();}};
