import {spawn, type ChildProcess} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {Queue} from './queue';
import {FeedControl} from './feed-control';
import {DeviceClient, HttpFailure, verifyAssignment} from './client';
import {ModelStore,hashInput} from './model-store';
import {insist,keys,fixed} from './cable-model';

export class WebError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const requireWeb = (ok: unknown, status: number, code: string, message: string) => {
  if (!ok) throw new WebError(status, code, message);
};
export const validId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,89}$/.test(id);
const scenarios = ['mixed', 'normal', 'boundary', 'over', 'invalid'];
type Input = {request_id: string; device_id: string; scenario: string; count: number; interval_ms: number; seed: number};
type Job = {id: string; run_id: string; device_id: string; command: string; status: string; input: string; request_hash: string; started_at: string; ended_at: string | null; exit_code: number | null; message: string | null};

export class WebManager {
  readonly queue: Queue;
  readonly client: DeviceClient;
  readonly models: ModelStore;
  readonly feed: FeedControl;
  private modelBusy=new Set<string>();
  private children = new Map<string, ChildProcess>();
  private deviceCache: {expires: number; result: any} | null = null;
  private deviceRequest: Promise<any> | null = null;
  private closing = false;
  private productionBusy = new Set<string>();

  constructor(readonly databasePath: string, readonly apiUrl: string, token: string) {
    this.queue = new Queue(databasePath);
    this.models=new ModelStore(this.queue);
    this.feed=new FeedControl(this.queue);
    this.client = new DeviceClient(apiUrl, token);
    this.queue.db.exec(`
      CREATE TABLE IF NOT EXISTS web_production_event(id TEXT PRIMARY KEY,device_id TEXT NOT NULL,input TEXT NOT NULL,payload TEXT NOT NULL,response TEXT,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS web_execution(
        id TEXT PRIMARY KEY,run_id TEXT NOT NULL,device_id TEXT NOT NULL,command TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('STARTING','RUNNING','STOPPING','SUCCEEDED','FAILED','PENDING','STOPPED','INTERRUPTED')),
        input TEXT NOT NULL,request_hash TEXT NOT NULL,started_at TEXT NOT NULL,ended_at TEXT,exit_code INTEGER,message TEXT);
      CREATE UNIQUE INDEX IF NOT EXISTS web_one_active_device ON web_execution(device_id) WHERE status IN('STARTING','RUNNING','STOPPING');
      CREATE INDEX IF NOT EXISTS web_run_jobs ON web_execution(run_id,started_at);
      CREATE TABLE IF NOT EXISTS web_log(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,run_id TEXT NOT NULL,at TEXT NOT NULL,event TEXT NOT NULL,level TEXT NOT NULL,detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS web_run_logs ON web_log(run_id,id);`);
    // Restart never silently resumes generation. The original queue and lease stay intact.
    this.queue.db.prepare("UPDATE web_execution SET status='INTERRUPTED',ended_at=?,message=? WHERE status IN('STARTING','RUNNING','STOPPING')")
      .run(new Date().toISOString(), '服务已重启；历史保留，请选择继续采集或补传');
  }

  productionHistory(){return this.queue.db.prepare('SELECT id,device_id,payload,response,created_at FROM web_production_event ORDER BY created_at DESC LIMIT 50').all().map((x:any)=>({...x,payload:JSON.parse(x.payload),response:x.response?JSON.parse(x.response):null}));}
  async production(input:any,internal=false){
    requireWeb(internal||!this.modelBusy.has(input.device_id),409,'MODEL_BUSY','设备正在准备线缆检测');
    requireWeb(input&&validId(input.request_id)&&validId(input.device_id)&&validId(input.encounter_id)&&['ENTER','EXIT'].includes(input.phase),400,'INVALID_EVENT','请填写设备、过料编号和进出料阶段');
    requireWeb(!this.productionBusy.has(input.device_id),409,'EVENT_BUSY','正在发送此设备事件，请稍后重试');
    const active=this.queue.db.prepare("SELECT id FROM web_execution WHERE device_id=? AND status IN('STARTING','RUNNING','STOPPING')").get(input.device_id);
    requireWeb(!active,409,'CAPTURE_BUSY','请先停止此设备的模拟采样，再发送进出料事件');
    const saved=this.queue.db.prepare('SELECT * FROM web_production_event WHERE id=?').get(input.request_id) as any;
    requireWeb(!saved||saved.input===JSON.stringify(input),409,'EVENT_CONFLICT','同一请求编号内容变化');
    if(saved?.response)return JSON.parse(saved.response);
    this.productionBusy.add(input.device_id);
    try{
      const profile=(await this.client.request('/ingestion/profile','ProfileResponse')).data;
      requireWeb(profile.data_environment==='SIMULATED'&&profile.devices.some((d:any)=>d.device_id===input.device_id),403,'SOURCE_NOT_ALLOWED','只能发送授权模拟设备事件');
      const payload=saved?JSON.parse(saved.payload):{schema_version:'1.0',event_id:input.request_id,encounter_id:input.encounter_id,device_id:input.device_id,phase:input.phase,occurred_at:new Date().toISOString(),meter:input.value_m?{counter_id:input.counter_id,value_m:input.value_m}:null,...(input.spool_id?{spool_id:input.spool_id}:{}),...(input.task_id?{task_id:input.task_id}:{}),...(input.material_ref?{material_ref:input.material_ref}:{})};
      if(!saved)this.queue.db.prepare('INSERT INTO web_production_event(id,device_id,input,payload,created_at) VALUES(?,?,?,?,?)').run(input.request_id,input.device_id,JSON.stringify(input),JSON.stringify(payload),new Date().toISOString());
      const session=(await this.client.request('/device-sessions','SessionResponse',{schema_version:'1.0',device_id:input.device_id,data_environment:'SIMULATED',client_session_id:randomUUID(),producer_version:'B3-production-web'})).data;
      const result=await this.client.productionRequest({...payload,connection_id:session.connection_id});
      requireWeb(result.status===200,result.status,result.value.code||'EVENT_FAILED',result.value.message||'事件未完成');
      this.queue.db.prepare('UPDATE web_production_event SET response=? WHERE id=?').run(JSON.stringify(result.value.data),input.request_id);this.deviceCache=null;return result.value.data;
    }finally{this.productionBusy.delete(input.device_id);}
  }

  private job(id: string): Job | undefined {
    return this.queue.db.prepare('SELECT * FROM web_execution WHERE id=?').get(id) as Job | undefined;
  }
  private lastJob(run: string): Job | undefined {
    return this.queue.db.prepare('SELECT * FROM web_execution WHERE run_id=? ORDER BY started_at DESC,rowid DESC LIMIT 1').get(run) as Job | undefined;
  }
  private log(job: Job, event: string, detail: unknown, level = 'INFO') {
    this.queue.db.prepare('INSERT INTO web_log(job_id,run_id,at,event,level,detail) VALUES(?,?,?,?,?,?)')
      .run(job.id, job.run_id, new Date().toISOString(), event, level, JSON.stringify(detail).slice(0,12000));
  }
  private upstreamError(e: unknown): never {
    if (e instanceof HttpFailure && [401,403].includes(e.status)) throw new WebError(503,'UPSTREAM_AUTH','设备接入凭据已过期或无权限，请检查模拟器服务端配置');
    if (e instanceof HttpFailure && e.status === 429) throw new WebError(503,'UPSTREAM_RATE_LIMIT','后端请求限流，请稍后再试；已有队列保留');
    throw new WebError(503,'UPSTREAM_UNAVAILABLE','暂时无法连接后端，或响应不符合设备契约；本地历史仍可查看');
  }

  private detectorId(factory:string,device:string){const h=createHash('sha256').update('SIM05:'+factory+':'+device).digest('hex');return h.slice(0,8)+'-'+h.slice(8,12)+'-4'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);}
  private localModel(kind:string,id:string){try{const row=this.models.get(kind,id);return {...row,inspection:this.models.inspection(kind,id,row.version)};}catch(e){if((e as any).code==='MODEL_NOT_FOUND')return null;throw e;}}
  async catalog(params:Record<string,string>){
    let data;try{data=await this.client.catalog(params);}catch(e){this.upstreamError(e);}
    let assignments:any[];try{assignments=await Promise.all(data.devices.map(async(d:any)=>{const response=await this.client.request('/devices/'+encodeURIComponent(d.id)+'/assignment','AssignmentResponse');const a=response.data.assignment;if(a)verifyAssignment(a);return a?{task_id:a.task_id,spool_id:a.spool_id,metric_code:a.metric_code}:null;}));}catch(e){this.upstreamError(e);}
    return {...data,items:data.items.map((x:any)=>({...x,model:this.localModel('cables',x.id)})),devices:data.devices.map((d:any,i:number)=>{const model_id=this.detectorId(data.factory_id,d.id);return {...d,platform_assignment:assignments[i],model_id,model:this.localModel('detectors',model_id)};})};
  }
  async saveCatalog(kind:string,b:any){
    keys(b,['source_id','version','data','reason']);insist(validId(b.source_id),'平台对象ID无效');
    const source=await this.catalog(kind==='cables'?{id:b.source_id}:{});
    const row=(kind==='cables'?source.items:source.devices).find((x:any)=>x.id===b.source_id);insist(row,'平台对象不存在或不在授权范围',404,'CATALOG_NOT_FOUND');
    const data={...b.data};let id=row.id;
    if(kind==='cables'){data.name=row.spool_code;data.material_ref='platform:'+row.id;}else{id=row.model_id;data.name=row.name;data.device_id=row.id;data.metric=row.metric_code;}
    return this.models.save(kind,{id,version:b.version,data,reason:b.reason});
  }

  async devices() {
    if (this.deviceCache && this.deviceCache.expires > Date.now()) return this.deviceCache.result;
    if (this.deviceRequest) return this.deviceRequest;
    this.deviceRequest = (async () => {
      let result;
      try {
        const profile = (await this.client.request('/ingestion/profile','ProfileResponse')).data;
        requireWeb(profile.data_environment === 'SIMULATED',403,'REAL_SOURCE_FORBIDDEN','模拟器只能使用SIMULATED凭据');
        const devices = await Promise.all(profile.devices.map(async (d: any) => {
          const response = await this.client.request('/devices/'+encodeURIComponent(d.device_id)+'/assignment','AssignmentResponse');
          if (response.data.assignment) verifyAssignment(response.data.assignment);
          return {...d, assignment: response.data.assignment};
        }));
        result = {connected: true, environment: profile.data_environment, checked_at: new Date().toISOString(), devices, message: '后端连接正常'};
      } catch(e) {
        let message = '后端连接不可用，本地历史和队列保留';
        try { if (e instanceof WebError) throw e; this.upstreamError(e); } catch(mapped) { message = (mapped as Error).message; }
        result = {connected: false, checked_at: new Date().toISOString(), devices: [], message};
      }
      this.deviceCache = {expires: Date.now()+10000,result};
      return result;
    })().finally(()=>{this.deviceRequest=null;});
    return this.deviceRequest;
  }

  state() {
    const totals = this.queue.db.prepare(`SELECT count(*) AS generated,
      COALESCE(sum(state IN('PENDING','UNKNOWN')),0) AS pending,
      COALESCE(sum(state='STORED'),0) AS stored,COALESCE(sum(state='QUARANTINED'),0) AS quarantined,
      COALESCE(sum(state='REJECTED'),0) AS rejected,
      COALESCE(sum(json_extract(receipt,'$.receipt_status')='DUPLICATE'),0) AS duplicate_receipts FROM sample`).get();
    const runs = this.queue.db.prepare(`SELECT r.id,r.device_id,r.scenario,r.seed,r.target,r.generated,r.control,r.created_at,
      json_extract(r.assignment,'$.task_id') AS task_id,json_extract(r.assignment,'$.spool_id') AS spool_id,
      json_extract(r.assignment,'$.metric_code') AS metric_code,
      (SELECT count(*) FROM sample s WHERE s.run_id=r.id AND s.state IN('PENDING','UNKNOWN')) AS pending,
      (SELECT count(*) FROM sample s WHERE s.run_id=r.id AND s.state='STORED') AS stored,
      (SELECT count(*) FROM sample s WHERE s.run_id=r.id AND s.state='QUARANTINED') AS quarantined,
      (SELECT count(*) FROM sample s WHERE s.run_id=r.id AND s.state='REJECTED') AS rejected
      FROM sim_run r ORDER BY EXISTS(SELECT 1 FROM web_execution e WHERE e.run_id=r.id AND e.status IN('STARTING','RUNNING','STOPPING')) DESC,r.created_at DESC LIMIT 100`).all().map((r:any)=>{const p=this.models.pass(r.id);return {...r,job:this.lastJob(r.id),feed:p?{...this.feed.summary(r.id,p.snapshot),mode:p.mode,exited:!!p.exit_response,exit_error:p.exit_error}:null};});
    const starting = this.queue.db.prepare("SELECT * FROM web_execution WHERE status IN('STARTING','RUNNING','STOPPING') AND run_id NOT IN(SELECT id FROM sim_run)").all();
    const preparations=this.queue.db.prepare("SELECT * FROM web_execution WHERE run_id NOT IN(SELECT id FROM sim_run) ORDER BY started_at DESC LIMIT 20").all();
    return {totals,runs,starting,preparations,as_of:new Date().toISOString(),history_limit:100};
  }

  detail(id: string, before: number) {
    const run = this.queue.run(id);
    requireWeb(run,404,'RUN_NOT_FOUND','运行记录不存在');
    const rows = this.queue.db.prepare('SELECT record_id,sequence,state,receipt,attempts,payload FROM sample WHERE run_id=? AND (?=0 OR sequence<?) ORDER BY sequence DESC LIMIT 51').all(id,before,before) as any[];
    const items = rows.slice(0,50).map(r=>({...r,payload:JSON.parse(r.payload),receipt:r.receipt?JSON.parse(r.receipt):null}));
    const logs = this.queue.db.prepare('SELECT id,at,event,level,detail FROM web_log WHERE run_id=? ORDER BY id DESC LIMIT 50').all(id);
    return {run:{...run,assignment:JSON.parse(run.assignment),ack:undefined},job:this.lastJob(id),items,has_more:rows.length>50,next_before:rows.length>50?items.at(-1).sequence:null,logs};
  }

  async create(input: Input) {
    requireWeb(!this.modelBusy.has(input?.device_id),409,'MODEL_BUSY','设备正在准备线缆检测');
    requireWeb(input && typeof input==='object' && Object.keys(input).sort().join(',')==='count,device_id,interval_ms,request_id,scenario,seed',400,'INVALID_INPUT','参数不完整或包含未知字段');
    requireWeb(typeof input.request_id==='string' && /^[a-f0-9-]{36}$/.test(input.request_id) && validId(input.device_id),400,'INVALID_ID','请求标识或设备标识无效');
    requireWeb(scenarios.includes(input.scenario) && Number.isInteger(input.count) && input.count>=1 && input.count<=100000 && Number.isInteger(input.interval_ms) && input.interval_ms>=50 && input.interval_ms<=60000 && Number.isSafeInteger(input.seed) && input.seed>=0,400,'INVALID_INPUT','数量1—100000，间隔50—60000毫秒，种子为非负整数');
    const runId = 'web-'+input.request_id;
    const hash = createHash('sha256').update(JSON.stringify([input.device_id,input.scenario,input.count,input.interval_ms,input.seed])).digest('hex');
    const previous = this.queue.db.prepare('SELECT * FROM web_execution WHERE run_id=? ORDER BY rowid LIMIT 1').get(runId) as Job | undefined;
    if (previous) { requireWeb(previous.request_hash===hash,409,'REQUEST_CONFLICT','同一请求标识不能改变输入参数'); return previous; }
    try {
      const profile = (await this.client.request('/ingestion/profile','ProfileResponse')).data;
      requireWeb(profile.data_environment==='SIMULATED' && profile.devices.some((d:any)=>d.device_id===input.device_id),403,'DEVICE_NOT_ALLOWED','设备不在模拟凭据允许范围');
      const assignment = (await this.client.request('/devices/'+encodeURIComponent(input.device_id)+'/assignment','AssignmentResponse')).data.assignment;
      requireWeb(assignment,409,'NO_ASSIGNMENT','该设备没有运行中的平台任务，请先在平台创建并开始任务');
      verifyAssignment(assignment);
    } catch(e) { if (e instanceof WebError) throw e; this.upstreamError(e); }
    return this.launch(runId,input.device_id,'run',input,hash);
  }

  private launch(run: string, device: string, command: string, input: Partial<Input>, hash='') {
    requireWeb(!this.productionBusy.has(device),409,'EVENT_BUSY','正在处理进出料事件，请稍后重试');
    requireWeb(!this.closing,503,'SHUTTING_DOWN','模拟器正在停止，请稍后操作');
    const lease = this.queue.db.prepare('SELECT expires_at FROM producer_lease WHERE device_id=?').get(device);
    requireWeb(!lease || Number(lease.expires_at)<=Date.now(),409,'DEVICE_BUSY','该设备已有采集进程，或上次进程租约尚未到期，请稍后重试');
    const id = randomUUID();
    try {
      this.queue.transaction(()=>{
        this.queue.db.prepare("INSERT INTO web_execution(id,run_id,device_id,command,status,input,request_hash,started_at) VALUES(?,?,?,?,'STARTING',?,?,?)")
          .run(id,run,device,command,JSON.stringify(input),hash,new Date().toISOString());
        // drain/replay must not restart sampling, even when the old run was stopped.
        this.queue.db.prepare('UPDATE sim_run SET control=? WHERE id=?').run(command==='run'?'RUNNING':'PAUSED',run);
      });
    } catch { throw new WebError(409,'DEVICE_BUSY','该设备正在执行其他操作，请等待完成'); }
    const job = this.job(id)!;
    const args = [join(__dirname,'cli.js'),command,'--run',run,'--interval-ms',String(input.interval_ms||500)];
    if (input.device_id) args.push('--device',device,'--count',String(input.count),'--scenario',String(input.scenario),'--seed',String(input.seed));
    const child = spawn(process.execPath,args,{env:{...process.env,SIM_DB:this.databasePath,SIM_PRODUCER_OWNER:id},stdio:['ignore','pipe','pipe'],windowsHide:true});
    this.children.set(id,child);
    this.queue.db.prepare("UPDATE web_execution SET status='RUNNING' WHERE id=?").run(id);
    this.log(job,'EXECUTION_STARTED',{command});
    let buffer='';
    child.stdout!.on('data',chunk=>{
      buffer+=String(chunk);
      if(buffer.length>65536)buffer=buffer.slice(-65536);
      let end;
      while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);try{const value=JSON.parse(line);if(typeof value.event==='string')this.log(job,value.event,value);}catch{}}
    });
    child.stderr!.on('data',chunk=>{
      // Only structured application events enter UI logs; never echo raw environment/stack output.
      for(const line of String(chunk).split('\n'))try{const value=JSON.parse(line);if(typeof value.event==='string'){this.log(job,value.event,value,'WARN');if(value.message)this.queue.db.prepare('UPDATE web_execution SET message=? WHERE id=?').run(String(value.message).slice(0,500),id);}}catch{}
    });
    child.on('error',()=>{this.log(job,'PROCESS_START_FAILED',{message:'无法启动采集进程'},'ERROR');});
    child.on('close',code=>{
      // The child is confirmed closed. Release only this job's lease, never another producer's.
      this.queue.release(device,id);
      const current=this.job(id)!;
      if(current.status==='STOPPING')this.queue.db.prepare("UPDATE sim_run SET control='STOPPED' WHERE id=?").run(run);
      const status=current.status==='STOPPING'?'STOPPED':this.closing?'INTERRUPTED':code===0?'SUCCEEDED':code===2?'PENDING':'FAILED';
      this.queue.db.prepare('UPDATE web_execution SET status=?,ended_at=?,exit_code=? WHERE id=?').run(status,new Date().toISOString(),code,id);
      this.log(job,'EXECUTION_FINISHED',{status,exit_code:code});this.children.delete(id);
      if(!this.closing&&status==='SUCCEEDED'&&this.models.pass(run))void this.finishPass(run).catch(e=>{this.queue.db.prepare('UPDATE model_pass SET exit_error=? WHERE run_id=?').run(String(e.message).slice(0,300),run);});
    });
    return this.job(id)!;
  }

  async createPass(b:any){
    keys(b,['request_id','cable_id','cable_version','detector_id','detector_version','mode','task_id','spool_id']);
    insist(typeof b.request_id==='string'&&/^[a-f0-9-]{36}$/.test(b.request_id),'请求ID无效');
    insist(['BOUND','AUTO'].includes(b.mode),'请选择已有任务或自动进出料');
    for(const k of ['cable_id','detector_id'])insist(typeof b[k]==='string'&&/^[a-f0-9-]{36}$/.test(b[k]),'模型ID无效');
    for(const k of ['task_id','spool_id'])insist(b[k]===''||validId(b[k]),'任务或盘ID无效');
    for(const k of ['cable_version','detector_version'])insist(Number.isInteger(b[k])&&b[k]>0,'请选择明确模型版本');
    const id='cable-'+b.request_id,hash=hashInput(b),existing=this.models.pass(id);
    insist(!existing||existing.input_hash===hash,'同一请求ID内容已变化',409,'REQUEST_CONFLICT');
    const old=this.lastJob(id);if(old)return old;
    const snapshot=existing?.snapshot||this.models.snapshot(b.cable_id,b.detector_id,b.cable_version,b.detector_version),device=snapshot.detector.data.device_id;
    insist(!this.modelBusy.has(device),'设备正在准备检测',409,'DEVICE_BUSY');
    const active=this.queue.db.prepare("SELECT id FROM web_execution WHERE device_id=? AND status IN('STARTING','RUNNING','STOPPING')").get(device);insist(!active,'设备正在采样，请先停止或等待完成',409,'DEVICE_BUSY');
    this.modelBusy.add(device);
    try{
      const profile=(await this.client.request('/ingestion/profile','ProfileResponse')).data;
      insist(profile.data_environment==='SIMULATED'&&profile.devices.some((d:any)=>d.device_id===device&&d.metric_codes.includes(snapshot.detector.data.metric)),'设备模型与平台授权指标不相符',403,'MODEL_DEVICE_MISMATCH');
      if(snapshot.cable.data.material_ref.startsWith('platform:')){
        const root=snapshot.cable.data.material_ref.slice(9);insist(root===snapshot.cable.id,'平台线缆关联不一致',409,'CATALOG_LINK_MISMATCH');const catalog=await this.catalog({id:root});const spool=catalog.items.find((x:any)=>x.id===root);
        if(spool&&!existing)snapshot.cable.data.name=spool.spool_code;
        const task=spool?.tasks.find((t:any)=>t.id===b.task_id);
        insist(task&&task.spool_id===b.spool_id&&task.device_id===device&&task.metric_code===snapshot.detector.data.metric,'请选择该线缆对应的设备任务；平台归属可能已变化，请刷新',409,'CATALOG_TASK_MISMATCH');
        insist(task.state==='RUNNING'||b.mode==='AUTO'&&task.state==='CREATED','请先在主平台开始所选任务，或选择自动进出料',409,'CATALOG_TASK_NOT_RUNNING');
      }
      const event={request_id:b.request_id,device_id:device,encounter_id:id,phase:'ENTER',counter_id:id,value_m:'0',material_ref:snapshot.cable.data.material_ref,...(b.task_id?{task_id:b.task_id}:{}),...(b.spool_id?{spool_id:b.spool_id}:{})};
      if(!existing)this.queue.db.prepare('INSERT INTO model_pass(run_id,input_hash,snapshot,mode,device_id,event_input,created_at) VALUES(?,?,?,?,?,?,?)').run(id,hash,JSON.stringify(snapshot),b.mode,device,JSON.stringify(event),new Date().toISOString());
      let entered=existing?.enter_response;
      if(b.mode==='AUTO'&&!entered){entered=await this.production(event,true);this.queue.db.prepare('UPDATE model_pass SET enter_response=?,exit_error=NULL WHERE run_id=?').run(JSON.stringify(entered),id);}
      const assignment=(await this.client.request('/devices/'+device+'/assignment','AssignmentResponse')).data.assignment;
      insist(assignment,'设备没有运行任务；请在平台开始任务，或启用自动发现',409,'NO_ASSIGNMENT');verifyAssignment(assignment);
      insist(assignment.metric_code===snapshot.detector.data.metric&&(!b.task_id||b.task_id===assignment.task_id)&&(!b.spool_id||b.spool_id===assignment.spool_id)&&(!entered||entered.task_id===assignment.task_id),'任务或盘与设备模型不匹配',409,'TASK_MISMATCH');
      return this.launch(id,device,'run',{request_id:b.request_id,device_id:device,scenario:'cable',count:snapshot.count,interval_ms:snapshot.interval_ms,seed:0},hash);
    }catch(e){if(e instanceof HttpFailure)this.upstreamError(e);throw e;}finally{this.modelBusy.delete(device);}
  }

  async finishPass(id:string){
    const p=this.models.pass(id);insist(p,'过料记录不存在',404);if(p.exit_response||p.mode==='BOUND')return p.exit_response||{mode:'BOUND',message:'已有任务模式由平台手动结束任务'};
    const run=this.queue.run(id),active=this.lastJob(id);insist(run&&run.generated===run.target&&!['STARTING','RUNNING','STOPPING'].includes(active?.status||''),'线缆尚未完成检测，不能出料',409);
    insist(this.queue.pending(id).length===0,'存在待补传样本，请先补传队列',409);
    const event={...p.event_input,request_id:p.event_input.request_id+'-exit',phase:'EXIT',value_m:p.snapshot.cable.data.length_m,task_id:p.enter_response.task_id,spool_id:p.enter_response.spool_id};
    try{const result=await this.production(event,true);this.queue.db.prepare('UPDATE model_pass SET exit_response=?,exit_error=NULL WHERE run_id=?').run(JSON.stringify(result),id);return result;}
    catch(e){this.queue.db.prepare('UPDATE model_pass SET exit_error=? WHERE run_id=?').run(e instanceof WebError?e.message:'出料回执未知，请重试原事件',id);throw e;}
  }

  control(id: string, action: string) {
    requireWeb(['pause','resume','stop','drain','replay'].includes(action),400,'INVALID_ACTION','不支持的控制命令');
    const run = this.queue.run(id);
    const job = this.lastJob(id), child = job?this.children.get(job.id):undefined;
    if(!run&&action==='stop'&&child){this.queue.db.prepare("UPDATE web_execution SET status='STOPPING' WHERE id=?").run(job!.id);child.kill('SIGTERM');this.log(job!,'STOP_REQUESTED',{during_startup:true});return {stopping:true,queue_retained:true};}
    requireWeb(run,404,'RUN_NOT_FOUND','运行记录不存在');
    if (action==='pause') {
      requireWeb(child && job?.command==='run' && job.status==='RUNNING',409,'NOT_RUNNING','当前没有可暂停的采集进程');
      this.queue.db.prepare("UPDATE sim_run SET control='PAUSED' WHERE id=?").run(id);this.log(job!,'PAUSED',{});return {paused:true};
    }
    if (action==='stop') {
      this.queue.db.prepare("UPDATE sim_run SET control='STOPPED' WHERE id=?").run(id);
      if(child){this.queue.db.prepare("UPDATE web_execution SET status='STOPPING' WHERE id=?").run(job!.id);child.kill('SIGTERM');this.log(job!,'STOP_REQUESTED',{});}
      return {stopping:!!child,queue_retained:true};
    }
    if(action==='resume' && child) {
      requireWeb(job?.command==='run' && job.status==='RUNNING',409,'NOT_PAUSABLE','当前执行不能继续采样');
      this.queue.db.prepare("UPDATE sim_run SET control='RUNNING' WHERE id=?").run(id);this.log(job!,'RESUMED',{});return {resumed:true};
    }
    requireWeb(!child,409,'RUN_BUSY','当前运行尚未结束，请先停止或等待完成');
    if(action==='resume')requireWeb(run.generated<run.target,409,'ALREADY_COMPLETE','本次已完成全部采样，请新建运行或选择重放');
    const prior=job?JSON.parse(job.input):{};
    return this.launch(id,run.device_id,action==='resume'?'run':action,{interval_ms:prior.interval_ms||500});
  }

  changeSpeed(id:string,input:any){
    const p=this.models.pass(id);requireWeb(p,404,'PASS_NOT_FOUND','本次运行不是线缆过料');
    const job=this.lastJob(id);requireWeb(job?.command==='run'&&job.status==='RUNNING'&&this.children.has(job.id),409,'FEED_NOT_ACTIVE','请在运行或暂停送料时调整速度');
    const speed=this.feed.change(id,p.snapshot,input);this.log(job!,'FEED_SPEED_CHANGED',speed);return speed;
  }

  async close() {
    this.closing=true;
    for(const child of this.children.values())child.kill('SIGTERM');
    for(let i=0;i<80 && this.children.size;i++)await new Promise(r=>setTimeout(r,100));
    for(const child of this.children.values())child.kill('SIGKILL');
    for(let i=0;i<20 && this.children.size;i++)await new Promise(r=>setTimeout(r,100));
    this.queue.db.close();
  }
}
