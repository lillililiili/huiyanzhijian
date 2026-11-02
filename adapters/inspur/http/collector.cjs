'use strict';
// M08 external source worker. Uses only M00/M02/M04 public HTTP interfaces.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {DatabaseSync}=require('node:sqlite');
const {queryAll}=require('./client.cjs');
const {validateConfig,mapRecord,schemas,insist}=require('./contract.cjs');
const canonical=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
class Collector {
 constructor(config){
  this.config=validateConfig(config);insist(config.lineId&&config.expectedTaskId&&config.deviceId,'VENDOR_TASK_MAPPING_REQUIRED');
  const url=new URL(config.platformUrl);insist(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password,'PLATFORM_URL_INVALID');
  fs.mkdirSync(path.dirname(path.resolve(config.queueFile)),{recursive:true});this.db=new DatabaseSync(config.queueFile);
  this.db.exec(`PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA busy_timeout=5000;
   CREATE TABLE IF NOT EXISTS metadata(id INTEGER PRIMARY KEY CHECK(id=1),config TEXT NOT NULL,context TEXT NOT NULL,next_sequence INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY,source_json TEXT NOT NULL,payload TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'PENDING',receipt TEXT);`);
 }
 async platform(route,payload){
  const token=process.env[this.config.platformTokenEnv||'DEVICE_TOKEN'];insist(token,'PLATFORM_TOKEN_REQUIRED');
  const r=await fetch(this.config.platformUrl+'/api/v1'+route,{method:payload===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:payload===undefined?undefined:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(10000)});
  insist(r.ok,'PLATFORM_HTTP_'+r.status);const body=await r.json();insist(body.code==='OK'&&body.data,'PLATFORM_BUSINESS_FAILURE');return body.data;
 }
 async bind(){
  const c=this.config;
  const fingerprint=JSON.stringify([c.platformUrl,c.baseUrl,c.path,c.method,c.metric,c.deviceId,c.lineId,c.expectedTaskId,c.environment,c.percentScale,c.gapUnit,c.timezoneOffsetMinutes,c.sampleTimeField]);
  const saved=this.db.prepare('SELECT * FROM metadata WHERE id=1').get();
  if(saved){insist(saved.config===fingerprint,'VENDOR_QUEUE_CONFIG_CONFLICT');return JSON.parse(saved.context);}
  const profile=await this.platform('/ingestion/profile');insist(profile.data_environment===c.environment,'VENDOR_ENVIRONMENT_MISMATCH');
  const device=profile.devices.find(d=>d.device_id===c.deviceId);insist(device?.raw_schema_versions.includes(schemas[c.metric]),'VENDOR_RAW_VERSION_NOT_REGISTERED');
  const a=(await this.platform('/devices/'+encodeURIComponent(c.deviceId)+'/assignment')).assignment;
  insist(a?.task_id===c.expectedTaskId&&a.metric_code===c.metric,'VENDOR_TASK_MAPPING_MISMATCH');
  const session=await this.platform('/device-sessions',{schema_version:'1.0',device_id:c.deviceId,client_session_id:randomUUID(),data_environment:c.environment,producer_version:'ODM01.v1'});
  const context={lineId:c.lineId,metric:c.metric,device_id:c.deviceId,capture_session_id:'odm-'+randomUUID(),task_id:a.task_id,binding_id:a.binding_id,binding_version:a.binding_version,recipe_version_id:a.recipe_version_id,method_id:a.rule_snapshot?.method_id??null,position_segment_id:null};
  // Persist before ACK: a lost response is retried with the same id and payload.
  const ack={schema_version:'1.0',ack_id:randomUUID(),connection_id:session.connection_id,binding_id:a.binding_id,binding_version:a.binding_version,snapshot_hash:a.snapshot_hash,result:'APPLIED',effective_at:new Date().toISOString(),capture_session_id:context.capture_session_id,first_capture_sequence:'1',reason_code:null};
  context.ack=ack;this.db.prepare('INSERT INTO metadata VALUES(1,?,?,1)').run(fingerprint,JSON.stringify(context));return context;
 }
 async collect(){
  const c=this.config,context=await this.bind();
  if(context.ack){await this.platform('/devices/'+encodeURIComponent(c.deviceId)+'/assignment-acks',context.ack);delete context.ack;this.db.prepare('UPDATE metadata SET context=? WHERE id=1').run(JSON.stringify(context));}
  const headers={};for(const [header,env] of Object.entries(c.headerEnv||{})){insist(process.env[env],'VENDOR_AUTH_ENV_REQUIRED');headers[header]=process.env[env];}
  const query={lineId:c.lineId,startTime:c.startTime,endTime:c.endTime,limit:c.limit||100,...(c.metric==='WIRE_GAP'?{dataType:'GAP'}:{})};
  await queryAll({...c,headers},query,rows=>{
   this.db.exec('BEGIN IMMEDIATE');try{
    let sequence=Number(this.db.prepare('SELECT next_sequence FROM metadata').get().next_sequence);
    for(const row of rows){const source=JSON.stringify(row),old=this.db.prepare('SELECT source_json FROM outbox WHERE id=?').get(row.id);
     if(old){insist(canonical(JSON.parse(old.source_json))===canonical(row),'VENDOR_SOURCE_CONTENT_CONFLICT');continue;}
     const measurement=mapRecord(row,{...context,capture_sequence:String(sequence++)},c);
     this.db.prepare('INSERT INTO outbox(id,source_json,payload) VALUES(?,?,?)').run(row.id,source,JSON.stringify(measurement));
    }
    this.db.prepare('UPDATE metadata SET next_sequence=?').run(sequence);this.db.exec('COMMIT');
   }catch(e){this.db.exec('ROLLBACK');throw e;}
  });
  return this.drain();
 }
 async drain(){
  for(;;){const pending=this.db.prepare("SELECT * FROM outbox WHERE state='PENDING' ORDER BY rowid LIMIT 50").all();if(!pending.length)break;
   const records=pending.map(r=>JSON.parse(r.payload));
   const receipt=await this.platform('/measurements:ingest',{schema_version:'1.0',batch_id:randomUUID(),sent_at:new Date().toISOString(),records});
   insist(receipt.items?.length===pending.length&&receipt.counts?.total===pending.length,'PLATFORM_RECEIPT_COUNT_INVALID');
   for(let i=0;i<pending.length;i++){const item=receipt.items[i];insist(item.input_index===i&&item.source_id===records[i].record_id&&['STORED','QUARANTINED','DUPLICATE','REJECTED'].includes(item.receipt_status),'PLATFORM_RECEIPT_IDENTITY_INVALID');}
   let retry=false;this.db.exec('BEGIN IMMEDIATE');try{for(let i=0;i<pending.length;i++){
    const item=receipt.items[i];const state=item.receipt_status==='DUPLICATE'?item.initial_status:item.receipt_status==='REJECTED'&&item.retryable?'PENDING':item.receipt_status;
    insist(['PENDING','STORED','QUARANTINED','REJECTED'].includes(state),'PLATFORM_RECEIPT_STATE_INVALID');retry||=state==='PENDING';
    this.db.prepare('UPDATE outbox SET state=?,receipt=? WHERE id=?').run(state,JSON.stringify(item),pending[i].id);
   }this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
   if(retry)break;
  }
  return this.db.prepare('SELECT state,count(*) AS count FROM outbox GROUP BY state').all();
 }
 close(){this.db.close();}
}
module.exports={Collector};
if(require.main===module){let collector;(async()=>{const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));collector=new Collector(config);const states=await collector.collect();console.log(JSON.stringify({event:'ODM01_COLLECTED',states}));if(states.some(s=>s.state==='PENDING'||s.state==='REJECTED'))process.exitCode=2;})().catch(e=>{console.error(JSON.stringify({event:'ODM01_STOPPED',code:/^[A-Z0-9_]+$/.test(e.message)?e.message:'SOURCE_OR_PLATFORM_UNAVAILABLE',queue_retained:true}));process.exitCode=1;}).finally(()=>collector?.close());}
