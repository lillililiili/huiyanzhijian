function apply(s){
 if(['IDLE','ENDED'].includes(s.state))scanError='';
 state=s;csrf=s.csrf||csrf;
 syncUIVersion(s);
 const active=['RUNNING','PAUSED','STOPPING','WAITING_SCAN'].includes(s.state),l=s.latest,c=s.run?.config||s.config;
 const a=s.gauges?.A??(l&&gaugeOf(l)==='A'?l:null), b=s.gauges?.B??(l&&gaugeOf(l)==='B'?l:null);
 const fresh=r=>r&&s.state==='RUNNING'&&Date.now()-new Date(r.received).getTime()<3000;
 const status=r=>!r?'等待数据':!r.valid?'读数无效':fresh(r)?'正在接收':'末次读数';
 const onlineA=fresh(a),onlineB=fresh(b);
 text('connection',onlineA&&onlineB?'A / B 数据接收中':onlineA?'A 接收中 · B 等待':onlineB?'B 接收中 · A 等待':'等待仪器数据');
 $('#connection').className='pill '+(onlineA||onlineB?'good':'neutral');
 text('a-state',status(a));text('b-state',status(b));text('state',names[s.state]||s.state);text('clock',time(s.time,true));
 text('rate',s.state==='RUNNING'?'采集中 · 数据自动保存':'已保存 '+s.stored.toLocaleString()+' 条原始记录');
 const valid=a?.valid;
 let verdict='等待 A 双轴数据',cls='';
 if(a&&!valid){verdict=a.reason||'A 读数无效';cls='bad'}else if(valid){verdict=a.verdict==='PASS'?'圆整度在设定范围内':a.verdict==='FAIL'?'圆整度低于设定下限':'仅测量 · 未设判定下限';cls=a.verdict==='PASS'?'good':a.verdict==='FAIL'?'bad':''}
 if(a&&!fresh(a)&&a.valid)verdict='末次读数 · '+(names[s.state]||'等待新数据');
 text('verdict',verdict);$('#verdict').className='result-status '+cls;
 text('ratio',valid?num(a.ratio,4):'—');$('#ratio').className='result-value '+(a?.verdict==='FAIL'?'fail':'');$('#ratio').title=valid?'精确圆整度：'+a.ratio:'';
 text('threshold',c.lower==null?'未设置判定下限':'圆整度下限 ≥ '+c.lower);
 text('exact','min(X, Y) ÷ max(X, Y) · 1 = 标准圆');
 for(const [id,v] of [['x',a?.valid?a.x:null],['y',a?.valid?a.y:null],['average',a?axialMean(a):null],['bx',b?.valid?b.x:null],['by',b?.valid?b.y:null]]){text(id,num(v));$('#'+id).title=v==null?'':String(v)}
 $('#by-row').hidden=b?.y==null;
 const axes=b?(b.axisCount||b.inputValues?.length||(b.y!=null?2:b.x!=null?1:0)):0;
 text('b-mode',axes===1?'单轴输入 · X':axes===2?'双轴输入 · X / Y':'收到数据后自动识别单轴 / 双轴');
 const sync=c.sync,downstream=sync?.upstreamGauge==='A'?b:a,p=downstream?.sheath,expired=s.state==='RUNNING'&&downstream&&!fresh(downstream),hasThickness=p?.value!=null&&!expired;
 text('thickness',hasThickness?num(p.value,3):'—');$('#thickness').title=hasThickness?'精确计算值：'+p.value:'';
 const pairLabels={SYNC_NOT_CONFIGURED:'等待后台下发仪器间距',METER_TIME_UNAVAILABLE:'等待计米器补偿时间',METER_INVALID:'计米器时间无效',METER_CONFIG_MISMATCH:'计米器与本盘距离版本不一致',WAITING_DOWNSTREAM:'等待下游取点',WAITING_OTHER:'等待补偿时间对应的采样点',INVALID_CURRENT:'当前仪器读数无效',INVALID_OTHER:'对应仪器读数无效',OUT_OF_WINDOW:'同步取点误差超过容差',TIME_COMPENSATED:'已按补偿时间同步取点',TIME_PAIRED_UNCOMPENSATED:'历史未补偿配对'};
 const desired=state.syncConfigs?.find(v=>v.deviceId===c.deviceId);
 text('thickness-state',expired?'等待新数据 · 末次配对已过期':p?(pairLabels[p.status]||p.status):!sync?.distanceMm?'等待后台下发仪器间距':'等待计米器补偿时间');
 text('thickness-formula',b?.y==null?'(Ax + Ay) ÷ 2 − Bx':'(Ax + Ay) ÷ 2 − (Bx + By) ÷ 2');
 text('pair-detail',sync?.distanceMm?'V'+sync.revision+' · 间距 '+sync.distanceMm+' mm'+(p?.delayMs!=null?' · 计米器 '+p.delayMs+' ms':'')+(desired&&desired.revision!==sync.revision?' · 新版本下一盘生效':''):desired?'已收到 V'+desired.revision+' · 下一盘生效':'配置入口：4182 → 初始化配置');
 text('order-code',s.run?.order.code||'未选择');text('spool',s.run?.order.spool?(s.run.order.spool+(s.run.order.scanRound?' · 第'+s.run.order.scanRound+'次采集':'')):'—');text('spec',s.run?.order.spec||'—');text('length',s.run?s.run.order.length+' m':'—');
 text('capture-time',l?time(l.at,true)+'.'+new Date(l.at).getMilliseconds().toString().padStart(3,'0'):'—');$('#capture-time').title=l?.at||'';
 text('hint',s.state==='WAITING_SCAN'?'已开机，扫描任务码自动开始':s.state==='RUNNING'?'再次扫码开启独立采集，支持重复任务码':s.state==='SYNC_PENDING'?'正在与中心同步，暂停接收新采样':'已停止采集，记录和待传队列保留');
 $('#primary').textContent='开机';const icon=document.createElement('img');icon.src='/icons/player-play.svg';icon.alt='';$('#primary').prepend(icon);
 $('#primary').disabled=active||['SYNC_PENDING','FAULT'].includes(s.state);$('#end').disabled=!(active||s.state==='FAULT');$('#settings').disabled=active||['SYNC_PENDING','FAULT'].includes(s.state);
 text('storage','本地 '+s.stored.toLocaleString()+' 条 · InfluxDB 待写 '+s.tsPending);
 text('sync',s.centerEnabled?'圆整度中心待确认 '+s.centerPending+' 条'+(s.centerRejected?' · 拒收 '+s.centerRejected+' 条':''):'中心对接未启用');
 warn(s.error||s.bError||s.tsError||s.centerError||scanError);
 text('integration-state','本地记录 '+s.stored+' 条，InfluxDB 待写 '+s.tsPending+' 条，圆整度中心待确认 '+s.centerPending+' 条。护套辅助结果随不圆度原始记录上传，配对状态以实际记录为准。');
}
function drawMain(){updateLegend($('#chart-legend'),mainChartRows,drawMain);chart.setOption(chartOption(mainChartRows,state?.run?.config.lower??state?.config.lower),true)}
function drawHistory(lower){updateLegend($('#record-legend'),historyChartRows,()=>drawHistory(lower));recordChart.setOption(chartOption(historyChartRows,lower,false),true)}

let lastLiveAt=0,liveSource,liveConnected=false,liveCursor=0,liveRun='',liveRenderTimer,livePaintPending=false,pollBusy=false,liveStarted=false;
function scheduleLiveDraw(){
 if(liveRenderTimer||livePaintPending)return;
 liveRenderTimer=setTimeout(()=>{liveRenderTimer=null;livePaintPending=true;requestAnimationFrame(()=>{livePaintPending=false;
  $('#empty-chart').hidden=linesFor(mainChartRows).length>0;drawMain();
 })},100);
}
function connectLive(){
 if(!window.EventSource)return;
 lastLiveAt=Date.now();liveSource=new EventSource('/api/live');
 liveSource.onmessage=event=>{
  try{
   const frame=JSON.parse(event.data);if(!Array.isArray(frame.rows)||!Number.isFinite(frame.cursor))throw Error('Invalid live frame');
   lastLiveAt=Date.now();liveConnected=true;
   if(frame.reset||frame.runId!==liveRun){mainChartRows=[];liveCursor=0;liveRun=frame.runId;}
   for(const row of frame.rows)if(Number.isFinite(row.id)&&row.id>liveCursor){mainChartRows.push(row);liveCursor=row.id;}
   liveCursor=Math.max(liveCursor,frame.cursor);
   const cutoff=Date.parse(frame.time)-60000;
   mainChartRows=mainChartRows.filter(row=>Date.parse(row.at)>=cutoff).slice(-30000);
   if(frame.state)apply(frame.state);
   scheduleLiveDraw();
  }catch{liveConnected=false;}
 };
 liveSource.onerror=()=>{liveConnected=false;};
}
async function pollLiveFallback(){
 if(liveConnected||pollBusy)return;pollBusy=true;
 try{
  const [s,rows]=await Promise.all([api('state'),api('trend')]);
  if(liveConnected)return;
  apply(s);mainChartRows=rows.filter(row=>row.runId===s.run?.id);scheduleLiveDraw();
  text('rate',(s.state==='RUNNING'?'采集中':'等待采集')+' · 实时通道重连中，轮询显示');
 }catch(e){if(!liveConnected){warn('终端服务连接中断：'+e.message);text('connection','服务未连接');$('#primary').disabled=true;}}
 finally{pollBusy=false;}
}
function refresh(){
 if(liveStarted)return;liveStarted=true;
 connectLive();void pollLiveFallback();setInterval(()=>{
  if(liveSource?.readyState===1&&Date.now()-lastLiveAt>4000){liveConnected=false;liveSource.close();connectLive();}
  void pollLiveFallback();
 },1000);
}
