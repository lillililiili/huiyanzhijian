import {randomUUID} from 'node:crypto';
import {readFileSync,statfsSync} from 'node:fs';
import {resolve} from 'node:path';
import {Queue} from './queue';
import {DeviceClient,HttpFailure,check,verifyAssignment} from './client';
import {record} from './scenarios';
import {ModelStore,modelRecord} from './model-store';
import {FeedControl} from './feed-control';
import {edgeRequest} from './edge-client';
import {EdgeDelivery} from './edge-delivery';
const command=process.argv[2]||'status',args:Record<string,string>={};for(let i=3;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Use --key value');args[process.argv[i].slice(2)]=process.argv[i+1];}
const q=new Queue(resolve(process.env.SIM_DB||'../../runtime/b1/simulator.sqlite'));let stopping=false;for(const s of ['SIGINT','SIGTERM'] as const)process.on(s,()=>{stopping=true;});
const models=new ModelStore(q),feed=new FeedControl(q);
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
async function main(){
 if(command==='status'){console.log(JSON.stringify(q.status(args.run),null,2));return;}
 if(['pause','resume','stop'].includes(command)){if(!args.run||!q.run(args.run))throw Error('Existing --run required');q.db.prepare('UPDATE sim_run SET control=? WHERE id=?').run(command==='resume'?'RUNNING':command==='pause'?'PAUSED':'STOPPED',args.run);console.log('control updated');return;}
 if(!['run','drain','replay'].includes(command))throw Error('Commands: run/status/pause/resume/stop/drain/replay');
 const token=process.env.DEVICE_TOKEN||(process.env.ACCESS_FILE?JSON.parse(readFileSync(process.env.ACCESS_FILE,'utf8')).device_token:'');if(!token)throw Error('DEVICE_TOKEN or ACCESS_FILE required');const client=new DeviceClient(process.env.API_URL||'http://127.0.0.1:4192',token,q);
 const id=args.run||('run-'+randomUUID());if(!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,89}$/.test(id))throw Error('Invalid --run');let run=q.run(id);
 if(!run){if(command!=='run')throw Error('Existing --run required');const device=args.device;if(!device)throw Error('--device required');const count=Number(args.count||100),seed=Number(args.seed||0),scenario=args.scenario||'mixed';if(!Number.isInteger(count)||count<1||count>100000||!Number.isInteger(seed)||seed<0||!['mixed','normal','boundary','over','invalid','cable','SCENARIO_PERFECT','SCENARIO_OVERLAP_DEFECT','SCENARIO_GAP_GLITCH','SCENARIO_OVALITY_OUT_OF_BOUNDS','SCENARIO_SENSOR_BLOCKED','perfect','overlap_defect','gap_glitch','ovality_out_of_bounds','sensor_blocked'].includes(scenario))throw Error('Invalid count/seed/scenario');
  const profile=(await client.request('/ingestion/profile','ProfileResponse')).data;if(profile.data_environment!=='SIMULATED'||!profile.devices.some((d:any)=>d.device_id===device))throw Error('Simulator requires authorized SIMULATED device');const assignment=(await client.request('/devices/'+device+'/assignment','AssignmentResponse')).data.assignment;if(!assignment)throw Error('Create and start a task through platform personnel API first');
  verifyAssignment(assignment);if(scenario==='cable'){const model=models.pass(id);if(!model||model.snapshot.detector.data.metric!==assignment.metric_code||model.snapshot.count!==count)throw Error('Frozen cable model missing or task metric mismatch');}q.db.prepare('INSERT INTO sim_run(id,device_id,capture_session,scenario,seed,target,assignment,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,device,'capture-'+randomUUID(),scenario,seed,count,JSON.stringify(assignment),new Date().toISOString());run=q.run(id);
 }
 const edgeMetric=JSON.parse(run.assignment).metric_code==='OVALITY';let edgeReady=!edgeMetric,lastEdgeRead=0;
 const owner=process.env.SIM_PRODUCER_OWNER||randomUUID();q.lease(run.device_id,owner);let heartbeatSeq=0,lastBeat=0,connection:string|null=null,attempt=0,nextSend=0;
 console.log(JSON.stringify({event:'RUN_OPEN',run_id:id,device_id:run.device_id,generated:run.generated,target:run.target}));
 try{
  if(command==='replay')q.transaction(()=>{q.db.prepare('DELETE FROM edge_local_accept WHERE record_id IN(SELECT record_id FROM sample WHERE run_id=?)').run(id);q.db.prepare("UPDATE sample SET state='PENDING' WHERE run_id=? AND state IN('STORED','QUARANTINED')").run(id);});
  if(command==='run'&&run.generated<run.target){const profile=(await client.request('/ingestion/profile','ProfileResponse')).data;if(profile.data_environment!=='SIMULATED')throw Error('SIMULATED credential required');const s=await client.request('/device-sessions','SessionResponse',{schema_version:'1.0',device_id:run.device_id,data_environment:'SIMULATED',client_session_id:'session-'+owner,producer_version:'simulator-b1-v1'});connection=s.data.connection_id;
   const a=JSON.parse(run.assignment);let ack=run.ack?JSON.parse(run.ack):null;
   if(!ack){ack={schema_version:'1.0',ack_id:'ack-'+randomUUID(),connection_id:connection,binding_id:a.binding_id,binding_version:a.binding_version,snapshot_hash:a.snapshot_hash,result:'APPLIED',effective_at:new Date().toISOString(),capture_session_id:run.capture_session,first_capture_sequence:'1',reason_code:null};q.db.prepare('UPDATE sim_run SET ack=? WHERE id=?').run(JSON.stringify(ack),id);}
   // New transport connection must not rewrite the previously persisted ack payload.
   if(ack.connection_id!==connection){const current=(await client.request('/devices/'+run.device_id+'/assignment','AssignmentResponse')).data.assignment;if(!current||current.binding_id!==a.binding_id)throw Error('Assignment changed; drain original queue and start a new run');ack={...ack,ack_id:'ack-'+randomUUID(),connection_id:connection,effective_at:new Date().toISOString(),first_capture_sequence:String(run.generated+1)};q.db.prepare('UPDATE sim_run SET ack=? WHERE id=?').run(JSON.stringify(ack),id);}
   await client.request('/devices/'+run.device_id+'/assignment-acks','AckResponse',ack);
  }
  const frozen=run.scenario==='cable'?models.pass(id).snapshot:null;
  const interval=Number(args['interval-ms']||500);if(!Number.isInteger(interval)||interval<1||interval>60000)throw Error('interval-ms must be 1..60000');const maxWait=Number(args['drain-seconds']||60)*1000;let finishedAt=0;
  let transport:Promise<void>|null=null,transportError:unknown=null,nextSample=performance.now(),lastLease=0;
  const delivery=new EdgeDelivery(q,id);let receiptTransport:Promise<void>|null=null,monitorTransport:Promise<void>|null=null,nextMonitor=0;
  const monitor=async()=>{
   if(edgeMetric&&command==='run'&&Date.now()-lastEdgeRead>=1000){lastEdgeRead=Date.now();try{const edge=await edgeRequest('/status');edgeReady=edge.state==='RUNNING'&&edge.run?.taskId===JSON.parse(run.assignment).task_id;if(!edgeReady&&edge.state!=='PAUSED')throw Error('边缘终端未采集当前任务，请扫码后重新启动送料');}catch(e){edgeReady=false;if(e instanceof Error&&e.message.startsWith('边缘终端未采集'))throw e;}}
   if(connection&&Date.now()-lastBeat>=10000){lastBeat=Date.now();heartbeatSeq++;const a=JSON.parse(run.assignment);try{const disk=statfsSync(resolve(process.env.SIM_DB||'../../runtime/b1/simulator.sqlite'),{bigint:true});const last=q.db.prepare('SELECT payload FROM sample WHERE run_id=? ORDER BY sequence DESC LIMIT 1').get(id);const pendingCount=q.db.prepare("SELECT count(*) AS n FROM sample WHERE run_id=? AND state IN('PENDING','UNKNOWN')").get(id);const hb=await client.request('/device-status:heartbeat','HeartbeatResponse',{schema_version:'1.0',device_id:run.device_id,data_environment:'SIMULATED',connection_id:connection,heartbeat_sequence:String(heartbeatSeq),sent_at:new Date().toISOString(),capture_session_id:run.capture_session,observed_task_id:a.task_id,observed_binding_id:a.binding_id,last_sample_time:last?JSON.parse(String(last.payload)).sample_time:null,last_record_id:run.generated?id+'-'+run.generated:null,queue_depth:Number(pendingCount?.n||0),disk_free_bytes:String(disk.bavail*disk.bsize),instrument_state:'READY',config_version:'b1-v1'});if(!hb.data.accepted)console.error(JSON.stringify({event:'HEARTBEAT_NOT_ACCEPTED',reason:hb.data.reason_code}));}catch{console.error(JSON.stringify({event:'HEARTBEAT_UNAVAILABLE',queue_retained:true}));}}
  };
  const transfer=async()=>{
   await monitor();
   const candidates=q.pending(id,edgeMetric?500:50),pending:typeof candidates=[];let batchBytes=1024;
   for(const sample of candidates){const size=Buffer.byteLength(sample.payload,'utf8')+1;if(pending.length&&batchBytes+size>800000)break;pending.push(sample);batchBytes+=size;}
   if(pending.length&&Date.now()>=nextSend){try{
    const response=await client.request('/measurements:ingest','BatchReceipt',{schema_version:'1.0',batch_id:'batch-'+randomUUID(),sent_at:new Date().toISOString(),records:pending.map(x=>JSON.parse(x.payload))});const receipt=response.data;
    if(receipt.items.length!==pending.length||receipt.counts.total!==pending.length||['stored','duplicate','quarantined','rejected'].reduce((n,k)=>n+receipt.counts[k],0)!==pending.length)throw Error('Receipt count mismatch');
    for(let i=0;i<pending.length;i++)if(receipt.items[i].input_index!==i||receipt.items[i].source_id!==pending[i].record_id)throw Error('Receipt identity mismatch');for(const k of ['stored','duplicate','quarantined','rejected'])if(receipt.items.filter((x:any)=>x.receipt_status.toLowerCase()===k).length!==receipt.counts[k])throw Error('Receipt status counts mismatch');
    q.transaction(()=>{for(let i=0;i<pending.length;i++){const it=receipt.items[i],state=it.receipt_status==='DUPLICATE'?it.initial_status:it.receipt_status==='REJECTED'&&it.retryable?'PENDING':it.receipt_status;q.db.prepare('UPDATE sample SET state=?,receipt=?,attempts=attempts+1 WHERE record_id=?').run(state,JSON.stringify(it),pending[i].record_id);}q.db.prepare('INSERT INTO delivery_attempt(run_id,at,request_id,result,detail) VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),response.request_id,'RECEIPT',JSON.stringify(receipt.counts));});attempt=0;nextSend=Date.now()+Math.max(100,...receipt.items.filter((it:any)=>it.retryable).map((it:any)=>it.retry_after_ms||1000));console.log(JSON.stringify({event:'RECEIPT',run_id:id,...receipt.counts}));
   }catch(e){attempt++;const wait=Math.max(Math.min(60000,1000*2**Math.min(attempt-1,6)),e instanceof HttpFailure?e.retryMs:0);nextSend=Date.now()+wait;q.db.prepare('INSERT INTO delivery_attempt(run_id,at,result,detail) VALUES(?,?,?,?)').run(id,new Date().toISOString(),'UNKNOWN',e instanceof HttpFailure?'HTTP '+e.status:'Network or invalid receipt; original queue retained');if(e instanceof HttpFailure&&[400,401,403,409,413,415,422,501].includes(e.status))throw Error('Upload needs configuration correction; queue retained');}}
  };
  try{
  while(!stopping){if(transportError)throw transportError;if(Date.now()-lastLease>=5000){q.lease(run.device_id,owner);lastLease=Date.now();}run=q.run(id);if(command==='run'&&run.control==='STOPPED')break;
   if(edgeMetric){
    if(!monitorTransport&&Date.now()>=nextMonitor&&run.generated<run.target){nextMonitor=Date.now()+1000;monitorTransport=monitor().catch(e=>{transportError=e;}).finally(()=>{monitorTransport=null;});}
    if(!transport&&(run.generated<run.target||q.pending(id).length))transport=delivery.send().catch(e=>{transportError=e;}).finally(()=>{transport=null;});
    if(!receiptTransport&&q.pending(id).length)receiptTransport=delivery.receipts().catch(e=>{transportError=e;}).finally(()=>{receiptTransport=null;});
   }else if(!transport&&(run.generated<run.target||q.pending(id).length))transport=transfer().catch(e=>{transportError=e;}).finally(()=>{transport=null;});

   if(command==='run'&&run.control==='RUNNING'&&run.generated<run.target&&(!edgeMetric||edgeReady)&&performance.now()>=nextSample){const disk=statfsSync(resolve(process.env.SIM_DB||'../../runtime/b1/simulator.sqlite'),{bigint:true});if(disk.bavail*disk.bsize<16777216n)throw Error('Disk space below 16MiB; capture stopped, queue retained');const queued=q.db.prepare("SELECT count(*) AS n FROM sample WHERE state IN('PENDING','UNKNOWN')").get();if(Number(queued?.n)>=100000)throw Error('Queue capacity reached; capture stopped without deleting samples');const r=run.scenario==='cable'?modelRecord(run,run.generated+1,frozen,feed.position(id,frozen,run.generated+1)):record(run,run.generated+1);check('Measurement',r);q.saveSample(id,r);const cadence=frozen?feed.current(id,frozen).interval_ms:interval;nextSample+=cadence;if(nextSample<performance.now())nextSample=performance.now()+cadence;run=q.run(id);const a=JSON.parse(run.assignment);if(a.planned_length_m&&r.position_m){await feed.checkAutoCutSpool({runId:id,currentPositionM:r.position_m,plannedLengthM:a.planned_length_m,deviceId:run.device_id,spoolId:a.spool_id,client});}}

   const done=command!=='run'||run.generated>=run.target;if(done){if(!finishedAt)finishedAt=Date.now();if(!q.pending(id).length&&!transport)break;if(Date.now()-finishedAt>=maxWait)break;}if(run.control==='PAUSED'||edgeMetric&&!edgeReady){nextSample=performance.now();await sleep(50);}
   else await sleep(done?50:Math.max(1,Math.min(50,nextSample-performance.now())));
  }
  }finally{await Promise.all([transport,receiptTransport,monitorTransport]);}
  if(transportError)throw transportError;
  const remaining=q.pending(id).length;console.log(JSON.stringify({event:'RUN_SAVED',run_id:id,pending:remaining,status:q.status(id)}));if(remaining)process.exitCode=2;
 }finally{q.release(run.device_id,owner);}
}
main().catch(e=>{console.error(JSON.stringify({event:'SIMULATOR_STOPPED',message:e instanceof Error?e.message:'Failed; queue retained'}));process.exitCode=1;}).finally(()=>q.db.close());
