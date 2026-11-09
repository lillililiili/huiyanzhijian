const fs=require('fs'),{Pool}=require('../apps/platform/node_modules/pg'),{randomUUID:uid}=require('crypto'),assert=require('assert/strict'),cp=require('child_process');
const env=JSON.parse(fs.readFileSync('runtime/perf03/test-env.json')),templates=JSON.parse(fs.readFileSync('runtime/perf03/templates.json','utf8').replace(/^\uFEFF/,'')),access=JSON.parse(fs.readFileSync('runtime/b1/access.json'));
if(new URL(env.DATABASE_URL).hostname!=='127.0.0.1'||new URL(env.DATABASE_URL).port!=='45293')throw Error('PERF03 requires isolated PG port 45293');
const p=new Pool({connectionString:env.DATABASE_URL}),base='http://127.0.0.1:45300/api/v1';let cookie='',csrf='';const result={started:new Date().toISOString(),requests:[],resources:[],expected:0};
async function req(route,b,device=false,key=uid()){const start=performance.now();const r=await fetch(base+route,{method:b===undefined?'GET':'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key,...(device?{Authorization:'Bearer '+access.device_token,'X-Huiyan-Edge-Token':env.OVALITY_EDGE_TOKEN}:{Cookie:cookie,'X-CSRF-Token':csrf})},body:b===undefined?undefined:JSON.stringify(b),signal:AbortSignal.timeout(120000)});const j=await r.json();result.requests.push({route,status:r.status,ms:Math.round(performance.now()-start)});assert.equal(r.status,200,JSON.stringify(j));return {data:j.data,headers:r.headers};}
(async()=>{
result.baselineSource=Number((await p.query('select count(*) n from m04.measurement_record where derived_from_record_id is null')).rows[0].n);
const login=await req('/auth/login',{username:'admin',password:access.users.admin});cookie=login.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');csrf=login.data.csrf_token;
// Restore only the source connection identities needed by replay; all writes are in isolated DB.

const order=(await p.query('select work_order_id from m02.inspection_task where id=$1',[templates[0].task_id])).rows[0].work_order_id;
let seq=Date.now();const saved=[];
const deadline=Date.now()+180000;
const writer=(async()=>{while(Date.now()<deadline){await Promise.all(templates.map(async template=>{const records=Array.from({length:20},()=>{const r=structuredClone(template);r.record_id='perf03-'+uid();r.capture_sequence=String(++seq);return r});const b={schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records};const response=await req('/measurements:ingest',b,true);assert.equal(response.data.counts.stored,20,JSON.stringify(response.data));result.expected+=20;saved.push(...records);}));await new Promise(r=>setTimeout(r,1000));}})();
const reader=(async()=>{while(Date.now()<deadline){await req('/measurements?task_id='+templates[0].task_id+'&limit=25');await req('/production/tasks?limit=25');await new Promise(r=>setTimeout(r,2000));}})();
const reports=(async()=>{await new Promise(r=>setTimeout(r,5000));while(Date.now()<deadline){await req('/reporting/reports:generate',{kind:'WORK_ORDER',order_id:order,environment:'SIMULATED'});await new Promise(r=>setTimeout(r,10000));}})();
const resources=(async()=>{while(Date.now()<deadline){const sizes=(await p.query("select pg_database_size(current_database()) bytes,(select count(*) from m04.measurement_record) records")).rows[0];const stats=cp.execFileSync('docker',['stats','--no-stream','--format','{{json .}}','huiyan-perf03-pg','huiyan-perf03-ts'],{encoding:'utf8'}).trim().split('\n').map(JSON.parse);result.resources.push({at:new Date().toISOString(),...sizes,containers:stats});await new Promise(r=>setTimeout(r,5000));}})();
await Promise.all([writer,reader,reports,resources]);
const retry={schema_version:'1.0',batch_id:uid(),sent_at:new Date().toISOString(),records:saved.slice(0,20)};assert.equal((await req('/measurements:ingest',retry,true)).data.counts.duplicate,20);
result.counts=(await p.query('select v.metric_code,count(*)::int n from m04.measurement_record r join m04.measurement_value v on v.record_id=r.id group by 1')).rows;
assert.equal(result.counts.filter(x=>x.metric_code!=='SHEATH_THICKNESS').reduce((s,x)=>s+x.n,0)-result.baselineSource,result.expected);
assert.equal(result.counts.find(x=>x.metric_code==='OVALITY').n,result.counts.find(x=>x.metric_code==='SHEATH_THICKNESS').n);
result.projectionMissing=(await p.query('select count(*)::int n from m04.measurement_record r left join m04.measurement_projection p on p.record_id=r.id where p.record_id is null')).rows[0].n;assert.equal(result.projectionMissing,0);result.completed=new Date().toISOString();console.log(JSON.stringify({expected:result.expected,counts:result.counts,requests:result.requests.length}));
})().catch(e=>{result.failure=e.message;console.error(e.message);process.exitCode=1}).finally(async()=>{fs.writeFileSync('runtime/perf03/load-result.json',JSON.stringify(result,null,2));await p.end()});




