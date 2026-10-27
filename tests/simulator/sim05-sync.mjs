import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';import {readFileSync,writeFileSync} from 'node:fs';import {createRequire} from 'node:module';import {resolve} from 'node:path';
const root=process.cwd(),fixture=JSON.parse(readFileSync('runtime/sim05/private.json')),access=JSON.parse(readFileSync('runtime/b1/access.json')),prior=JSON.parse(readFileSync('runtime/sim05/three-metric-results.json'));
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg');const owner=new Pool({connectionString:fixture.env.MIGRATION_DATABASE_URL});let ph={},sh={};const results=[];
async function request(base,path,body,h={}){const r=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...h},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json(),cookies:r.headers.getSetCookie()};}
const api='http://127.0.0.1:42893/api/v1',sim='http://127.0.0.1:42894/api';
async function p(path,b,extra={}){const r=await request(api,path,b,{...ph,'Idempotency-Key':randomUUID(),...extra});assert.equal(r.status,200,JSON.stringify(r.data));return r.data.data;}
async function s(path,b,expected=200){const r=await request(sim,path,b,sh);assert.equal(r.status,expected,JSON.stringify(r.data));return r.data;}
async function until(fn){for(let n=0;n<100;n++){const r=await fn();if(r)return r;await new Promise(r=>setTimeout(r,200));}throw Error('wait timed out');}
try{
 let r=await request(api,'/auth/login',{username:'admin',password:access.users.admin});ph={Cookie:r.cookies.map(x=>x.split(';')[0]).join('; '),'X-CSRF-Token':r.data.data.csrf_token};
 r=await request(sim,'/login',{username:'admin',password:'123456'});sh={Cookie:r.cookies.map(x=>x.split(';')[0]).join('; '),'X-Sim-CSRF':r.data.csrf};
 assert.equal((await request(api,'/simulator/catalog')).status,401);assert.equal((await request(api,'/simulator/catalog',undefined,ph)).status,403);assert.equal((await request(sim,'/catalog')).status,401);
 const oa=await p('/work-orders',{external_code:'SIM05-工单A-'+Date.now(),specification_id:prior.specification_id});const ob=await p('/work-orders',{external_code:'SIM05-工单B-'+Date.now(),specification_id:prior.specification_id});
 const a=await p('/spools',{work_order_id:oa.id,spool_code:'SIM05-同名盘'}),b=await p('/spools',{work_order_id:ob.id,spool_code:'SIM05-同名盘'});
 for(let i=0;i<21;i++)await p('/spools',{work_order_id:oa.id,spool_code:'SIM05-分页-'+String(i).padStart(2,'0')});
 let cat=await s('/catalog?q=SIM05&limit=20');assert.equal(cat.total,23);assert.equal(cat.items.length,20);assert.equal((await s('/catalog?q=SIM05&page=2')).items.length,3);assert.equal((await s('/catalog?q=SIM05-同名盘')).total,2);results.push('catalog/source-id/duplicates/pagination');
 const rename=await p('/spools/'+a.id+':edit',{spool_code:'SIM05-主平台改名盘A',canonical_spool_id:null,reason:'同步验收'},{'If-Match':String(a.version)});cat=await s('/catalog?id='+a.id);assert.equal(cat.items[0].spool_code,rename.spool_code);assert.equal(cat.items[0].has_samples,false);
 let t=await p('/tasks',{work_order_id:oa.id,spool_id:a.id,specification_id:prior.specification_id,process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:null,planned_length_m:'4'});t=await p('/tasks/'+t.id+':start',{}, {'If-Match':String(t.version)});
 const j=await p('/tasks',{work_order_id:oa.id,spool_id:a.id,specification_id:prior.specification_id,process_id:'process-jx',device_id:'HY-JX-01',metric_code:'WIRE_GAP',recipe_version_id:null,planned_length_m:'4'});
 cat=await s('/catalog?id='+a.id);assert.equal(cat.items[0].tasks.length,2);const d=cat.devices.find(x=>x.id==='HY-DG-01');
 const cable=await s('/catalog/cables',{source_id:a.id,version:0,data:{...prior.cable.data,name:'不会复制这个名字',length_m:'4',defects:[prior.cable.data.defects[0]]},reason:'同步预设'});assert.equal(cable.id,a.id);assert.equal(cable.data.material_ref,'platform:'+a.id);assert.equal(cable.data.name,rename.spool_code);
 const detector=await s('/catalog/detectors',{source_id:d.id,version:0,data:{name:'错误身份',device_id:'OTHER',metric:'WIRE_GAP',step_m:'0.5',speed_m_min:'600',lower:'10',upper:''},reason:'检测参数'});assert.equal(detector.id,d.model_id);assert.equal(detector.data.device_id,d.id);assert.equal(detector.data.metric,'SHIELD_OVERLAP_RATE');
 await s('/catalog/cables',{source_id:randomUUID(),version:0,data:cable.data,reason:'无效ID'},404);
 assert.equal((await request(sim,'/catalog/cables',{source_id:a.id,version:1,data:cable.data,reason:'CSRF'},{Cookie:sh.Cookie})).status,403);
 await s('/models/cables',{id:a.id,version:1,data:{...cable.data,material_ref:'disconnect'},reason:'移除关联'},409);results.push('rename/versioned-presets/immutable-id/csrf/unknown-id');
 const input={request_id:randomUUID(),cable_id:cable.id,cable_version:1,detector_id:detector.id,detector_version:1,mode:'BOUND',task_id:t.id,spool_id:a.id};
 await s('/passes',{...input,request_id:randomUUID(),spool_id:b.id},409);await s('/passes',{...input,request_id:randomUUID(),task_id:j.id},409);await s('/passes',{...input,request_id:randomUUID(),task_id:''},409);
 const run=await s('/passes',input,202);await until(async()=>{const v=await s('/state');const x=v.runs.find(x=>x.id===run.run_id);return x?.generated===8&&x?.stored===8&&!['RUNNING','STARTING'].includes(x.job?.status);});
 cat=await s('/catalog?id='+a.id);assert.equal(cat.items[0].has_samples,true);assert.equal((await s('/catalog?status=tested&q=SIM05')).total,1);const summary=await p('/spool-summaries/'+a.id);assert.equal(summary.measurements.find(x=>x.task_id===t.id).total,8);
 const stored=(await owner.query('SELECT task_id,raw_payload FROM m04.measurement_record WHERE task_id=$1 ORDER BY ingest_order',[t.id])).rows;assert.equal(stored.length,8);assert(stored.every(x=>x.raw_payload.task_id===t.id));assert(stored.every(x=>!JSON.stringify(x.raw_payload).includes('搭盖不足')));results.push('exact-task-spool-device/8-points/PG-and-catalog-synchronized');
 // Scope credentials exist only in this isolated DB; no shared credentials are changed.
 for(const [id,env,factory,devices] of [['sim05-narrow','SIMULATED','factory-local',['HY-JX-01']],['sim05-real','REAL','factory-local',['HY-DG-01']],['sim05-empty','SIMULATED','factory-other',['HY-DG-01']]]){
  const token=randomUUID();await owner.query("INSERT INTO m00.access_credential(id,token_hash,factory_id,device_ids,data_environment,scopes,expires_at) VALUES($1,$2,$3,$4,$5,ARRAY['device:ingest'],now()+interval '1 hour')",[id,createHash('sha256').update(token).digest('hex'),factory,devices,env]);
  const response=await request(api,'/simulator/catalog?id='+a.id,undefined,{Authorization:'Bearer '+token});if(env==='REAL')assert.equal(response.status,403);else if(factory!=='factory-local')assert.equal(response.status,404);else{assert.equal(response.data.data.items[0].tasks.length,1);assert.equal(response.data.data.items[0].tasks[0].id,j.id);assert.equal(response.data.data.items[0].has_samples,false);assert.equal(response.data.data.devices.length,1);}
 }
 results.push('factory/device/environment-scopes');
 await p('/tasks/'+t.id+':end',{reason:'SIM05验收结束'},{'If-Match':String(t.version)});
 // Leave a new pending line and task for actual browser operation.
 const ui=await p('/spools',{work_order_id:oa.id,spool_code:'SIM05-浏览器同步验收'});const uiTask=await p('/tasks',{work_order_id:oa.id,spool_id:ui.id,specification_id:prior.specification_id,process_id:'process-dg',device_id:'HY-DG-01',metric_code:'SHIELD_OVERLAP_RATE',recipe_version_id:null,planned_length_m:'4'});
 writeFileSync('runtime/sim05/sync-results.json',JSON.stringify({results,records:8,spool:a,task:t,ui,uiTask,order:oa,database:fixture.name},null,2));console.log(JSON.stringify({passed:results.length,records:8,browser_spool:ui.spool_code}));
}finally{await owner.end();}
