'use strict';
let liveRunId='',lastStateAt=0,liveRequestFailed=false,lastPollAt=0,pollMs=1000,liveSpeedVersion=0,liveSpeedRun='',liveActionBusy=false;
let lastRefreshError='';
try{const saved=Number(sessionStorage.getItem('sim03-refresh-ms'));if([500,1000,2000,5000].includes(saved))pollMs=saved;}catch{}
$('poll-rate').value=String(pollMs);
$('poll-rate').onchange=()=>{pollMs=Number($('poll-rate').value);try{sessionStorage.setItem('sim03-refresh-ms',String(pollMs));}catch{}void refresh();};
function updateFreshness(){
 const age=lastStateAt?Date.now()-lastStateAt:Infinity,stale=liveRequestFailed||age>Math.max(5000,pollMs*3);
 $('live-freshness').textContent=lastStateAt?(stale?'状态未同步 · ':'已同步 · ')+Math.floor(age/1000)+'秒前 · '+pollMs/1000+'秒刷新':'等待状态同步';
 $('live-freshness').classList.toggle('error',stale);$('live-panel').classList.toggle('stale',stale);renderDeviceRuntime();
}
function currentLive(){return state?.runs.find(r=>r.id===liveRunId)||state?.starting.find(r=>r.run_id===liveRunId);}
function preparationStatus(job){return ({STARTING:'准备中',RUNNING:'准备中',STOPPING:'停止中',STOPPED:'准备已停止',FAILED:'准备失败',INTERRUPTED:'准备已中断'}[job.status])||job.status;}
function renderLive(data){
 const entries=[...(data.preparations||data.starting).filter(j=>j.run_id.startsWith('cable-')).map(j=>({id:j.run_id,device_id:j.device_id,label:preparationStatus(j)+' · '+j.device_id,starting:true,job:j})),...data.runs.filter(r=>r.scenario==='cable').map(r=>({...r,label:(r.feed?.cable_name||scene[r.scenario]||'运行')+' · '+r.device_id+' · '+runStatus(r)[0]}))];
 if(!entries.some(r=>r.id===liveRunId))liveRunId=entries.find(r=>['STARTING','RUNNING','STOPPING'].includes(r.job?.status))?.id||entries[0]?.id||'';
 const opts=entries.map(r=>`<option value="${escape(r.id)}">${escape(r.label)} · ${escape(r.id.slice(-8))}</option>`).join('')||'<option value="">暂无运行</option>';
 if($('live-run').innerHTML!==opts)$('live-run').innerHTML=opts;$('live-run').value=liveRunId;
 const run=entries.find(r=>r.id===liveRunId),feed=run?.feed,active=['STARTING','RUNNING','STOPPING'].includes(run?.job?.status),stopping=run?.job?.status==='STOPPING',sampling=active&&run?.job?.command==='run',paused=run?.control==='PAUSED';
 const status=run?.starting?[preparationStatus(run.job),'warn']:run?runStatus(run):['待送料',''];
 $('live-status').textContent=status[0];$('live-status').className='badge '+status[1];$('live-panel').classList.toggle('is-active',!!active);
 $('live-context').textContent=run?(feed?feed.cable_name+' → '+feed.detector_name+' · '+run.device_id+' · '+(feed.mode==='AUTO'?'自动进出料':'已有任务')+' · 步长 '+feed.step_m+' m':run.device_id+' · '+(run.starting?'尚未开始采样 · '+preparationStatus(run.job):'接口诊断运行')):'尚未开始送料。选择下方线缆与设备后开始。';
 const last=feed?.last_sample;
 $('live-position').textContent=feed?(last?.position_m??'未采样')+' / '+feed.length_m+' m':'—';
 $('live-progress').textContent=run&&!run.starting?run.generated+' / '+run.target+' 点':'—';
 $('live-value').textContent=last?last.value+' '+last.unit:'—';if($('live-ovality-box')){$('live-ovality-box').hidden=run?.metric_code!=='OVALITY';const obs=last?.observation;$('live-ovality-axes').textContent=obs?.diameter_x_mm!==undefined?`X(202H) ${obs.diameter_x_mm} / Y(204H) ${obs.diameter_y_mm} mm · 长轴a ${obs.major_axis_mm||'0'} / 短轴b ${obs.minor_axis_mm||'0'} mm · OvAL ${obs.ovality_difference_mm||'0'} mm · 向心率f ${obs.centripetal_ratio_f||'—'} · 状态字 ${obs.registers?.['0x0200_status_word']||'0x0002'}`:'等待采样';}
 $('live-result').textContent=last?(last.result==='FAIL'?'异常':last.result==='PASS'?'正常':'未判定'):'—';$('live-result').classList.toggle('error',last?.result==='FAIL');
 $('live-queue').textContent=run&&!run.starting?run.stored+' / '+run.pending+' 条':'—';
 $('live-track').style.width=run?.target?Math.min(100,100*run.generated/run.target)+'%':'0%';
 $('live-pause').disabled=liveActionBusy||!sampling||paused||stopping||run?.starting;
 $('live-resume').disabled=liveActionBusy||!run||run.starting||stopping||(!sampling&&active)||run.generated>=run.target||(!paused&&sampling);
 $('live-stop').disabled=liveActionBusy||!active||stopping;
 $('live-detail').disabled=!run||run.starting;
 const canSpeed=!!feed&&sampling&&!stopping&&run.generated<run.target;
 $('live-speed').disabled=!canSpeed;$('live-apply-speed').disabled=!canSpeed||liveActionBusy;
 if(feed){
  // Polling must not erase the user's in-progress speed entry.
  if(liveSpeedRun!==run.id||document.activeElement!==$('live-speed')&&liveSpeedVersion!==feed.speed.version)$('live-speed').value=feed.speed.speed_m_min;
  liveSpeedRun=run.id;liveSpeedVersion=feed.speed.version;
  $('live-speed-current').textContent='已设 '+feed.speed.speed_m_min+' m/min · 目标间隔 '+feed.speed.interval_ms+' ms · v'+feed.speed.version;
 }else{liveSpeedRun='';liveSpeedVersion=0;$('live-speed').value='';$('live-speed-current').textContent='线缆过料运行支持调速';}
 if(!liveActionBusy)$('live-message').textContent=run?.job?.message||feed?.exit_error||
  (stopping?'停止指令已接收，正在释放采集进程；已有上传仍可能返回回执。':paused?'送料已暂停，已有队列继续补传。继续送料将从下一未采样位置恢复。':feed?.exited?'已出料，平台任务已结束。':run?.control==='STOPPED'?'送料已停止，历史和待传保留；未完成的任务不会自动结束。':'位置来自最近已生成样本；设定速度为模拟节拍，实际节拍还受接口响应影响。');
 updateFreshness();
}
$('live-run').onchange=()=>{liveRunId=$('live-run').value;liveSpeedRun='';renderLive(state);};
async function liveControl(action){
 const id=liveRunId;if(!id||liveActionBusy)return;liveActionBusy=true;renderLive(state);$('live-message').textContent='正在发送'+({pause:'暂停',resume:'继续',stop:'停止'}[action])+'指令…';
 try{await api('/runs/'+encodeURIComponent(id)+'/control',{action});error('');await refresh();}
 catch(e){error(e.message);$('live-message').textContent='控制未确认：'+e.message;}
 finally{liveActionBusy=false;if(state)renderLive(state);}
}
for(const action of ['pause','resume','stop'])$('live-'+action).onclick=()=>liveControl(action);
$('live-detail').onclick=async()=>{const id=liveRunId;if(!id)return;try{const r=await api('/passes/'+encodeURIComponent(id));if(liveRunId!==id)return;detailModel=null;$('history-prev').parentElement.hidden=true;$('model-detail-title').textContent='检测记录 · '+r.cable.data.name;$('model-detail-content').innerHTML=comparisonMarkup(r);$('model-history').innerHTML='';$('model-history-summary').textContent='';$('history-prev').disabled=true;$('history-next').disabled=true;$('model-comparison').hidden=true;showDialog('model-detail-dialog');}catch(e){error(e.message);}};
$('live-speed-form').onsubmit=async e=>{
 e.preventDefault();const run=currentLive();if(!run?.feed||liveActionBusy)return;
 const id=liveRunId,version=liveSpeedVersion,speed=$('live-speed').value;liveActionBusy=true;$('live-apply-speed').disabled=true;
 try{const result=await api('/passes/'+encodeURIComponent(id)+'/speed',{speed_m_min:speed,version});
  if(liveRunId===id){$('live-speed-current').textContent='已设 '+result.speed_m_min+' m/min · 从第'+result.first_sequence+'点起';liveSpeedVersion=-1;}
  error('');await refresh();
 }catch(err){error(err.message);}finally{liveActionBusy=false;if(state)renderLive(state);}
};
