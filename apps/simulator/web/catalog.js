'use strict';
// Platform identities are authoritative; local models contain simulation presets only.
let catalogPage=1,catalogTotal=0,catalogRows=[],catalogFresh=false,catalogEpoch=0,catalogLoading=false,platformBase='',catalogTimer,catalogConfigLoaded=false,catalogError='';
const taskNames={CREATED:'待开始',RUNNING:'检测中',ENDED:'已结束',CANCELLED:'已取消'};
function platformUrl(hash){const url=platformBase?new URL(platformBase):new URL(location.href);if(!platformBase){url.port='4181';url.pathname='/';url.search='';}if(!['http:','https:'].includes(url.protocol))throw Error('主平台地址配置无效');url.hash=hash;return url.href;}
function cableModel(row){const data=row.model?.data||{name:row.spool_code,material_ref:'platform:'+row.id,length_m:'',baseline:structuredClone(normalGeometry),defects:[]};return {id:row.id,version:row.model?.version||0,data:{...data,name:row.spool_code},source:row,inspection:row.model?.inspection||{}};}
function detectorModel(row){return {id:row.model_id,version:row.model?.version||0,data:{...(row.model?.data||parametersFor(row.metric_code)),name:row.name,device_id:row.id,metric:row.metric_code},source:row,inspection:{}};}
const baseOpenEditor=openEditor,baseLoadSettings=loadSettings,basePreviewFeed=previewFeed,baseOpenDetail=openModelDetail;
const baseSaveRevision=saveRevision;
saveRevision=async function(kind,identity,data,reason){const row=models[kind].find(r=>r.id===identity.id);if(!row?.source)throw Error('请从同步目录选择平台对象');return api('/catalog/'+kind,{source_id:row.source.id,version:identity.version,data,reason});};
refreshModels=async function(){
 const epoch=++catalogEpoch;catalogLoading=true;catalogFresh=false;previewFeed();$('cable-count').textContent='正在同步主平台目录…';
 try{
  if(!catalogConfigLoaded){const config=await api('/ui-config');platformBase=config.platform_url||'';catalogConfigLoaded=true;}
  const query=new URLSearchParams({page:String(catalogPage),limit:'20',q:$('cable-search').value.trim(),status:catalogFilter.cables});
  const result=await api('/catalog?'+query);if(epoch!==catalogEpoch)return;
  const lastPage=Math.max(1,Math.ceil(result.total/20));if(result.page>lastPage){catalogPage=lastPage;return await refreshModels();}
  // Keep only explicitly selected off-page objects, and re-read them instead of retaining stale identities.
  const pins=[...new Set(['feed-cable','cable-edit'].map(id=>$(id).value).filter(id=>id&&!result.items.some(r=>r.id===id)))];
  const pinned=[];for(const id of pins){const r=await api('/catalog?id='+encodeURIComponent(id));pinned.push(...r.items);}
  if(epoch!==catalogEpoch)return;
  catalogPage=result.page;catalogTotal=result.total;catalogRows=result.items;models={cables:[...result.items,...pinned].map(cableModel),detectors:result.devices.map(detectorModel)};
  if(catalogError&&$('global-error').textContent===catalogError)error('');catalogError='';
  $('connection-pill').textContent='后端已连接';$('connection-pill').className='pill good';
  catalogFresh=true;catalogLoading=false;lastModels=Date.now();options('cable-edit',models.cables,'请选择线缆');options('detector-edit',models.detectors,'请选择设备');options('feed-cable',models.cables,'请选择线缆（当前目录页）');options('feed-detector',models.detectors,'请选择设备');renderCatalogs();
 }catch(e){if(epoch!==catalogEpoch)return;catalogError=e.message;$('connection-pill').textContent='平台同步异常';$('connection-pill').className='pill bad';$('cable-count').textContent='同步失败：'+e.message+'。点击刷新重试，旧目录不可用于新送料。';$('catalog-prev').disabled=true;$('catalog-next').disabled=true;renderDeviceRuntime();throw e;}
 finally{if(epoch===catalogEpoch){catalogLoading=false;previewFeed();}}
};
renderCatalogs=function(){
 const signature=JSON.stringify([models,catalogFilter,catalogPage,catalogTotal,$('detector-search').value]);const cableRows=catalogRows.map(r=>models.cables.find(m=>m.id===r.id)).filter(Boolean);
 $('cable-count').textContent=`平台目录筛选内 ${catalogTotal} 盘 · 当前 ${cableRows.length} 盘 · 已同步`;
 $('catalog-page').textContent=`第 ${catalogPage} / ${Math.max(1,Math.ceil(catalogTotal/20))} 页`;$('catalog-prev').disabled=catalogPage<=1||catalogLoading;$('catalog-next').disabled=catalogPage*20>=catalogTotal||catalogLoading;
 if(signature===catalogSignature){renderDeviceRuntime();return;}catalogSignature=signature;
 $('cable-list').innerHTML=cableRows.map(r=>`<article class="catalog-card" data-model="${escape(r.id)}" data-kind="cables"><div class="catalog-card-head"><h2>${escape(r.data.name)}</h2><span class="badge ${r.source.has_samples?'good':''}">${r.source.has_samples?'已有检测记录':'待检测'}</span></div><p class="small muted">工单 ${escape(r.source.external_code)} · ${escape(r.source.specification_code||'')}</p><p class="small">任务 ${r.source.task_count} · 检测中 ${r.source.running_count} · 待开始 ${r.source.waiting_count}</p><p class="small">${r.version?'模拟预设 v'+r.version+' · '+escape(r.data.length_m)+' m · '+r.data.defects.length+'个问题区段':'尚未配置模拟预设'}</p><div class="catalog-actions"><button data-model-action="detail">详情</button><button data-model-action="edit">${r.version?'编辑预设':'配置预设'}</button><button data-model-action="settings">参数设置</button><button class="primary" data-model-action="feed">去送料</button></div></article>`).join('')||'<div class="catalog-empty"><h2>没有符合条件的平台线缆</h2><p>可清除筛选，或到主平台登记后刷新。仅显示本厂模拟及未分配来源的线缆。</p></div>';
 const q=$('detector-search').value.trim().toLowerCase();const rows=models.detectors.filter(r=>(!catalogFilter.metric||r.data.metric===catalogFilter.metric)&&(!q||(r.data.name+' '+r.data.device_id).toLowerCase().includes(q))&&(catalogFilter.detectors==='all'||(r.version>0)===(catalogFilter.detectors==='tested')));
 $('detector-count').textContent=`主平台授权模拟设备 ${models.detectors.length} 台 · 当前 ${rows.length} 台`;
 $('detector-list').innerHTML=rows.map(r=>`<article class="catalog-card" data-model="${escape(r.id)}" data-kind="detectors"><div class="catalog-card-head"><h2>${escape(r.data.name)}</h2><span class="badge" data-device-enabled="${escape(r.data.device_id)}">读取启用状态…</span></div><p>${escape(labels[r.data.metric])} · ${escape(r.data.device_id)}</p><div class="device-runtime" data-device-runtime="${escape(r.data.device_id)}" aria-label="设备运行状态"></div><p class="small muted">${r.version?'模拟参数 v'+r.version:'尚未配置模拟参数'}</p><div class="catalog-actions"><button data-model-action="detail">详情</button><button data-model-action="edit">配置模拟参数</button><button data-model-action="feed" class="primary">去送料</button></div></article>`).join('')||'<p class="catalog-empty">没有匹配的授权模拟设备</p>';
 $('metric-cards').innerHTML=Object.entries(labels).map(([k,name])=>`<button class="metric-card" data-metric="${k}" aria-pressed="${catalogFilter.metric===k}"><strong>${name}</strong><span>${models.detectors.filter(d=>d.data.metric===k).length} 台平台设备</span></button>`).join('');renderDeviceRuntime();
};
function catalogReload(){refreshModels().catch(e=>error(e.message));}
$('catalog-prev').onclick=()=>{catalogPage--;catalogReload();};$('catalog-next').onclick=()=>{catalogPage++;catalogReload();};
$('cable-search').oninput=()=>{clearTimeout(catalogTimer);catalogPage=1;catalogFresh=false;previewFeed();catalogTimer=setTimeout(()=>{catalogPage=1;catalogReload();},300);};
document.querySelectorAll('[data-cable-status]').forEach(b=>b.onclick=()=>{catalogFilter.cables=b.dataset.cableStatus;catalogPage=1;document.querySelectorAll('[data-cable-status]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));catalogReload();});
document.querySelector('[data-detector-status="pending"]').textContent='未配置参数';document.querySelector('[data-detector-status="tested"]').textContent='已配置参数';
$('cable-new').onclick=()=>window.open(platformUrl('trace'),'_blank','noopener');$('detector-new').onclick=()=>window.open(platformUrl('devices'),'_blank','noopener');
openEditor=function(kind,id){const row=models[kind].find(r=>r.id===id);if(!row?.source||!catalogFresh){error('请先同步并选择平台对象');return;}if(kind==='detectors'){chooseTab('settings');chooseSetting('detector');$('detector-edit').value=id;loadSettings(kind,id);return;}baseOpenEditor(kind,id);
 const form=kind==='cables'?cableForm:detectorForm;form.elements.name.readOnly=true;if(!row.version){$('cable-dialog-title').textContent='配置线缆预设';$('cable-version').textContent='尚未配置；保存后生成第一个版本';}
 if(kind==='cables'){form.elements.material_ref.readOnly=true;if(!row.version){const lengths=[...new Set(row.source.tasks.map(t=>t.planned_length_m).filter(Boolean))];form.elements.length_m.value=lengths.length===1?String(lengths[0]).replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):'';}}
 else{form.elements.metric.disabled=true;form.elements.device_id.disabled=true;}
};
// Catalog IDs and metrics are server-owned; disabled editor fields are never relied on for identity.
loadSettings=function(kind,id){const row=models[kind].find(r=>r.id===id);if(!row)return;baseLoadSettings(kind,id);if(!row.version&&kind==='cables'){$('cable-settings-form').hidden=true;error(kind==='cables'?'请先在线缆页配置线长与预设，再修改正常参数。':'请先在设备页保存模拟配置，再修改参数。');}};
openModelDetail=async function(kind,id){
 const row=models[kind].find(r=>r.id===id);if(!row)return;
 if(row.version)await baseOpenDetail(kind,id);else{detailModel={kind,id};$('model-detail-title').textContent=row.data.name;$('model-detail-content').innerHTML='<p>尚未保存模拟预设。</p>';$('model-history').innerHTML='';$('model-history-summary').textContent='暂无此对象的本地模拟运行记录';$('history-prev').parentElement.hidden=true;$('model-comparison').hidden=true;showDialog('model-detail-dialog');}
 if(detailModel?.id!==id)return;
 const info=kind==='cables'?`<p>平台盘号：${escape(row.source.spool_code)} · 工单：${escape(row.source.external_code)}</p><p>平台接收记录：${row.source.has_samples?'已有':'暂无'}；模拟预设与平台检测记录分开管理。</p><h3>平台检测任务</h3>${row.source.tasks.map(t=>`<p>${escape(t.task_code)} · ${escape(t.device_id)} · ${escape(labels[t.metric_code])} · ${taskNames[t.state]}</p>`).join('')||'<p>尚未分配授权模拟设备的任务，请到主平台创建。</p>'}${row.source.tasks_truncated?'<p>此盘任务超过200个，仅展示最新200个，完整列表请到主平台查询。</p>':''}`:`<p>平台设备：${escape(row.source.id)} · ${escape(row.source.name)} · ${row.source.enabled?'启用':'停用'}</p>`;
 $('model-detail-content').insertAdjacentHTML('afterbegin',info);
};
previewFeed=function(){
 basePreviewFeed();const c=models.cables.find(r=>r.id===$('feed-cable').value),d=models.detectors.find(r=>r.id===$('feed-detector').value),select=$('feed-platform-task'),prior=select.value;
 const tasks=c?.source?.tasks.filter(t=>t.device_id===d?.data.device_id&&t.metric_code===d?.data.metric)||[];
 select.innerHTML='<option value="">请选择该线缆的检测任务</option>'+tasks.map(t=>`<option value="${escape(t.id)}">${escape(t.task_code)} · ${taskNames[t.state]} · ${escape(t.planned_length_m)} m</option>`).join('');if(tasks.some(t=>t.id===prior))select.value=prior;
 const t=tasks.find(t=>t.id===select.value);$('feed-task').value=t?.id||'';$('feed-spool').value=t?.spool_id||'';
 const issue=!catalogFresh?'平台目录未同步成功，请刷新。':!c||!d?'请选择平台线缆和设备。线缆选项来自当前目录页，也可在线缆页点“去送料”。':!c.version?'此线缆尚未配置模拟预设。':!d.version?'此设备尚未配置模拟参数。':!d.source.enabled?'平台设备已停用。':!t?'请选择对应任务；无任务时先在主平台分配。':t.state!=='RUNNING'&&!($('feed-mode').value==='AUTO'&&t.state==='CREATED')?'所选任务未运行，请到主平台开始任务。':'';
 $('feed-form').querySelector('button').disabled=$('feed-form').querySelector('button').disabled||!!issue||catalogLoading;
 if(issue)$('feed-assignment').textContent=issue;else $('feed-assignment').textContent='本次写入：'+c.data.name+' · '+t.task_code+' · '+d.data.device_id+' · 任务计划 '+t.planned_length_m+' m / 模拟 '+c.data.length_m+' m。';
};
for(const id of ['feed-cable','feed-detector','feed-mode']){$(id).removeEventListener('change',basePreviewFeed);$(id).addEventListener('change',previewFeed);}
$('feed-platform-task').onchange=previewFeed;


function renderDeviceRuntime(){
 const freshness={platform:!catalogError&&lastModels>0&&Date.now()-lastModels<15000,local:!!state&&!liveRequestFailed&&lastStateAt>0&&Date.now()-lastStateAt<=Math.max(5000,pollMs*3)};
 for(const node of $('detector-list').querySelectorAll('[data-device-runtime]')){
  const row=models.detectors.find(d=>d.data.device_id===node.dataset.deviceRuntime);if(!row)continue;
  const value=deviceRuntimeStatus(row.source,state,freshness),signature=JSON.stringify(value);if(node.dataset.signature===signature)continue;node.dataset.signature=signature;
  const badge=node.closest('.catalog-card').querySelector('[data-device-enabled]');badge.textContent=value.enabledLabel;badge.className='badge '+value.enabledTone;
  node.innerHTML=`<div class="device-runtime-heading"><span class="small muted">运行状态</span><strong class="badge ${value.tone}">${escape(value.label)}</strong></div><p class="small muted">${escape(value.detail)}</p><div class="device-runtime-links">${value.runId?`<button class="quiet" data-device-run="${escape(value.runId)}">查看${['补传中','重放中'].includes(value.label)?'执行':'送料'}</button>`:''}${value.taskId?`<a href="${escape(platformUrl('task?id='+encodeURIComponent(value.taskId)))}" target="_blank" rel="noopener">查看占用任务</a>`:''}</div>`;
 }
}
$('detector-list').addEventListener('click',event=>{const button=event.target.closest('[data-device-run]');if(!button)return;const id=button.dataset.deviceRun;if(id.startsWith('cable-')){liveRunId=id;chooseTab('feed');renderLive(state);}else{chooseTab('settings');chooseSetting('system');$('run-history').closest('details.advanced').open=true;$('run-history').open=true;selected=id;before=0;renderRuns(state);void detail().catch(e=>error(e.message));}});
