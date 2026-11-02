'use strict';
// Scanner only transmits identity. Instrument/feed simulation remains independent.
let scannerBusy=false,scannerPollBusy=false,scannerLastLabel=null,scannerSpool=null,scannerRequest=null;
const scannerNames={IDLE:'已关机',SYNC_PENDING:'任务同步中',WAITING_SCAN:'等待扫码',RUNNING:'采集中',PAUSED:'已暂停',STOPPING:'正在停止',ENDED:'已结束',FAULT:'采集异常'};
function renderScanner(s){
 $('scanner-edge-state').textContent=scannerNames[s.state]||s.state||'未知';
 $('scanner-time').textContent='检查于 '+new Date(s.time).toLocaleTimeString('zh-CN',{hour12:false});
 $('scanner-local').textContent=String(s.stored??'—');$('scanner-ts-pending').textContent=String(s.tsPending??'—');
 $('scanner-center-pending').textContent=String(s.centerPending??'—');$('scanner-rejected').textContent=String(s.centerRejected??'—');
 const r=s.run;
 $('scanner-current').textContent=r?'工单 '+r.order.code+' · 线缆 '+r.order.spool+' · 设备 '+r.config.deviceId+' · 任务 '+(r.order.taskCode||r.taskId||r.order.externalId||'—')+' · 第'+(r.order.scanRound||1)+'次采集':'请先在边缘终端开机，再扫描任务码；无需在中心手动开始。';
 $('scanner-health').textContent=s.tsError||s.centerError||'每秒批量转发全部采样点；待传记录保留至中心确认。';
}
async function refreshScanner(){if(activeTab!=='scanner'||scannerPollBusy||$('app-view').hidden)return;scannerPollBusy=true;try{renderScanner(await api('/scanner/state'));}catch(e){$('scanner-edge-state').textContent='无法连接';$('scanner-health').textContent=e.message;}finally{scannerPollBusy=false}}
async function sendScanner(code){
 if(scannerBusy)return;scannerBusy=true;$('scanner-send').disabled=true;
 $('scanner-message').textContent='正在向边缘终端发送扫码信息…';
 try{if(!scannerRequest||scannerRequest.code!==code.trim())scannerRequest={code:code.trim(),id:crypto.randomUUID()};const result=await api('/scanner/scan',{barcode:code.trim(),request_id:scannerRequest.id});scannerRequest=null;scannerLastLabel=result.label;scannerSpool=result.spool_id;renderScanner(result.state);
  $('scanner-message').textContent='扫码成功，边缘已开始接收：'+result.label.order.spool+' · '+result.label.order.spec+' · 第'+(result.label.order.scanRound||1)+'次采集。每次扫码独立记录。';
  $('scanner-input').value='';$('scanner-feed').hidden=false;
 }catch(e){$('scanner-message').textContent=e.message;}finally{scannerBusy=false;$('scanner-send').disabled=false;$('scanner-input').focus();}
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
window.addEventListener('hashchange',()=>void refreshScanner());setInterval(refreshScanner,1000);void refreshScanner();
