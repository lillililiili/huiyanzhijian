'use strict';
// Scanner only transmits identity. Instrument/feed simulation remains independent.
let scannerBusy=false,scannerPollBusy=false,scannerLastLabel=null,scannerSpool=null,scannerRequest=null,scannerTarget=null;
const scannerNames={LOADING:'正在读取设备状态',IDLE:'已关机',SYNC_PENDING:'任务同步中',WAITING_SCAN:'等待扫码',RUNNING:'采集中',PAUSED:'已暂停',STOPPING:'正在停止',ENDED:'已结束',FAULT:'采集异常',UNSCANNED:'等待订单绑定',BOUND:'已绑定 · 待送料',CAPTURED:'本次送料已完成'};
function renderScanner(s){
 $('scanner-edge-state').textContent=scannerNames[s.state]||s.state||'未知';
 $('scanner-time').textContent='检查于 '+new Date(s.time).toLocaleTimeString('zh-CN',{hour12:false});
 $('scanner-local').textContent=String(s.stored??'—');$('scanner-ts-pending').textContent=String(s.tsPending??'—');
 $('scanner-center-pending').textContent=String(s.centerPending??'—');$('scanner-rejected').textContent=String(s.centerRejected??'—');
 const r=s.run;
 $('scanner-stop').hidden=true;$('scanner-retry').hidden=true;scannerPending=null;
 if(s.adapter==='ODM'){ $('scanner-ts-pending').textContent=String(s.confirmed??'—');$('scanner-stop').hidden=!s.run;scannerPending=s.pending;$('scanner-retry').hidden=!s.pending; }
 $('scanner-current').textContent=r?'工单 '+r.order.code+' · 线缆 '+r.order.spool+' · 设备 '+r.config.deviceId+' · 任务 '+(r.order.taskCode||r.taskId||r.order.externalId||'—')+' · 第'+(r.order.scanRound||1)+'次采集'+(r.order.deviceOrderNo?' · 设备订单 '+r.order.deviceOrderNo:''):(s.adapter==='ODM'?'扫描平台任务码，自动识别检测设备并绑定本次设备订单。':'请先在边缘终端开机，再扫描任务码；无需在中心手动开始。');
 $('scanner-health').textContent=s.tsError||s.centerError||(s.adapter==='ODM'?'扫码完成后可去模拟送料。厂家接口原文经适配直接上传中心，待确认记录保留。':'每秒批量转发全部采样点；待传记录保留至中心确认。');
}
function showScannerTarget(target){
 scannerTarget=target;const odm=target.adapter==='ODM';
 $('scanner-detected').textContent='已识别设备：'+target.device_id+' · '+(labels[target.metric_code]||target.metric_code);
 $('scanner-subtitle').textContent='设备由任务条码自动识别，无需手动选择';
 $('scanner-order-fields').hidden=!odm;
 $('scanner-chain-title').textContent=odm?'整机直连中心':'边缘采集链路';
 $('scanner-local-label').textContent=odm?'模拟设备已生成':'边缘已保存（A / B）';
 $('scanner-second-label').textContent=odm?'中心已接收':'待写本地时序';
 $('scanner-stop').hidden=true;$('scanner-retry').hidden=true;scannerPending=null;
}
async function refreshScanner(){
 if(activeTab!=='scanner'||scannerPollBusy||scannerBusy||$('app-view').hidden||!scannerTarget)return;
 scannerPollBusy=true;const target=scannerTarget;
 try{const result=await api('/scanner/state'+(target.adapter==='ODM'?'?device_id='+encodeURIComponent(target.device_id):''));if(target===scannerTarget)renderScanner(result);}
 catch(e){if(target===scannerTarget){$('scanner-edge-state').textContent='无法连接';$('scanner-health').textContent=e.message;}}
 finally{scannerPollBusy=false}
}
async function sendScanner(code){
 if(scannerBusy)return;scannerBusy=true;$('scanner-send').disabled=true;
 const line=$('scanner-order').value.trim();
 $('scanner-message').textContent='正在识别条码绑定的设备…';$('scanner-feed').hidden=true;
 $('scanner-stop').hidden=true;$('scanner-retry').hidden=true;
 try{
  const signature=JSON.stringify([code.trim(),line]);
  if(!scannerRequest||scannerRequest.signature!==signature)scannerRequest={code:code.trim(),signature,id:crypto.randomUUID()};
  const target=await api('/scanner/target?barcode='+encodeURIComponent(code.trim()));showScannerTarget(target);
  renderScanner({adapter:target.adapter,state:'LOADING',time:new Date().toISOString()});
  const result=await api('/scanner/scan',{barcode:code.trim(),request_id:scannerRequest.id,...(target.adapter==='ODM'&&line?{line_id:line}:{})});
  scannerRequest=null;scannerLastLabel=result.label;scannerSpool=result.spool_id;renderScanner(result.state);
  $('scanner-message').textContent='扫码成功 · '+target.device_id+' · '+result.label.order.spool+' · '+result.label.order.spec+' · 第'+(result.label.order.scanRound||1)+'次采集'+(target.adapter==='ODM'?' · 设备订单 '+result.label.order.deviceOrderNo:'')+'。';
  $('scanner-input').value='';$('scanner-order').value='';$('scanner-feed').hidden=false;
 }catch(e){$('scanner-message').textContent=e.message;}
 finally{scannerBusy=false;$('scanner-send').disabled=false;$('scanner-input').focus();void refreshScanner();}
}
$('scanner-form').onsubmit=e=>{e.preventDefault();void sendScanner($('scanner-input').value)};
$('scanner-file').onchange=async e=>{
 const file=e.target.files[0];if(!file)return;let source;
 try{if(file.size>5*1024*1024||!['image/png','image/jpeg'].includes(file.type))throw Error('请上传5MB以内的PNG/JPEG条码图片');
  const hints=new Map([[ZXing.DecodeHintType.POSSIBLE_FORMATS,[ZXing.BarcodeFormat.CODE_128,ZXing.BarcodeFormat.QR_CODE]],[ZXing.DecodeHintType.TRY_HARDER,true]]);
  source=URL.createObjectURL(file);const result=await new ZXing.BrowserMultiFormatReader(hints).decodeFromImageUrl(source);await sendScanner(result.getText());
 }catch(err){$('scanner-message').textContent=err.message||'无法识别任务条码或二维码';}finally{if(source)URL.revokeObjectURL(source);e.target.value='';}
};
$('scanner-refresh').onclick=refreshScanner;
$('scanner-feed').onclick=async()=>{
 try{
 if(scannerSpool){const result=await api('/catalog?id='+encodeURIComponent(scannerSpool));const row=result.items.find(c=>c.id===scannerSpool);if(!row)throw Error('扫码线缆已不在授权目录，请重新扫描');const cable=cableModel(row);models.cables=[...models.cables.filter(c=>c.id!==cable.id),cable];options('feed-cable',models.cables,'请选择线缆');}
 chooseTab('feed');
 const detector=models.detectors.find(d=>d.data.device_id===scannerLastLabel?.device_id);
 if(detector)$('feed-detector').value=detector.id;
 // Match an authoritative task ID, never the displayed spool name.
 const cable=models.cables.find(c=>c.source?.tasks?.some(t=>t.id===scannerLastLabel.task_id));
 if(cable)$('feed-cable').value=cable.id;
 previewFeed();
 if([...$('feed-platform-task').options].some(o=>o.value===scannerLastLabel.task_id))$('feed-platform-task').value=scannerLastLabel.task_id;
 $('feed-platform-task').dispatchEvent(new Event('change'));
 previewFeed();
 }catch(e){$('scanner-message').textContent=e.message;}
};
window.addEventListener('hashchange',()=>void refreshScanner());setInterval(refreshScanner,3000);void refreshScanner();

let scannerPending=null;
$('scanner-new-order').onclick=()=>{$('scanner-order').value='SIM-'+crypto.randomUUID();};
$('scanner-retry').onclick=()=>{if(!scannerPending)return;const p=scannerPending;if(p.action==='stop'){void stopOdm(p.request_id);return;}$('scanner-input').value=p.barcode;$('scanner-order').value=p.line_id;scannerRequest={code:p.barcode,id:p.request_id,signature:JSON.stringify([p.barcode,p.line_id])};void sendScanner(p.barcode);};
async function stopOdm(id){$('scanner-stop').disabled=true;try{const device=scannerTarget?.adapter==='ODM'?scannerTarget.device_id:null;if(!device)throw Error('请先扫描整机任务条码');const result=await api('/scanner/stop',{device_id:device,request_id:id||crypto.randomUUID()});renderScanner(result.state);$('scanner-message').textContent='本次检测已结束，历史和待传记录保留。';$('scanner-feed').hidden=true;}catch(e){$('scanner-message').textContent=e.message;await refreshScanner();}finally{$('scanner-stop').disabled=false;}}
$('scanner-stop').onclick=()=>void stopOdm();
