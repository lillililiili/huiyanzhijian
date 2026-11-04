import {Queue} from './queue';
import {DeviceClient,verifyAssignment} from './client';
import {insist,keys} from './cable-model';

export function initOdmScanner(db:Queue['db']){
 db.exec(`CREATE TABLE IF NOT EXISTS odm_scan_command(
 id TEXT PRIMARY KEY,device_id TEXT NOT NULL,input TEXT NOT NULL,payload TEXT NOT NULL,
 response TEXT,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS odm_scan_binding(
 binding_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,line_id TEXT NOT NULL,task_id TEXT NOT NULL UNIQUE,
 label TEXT NOT NULL,UNIQUE(device_id,line_id));`);
}

// Central HTTP adapter host. No edge service, local time-series or synthetic measurements here.
export class OdmScanner{
 private busy=new Set<string>();
 constructor(private queue:Queue,private client:DeviceClient,private stopCapture:(device:string)=>Promise<void>){initOdmScanner(queue.db);}
 async execute(input:any,stop=false){
  keys(input,stop?['device_id','request_id']:['device_id','request_id','barcode','line_id']);
  insist(typeof input.device_id==='string'&&/^[A-Za-z0-9._:-]{1,90}$/.test(input.device_id),'请选择检测设备');
  insist(typeof input.request_id==='string'&&/^[a-f0-9-]{36}$/.test(input.request_id),'扫码请求标识无效');
  const d=input.device_id,db=this.queue.db,encoded=JSON.stringify({action:stop?'stop':'scan',...input});
  insist(!this.busy.has(d),'该设备正在同步扫码，请稍后重试',409,'SCAN_BUSY');this.busy.add(d);
  try{
   let saved=db.prepare('SELECT * FROM odm_scan_command WHERE id=?').get(input.request_id) as any;
   insist(!saved||saved.input===encoded,'同一请求标识的内容已变化',409,'REQUEST_CONFLICT');
   const pending=db.prepare('SELECT id FROM odm_scan_command WHERE device_id=? AND response IS NULL AND id<>?').get(d,input.request_id);
   insist(!pending,'上次扫码结果尚未确认，请先重试原请求',409,'SCAN_PENDING');
   if(!saved){
    let assignment;
    if(stop)assignment=(await this.client.request('/devices/'+d+'/assignment','AssignmentResponse')).data.assignment;
    else {insist(typeof input.line_id==='string'&&input.line_id.length>0&&input.line_id.length<=128&&input.line_id.trim()===input.line_id&&!/[\x00-\x1f\x7f]/.test(input.line_id),'请输入本次设备订单号');
     const preview=await this.client.scanRequest('/devices/'+d+'/odm-scan-preview/'+encodeURIComponent(input.barcode));assignment=preview.assignment;}
    const payload={command_id:input.request_id,expected_task_id:assignment?.task_id??null,expected_binding_id:assignment?.binding_id??null,...(stop?{}:{barcode:input.barcode,line_id:input.line_id})};
    db.prepare('INSERT INTO odm_scan_command VALUES(?,?,?,?,NULL,?)').run(input.request_id,d,encoded,JSON.stringify(payload),new Date().toISOString());
    saved={payload:JSON.stringify(payload)};
   }
   if(!saved.response){
    // Quiesce old samples before center closes their capture window. Retain every queued point.
    await this.stopCapture(d);
    let result:any;
    try{result=await this.client.scanRequest('/devices/'+d+'/odm-task-'+(stop?'stop':'scan'),JSON.parse(saved.payload));}
    catch(e){if((e as any).status>=400&&(e as any).status<500&&(e as any).status!==429){db.prepare('UPDATE odm_scan_command SET response=? WHERE id=?').run(JSON.stringify({error:{message:(e as Error).message,status:(e as any).status}}),input.request_id);}throw e;}
    if(!stop){insist(result.label?.device_id===d&&result.label?.order?.deviceOrderNo===input.line_id,'中心扫码响应不匹配，保留请求待重试',502);verifyAssignment(result.label.assignment);}
    this.queue.transaction(()=>{
     if(result.label)db.prepare('INSERT INTO odm_scan_binding VALUES(?,?,?,?,?)').run(result.label.binding_id,d,input.line_id,result.label.task_id,JSON.stringify(result.label));
     db.prepare('UPDATE odm_scan_command SET response=? WHERE id=?').run(JSON.stringify(result),input.request_id);
    });saved.response=JSON.stringify(result);
   }
   const result=JSON.parse(saved.response);insist(!result.error,result.error?.message||'扫码失败',result.error?.status||409);
   return {...result,spool_id:result.label?.spool_id,state:await this.state(d)};
  }finally{this.busy.delete(d);}
 }
 async state(device:string){
  const a=(await this.client.request('/devices/'+encodeURIComponent(device)+'/assignment','AssignmentResponse')).data.assignment;
  const db=this.queue.db,stored=a?db.prepare('SELECT label FROM odm_scan_binding WHERE binding_id=? AND device_id=?').get(a.binding_id,device) as any:null;
  const label=stored?JSON.parse(stored.label):null;
  const rows=a?db.prepare(`SELECT s.state,count(*) AS n FROM sample s JOIN sim_run r ON r.id=s.run_id WHERE r.device_id=? AND json_extract(r.assignment,'$.binding_id')=? GROUP BY s.state`).all(device,a.binding_id) as any[]:[];
  const counts=Object.fromEntries(rows.map(r=>[r.state,Number(r.n)]));
  const pending=db.prepare('SELECT input FROM odm_scan_command WHERE device_id=? AND response IS NULL ORDER BY created_at LIMIT 1').get(device) as any;
  const running=a?db.prepare("SELECT 1 FROM web_execution e JOIN sim_run r ON r.id=e.run_id WHERE r.device_id=? AND json_extract(r.assignment,'$.binding_id')=? AND e.status IN('STARTING','RUNNING','STOPPING') LIMIT 1").get(device,a.binding_id):null;
  return {adapter:'ODM',state:pending?'SYNC_PENDING':label?(running?'RUNNING':rows.length?'CAPTURED':'BOUND'):a?'UNSCANNED':'WAITING_SCAN',time:new Date().toISOString(),label,
   pending:pending?JSON.parse(pending.input):null,
   run:label?{taskId:label.task_id,bindingId:label.binding_id,config:{deviceId:device},order:label.order}:null,
   stored:rows.reduce((sum,r)=>sum+Number(r.n),0),confirmed:(counts.STORED||0)+(counts.DUPLICATE||0),
   centerPending:(counts.PENDING||0)+(counts.UNKNOWN||0),centerRejected:(counts.REJECTED||0)+(counts.QUARANTINED||0),
   centerError:a&&!label?'当前任务尚未通过整机扫码绑定；扫码会开启独立采集。':''};
 }
}
