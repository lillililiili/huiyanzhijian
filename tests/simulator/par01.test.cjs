const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID:uuid,createHash}=require('node:crypto');
const base=path.resolve(process.env.PAR01_SOURCE||'_worktrees/PAR01-parallel-feed/simulator/dist');
const {WebManager}=require(base+'/web-manager.js'),{feedOptions,parallelPasses,scannerStates}=require(base+'/parallel-feed.js');
function fixture(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'par01-')),m=new WebManager(dir+'/data.sqlite','http://127.0.0.1:1','isolated');
 const cable={id:uuid(),version:1,data:{name:'并行盘',material_ref:'fixture',length_m:'10',baseline:{tape_width_mm:'20',overlap_width_mm:'2.5',wire_gap_mm:'1.25',diameter_x_mm:'40',diameter_y_mm:'40'},defects:[]}};
 m.models.save('cables',{...cable,version:0,reason:'隔离验证'});
 const devices=['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'].map((metric,i)=>{const id='D'+i,model_id=uuid(),task={id:uuid(),task_code:'TASK'+i,spool_id:cable.id,device_id:id,metric_code:metric,state:'RUNNING',...(i===2?{companion_task:{id:uuid(),task_code:'HT',state:'RUNNING',metric_code:'SHEATH_THICKNESS'}}:{})};
 const model=m.models.save('detectors',{id:model_id,version:0,reason:'隔离验证',data:{name:id,device_id:id,metric,step_m:'0.5',speed_m_min:'60',sampling_interval_ms:50,lower:'',upper:'8'}});
 return {id,model_id,name:id,enabled:true,metric_code:metric,model,task,platform_assignment:{task_id:task.id,spool_id:cable.id,metric_code:metric}};});
 const row={id:cable.id,spool_code:'并行盘',external_code:'订单1',model:cable,tasks:devices.map(d=>d.task)};
 m.catalog=async()=>({devices,items:[row]});
 m.scannerState=async()=>({state:'RUNNING',run:{taskId:devices[2].task.id,config:{deviceId:'D2'}}});
 const cleanup=async()=>{await m.close();fs.rmSync(dir,{recursive:true,force:true});};
 return {m,devices,row,cable,cleanup};
}
test('server choices return three physical routes and four distinct metrics, with no extra sheath producer',async()=>{const f=fixture();try{const r=await feedOptions(f.m);assert.equal(r.cables.length,1);assert.equal(r.cables[0].routes.length,3);assert.equal(r.cables[0].routes.flatMap(r=>r.metrics).length,4);assert.equal(r.cables[0].routes[2].paired_task_code,'HT');}finally{await f.cleanup();}});
test('disabled, unconfigured, inactive, occupied and edge-not-ready choices are excluded',async()=>{const f=fixture();try{
 f.devices[0].enabled=false;f.devices[1].model=null;assert.equal((await feedOptions(f.m)).cables[0].routes.length,1);
 f.m.scannerState=async()=>({state:'WAITING_SCAN'});assert.equal((await feedOptions(f.m)).cables.length,0);
 f.devices[0].enabled=true;f.devices[0].task.state='ENDED';assert.equal((await feedOptions(f.m)).cables.length,0);
 f.devices[0].task.state='RUNNING';f.m.queue.lease('D0','other');assert.equal((await feedOptions(f.m)).cables.length,0);
 f.m.queue.release('D0','other');assert.equal((await feedOptions(f.m)).cables[0].routes.length,1);
 }finally{await f.cleanup();}});
test('missing metric specification and upstream failures never become selectable demo options',async()=>{const f=fixture();try{f.m.models.snapshot=()=>{throw Error('未配置规格')};assert.equal((await feedOptions(f.m)).cables.length,0);f.m.catalog=async()=>{throw Error('offline')};await assert.rejects(feedOptions(f.m),/offline/);}finally{await f.cleanup();}});
test('parallel starts overlap, partial failure is explicit and original per-route IDs survive retry',async()=>{const f=fixture();try{
 const opts=await feedOptions(f.m),items=opts.cables[0].routes.map(r=>({...r.input,request_id:uuid()}));let concurrent=0,peak=0;const seen=new Map();let fail=true;
 f.m.createPass=async item=>{concurrent++;peak=Math.max(peak,concurrent);await new Promise(r=>setTimeout(r,20));concurrent--;if(item.task_id===items[1].task_id&&fail)throw Object.assign(Error('忙'),{code:'DEVICE_BUSY'});if(!seen.has(item.request_id))seen.set(item.request_id,{run_id:'cable-'+item.request_id});return seen.get(item.request_id);};
 const first=await parallelPasses(f.m,{items});assert.equal(peak,3);assert.equal(first.started,2);assert.equal(first.failed,1);fail=false;
 const again=await parallelPasses(f.m,{items});assert.equal(again.started,3);assert.equal(seen.size,3);assert.deepEqual(again.results[0].job,first.results[0].job);
 }finally{await f.cleanup();}});
test('duplicate physical device, mixed cables and duplicate request IDs rejected before launch',async()=>{const f=fixture();try{
 const opts=await feedOptions(f.m),items=opts.cables[0].routes.map(r=>({...r.input,request_id:uuid()}));let n=0;f.m.createPass=async()=>{n++};
 await assert.rejects(parallelPasses(f.m,{items:[items[0],{...items[0],request_id:uuid()}]}));
 await assert.rejects(parallelPasses(f.m,{items:[items[0],{...items[1],cable_id:uuid()}]}));
 await assert.rejects(parallelPasses(f.m,{items:[items[0],{...items[1],request_id:items[0].request_id}]}));assert.equal(n,0);
 }finally{await f.cleanup();}});
test('scanner dashboard isolates an offline device while retaining other current orders',async()=>{const f=fixture();try{
 f.m.client.request=async()=>({data:{data_environment:'SIMULATED',devices:f.devices.map(d=>({device_id:d.id,metric_codes:[d.metric_code]}))}});
 f.m.scannerState=async d=>{if(d==='D1')throw Error('offline');return {state:'RUNNING',run:{config:{deviceId:d||'D2'},order:{code:'same-order'}}};};
 const r=await scannerStates(f.m);assert.equal(r.devices.length,3);assert.equal(r.devices.filter(d=>d.state).length,2);assert.equal(r.devices[1].error,'offline');
 }finally{await f.cleanup();}});


