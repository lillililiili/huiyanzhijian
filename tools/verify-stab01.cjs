// Isolated fault injection. Never point the database at the shared huiyan_b1 DB.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),http=require('node:http');
const assert=require('node:assert/strict'),{spawn,spawnSync}=require('node:child_process'),{randomUUID}=require('node:crypto');
const source=path.resolve(__dirname,'..'),root=path.resolve(process.env.STAB01_RUNTIME_ROOT||source);
const {Pool}=require(path.join(source,'apps/platform/node_modules/pg'));
const {DatabaseSync}=require('node:sqlite');
const dbName=process.env.STAB01_DATABASE;
if(!dbName||!/^db01_empty_[0-9]+$/.test(dbName))throw Error('Explicit isolated DB01 empty database required');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(s=>{const n=s.indexOf('=');return[s.slice(0,n),s.slice(n+1)];}));
const access=JSON.parse(fs.readFileSync(path.join(root,'runtime/b1/access.json'),'utf8'));
const out=path.join(root,'临时文件夹/STAB01_稳定性与断联恢复');fs.mkdirSync(out,{recursive:true});
const queueFile=path.join(out,'queue-'+Date.now()+'.sqlite'),runId='stab01-'+Date.now();
const dbUrl=new URL(env.DATABASE_URL);dbUrl.pathname='/'+dbName;const direct=dbUrl.toString();dbUrl.port='4235';
const ownerUrl=new URL(env.MIGRATION_DATABASE_URL);ownerUrl.pathname='/'+dbName;
const apiEnv={...process.env,DATABASE_URL:dbUrl.toString(),CURSOR_SECRET:env.CURSOR_SECRET,PORT:'4234',BIND_HOST:'127.0.0.1',CONTRACT_ROOT:path.join(source,'contracts'),EDGE_SYNC_TARGETS_FILE:'',OVALITY_INFLUX_URL:'http://127.0.0.1:4237',OVALITY_INFLUX_ORG:'huiyan-center',OVALITY_INFLUX_BUCKET:'ovality-samples',OVALITY_INFLUX_TOKEN_FILE:path.join(root,'runtime/ts01/secrets/runtime.token')};
const report={started:new Date().toISOString(),dbName,runId,cases:[],queries:[]};let api,sim,sql,blocked=false,apiLogs='',simLogs='',cookie='',csrf='';
const children=[];const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,ms=20000){const end=Date.now()+ms;while(Date.now()<end){if(await fn())return;await wait(100);}throw Error('Condition timeout');}
function tcp(port,target){let enabled=true;const sockets=new Set();const server=net.createServer(a=>{if(!enabled){a.destroy();return;}const b=net.connect(target,'127.0.0.1');for(const s of[a,b]){sockets.add(s);s.on('error',()=>{});s.on('close',()=>sockets.delete(s));}a.pipe(b);b.pipe(a);a.on('close',()=>b.destroy());b.on('close',()=>a.destroy());});return {server,start:()=>new Promise((r,j)=>{server.once('error',j);server.listen(port,'127.0.0.1',r);}),set(v){enabled=v;if(!v)for(const s of sockets)s.destroy();},close(){for(const s of sockets)s.destroy();server.close();}};}
const pgProxy=tcp(4235,4193),tsProxy=tcp(4237,4206);
const gateway=http.createServer((req,res)=>{if(blocked){req.socket.destroy();return;}const f=http.request({hostname:'127.0.0.1',port:4234,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});f.on('error',()=>{res.statusCode=503;res.end();});req.pipe(f);});
async function request(route,body,device=false,key){const start=performance.now(),r=await fetch('http://127.0.0.1:4234/api/v1'+route,{method:body===undefined?'GET':'POST',headers:{...(device?{Authorization:'Bearer '+access.device_token}:{Cookie:cookie,'X-CSRF-Token':csrf}),'Content-Type':'application/json',...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});return {status:r.status,body:await r.json(),headers:r.headers,ms:Math.round(performance.now()-start)};}
async function command(route,b){const r=await request(route,b,false,randomUUID());assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;}
function child(file,args,options,append){const p=spawn(process.execPath,[file,...args],{...options,stdio:['ignore','pipe','pipe']});children.push(p);p.stdout.on('data',d=>append(d.toString()));p.stderr.on('data',d=>append(d.toString()));p.done=new Promise(r=>p.on('exit',code=>r(code)));return p;}
async function kill(p){if(p&&p.exitCode===null){p.kill();await p.done;}}
function startSim(){sim=child(path.join(root,'runtime/stab01/simulator/dist/cli.js'),['run','--run',runId,'--device','HY-JX-01','--count','600','--interval-ms','20','--scenario','mixed','--drain-seconds','90'],{cwd:root,env:{...process.env,API_URL:'http://127.0.0.1:4236',DEVICE_TOKEN:access.device_token,CONTRACT_ROOT:path.join(source,'contracts'),SIM_DB:queueFile,SIM_PRODUCER_OWNER:runId}},s=>simLogs+=s);return sim;}
function counts(){if(!fs.existsSync(queueFile))return{n:0,pending:0};const q=new DatabaseSync(queueFile,{readOnly:true});try{return q.prepare("SELECT count(*) n,count(*) FILTER(WHERE state IN('PENDING','UNKNOWN')) pending FROM sample").get();}finally{q.close();}}
async function main(){
 const owner=new Pool({connectionString:ownerUrl.toString(),max:1});
 assert.equal((await owner.query('SELECT count(*)::int n FROM m04.measurement_record')).rows[0].n,0,'Use a fresh empty isolated DB');await owner.end();
 const seed=spawnSync(process.execPath,['dist/db/bootstrap.js'],{cwd:path.join(source,'apps/platform'),env:{...process.env,MIGRATION_DATABASE_URL:ownerUrl.toString(),ACCESS_FILE:path.join(root,'runtime/b1/access.json')},encoding:'utf8'});assert.equal(seed.status,0,seed.stderr);
 await pgProxy.start();await tsProxy.start();await new Promise((r,j)=>{gateway.once('error',j);gateway.listen(4236,'127.0.0.1',r);});
 api=child('dist/composition/main.js',[],{cwd:path.join(source,'apps/platform'),env:apiEnv},s=>apiLogs+=s);
 await until(()=>apiLogs.includes('API_READY'));
 const login=await request('/auth/login',{username:'admin',password:access.users.admin});assert.equal(login.status,200);cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');csrf=login.body.data.csrf_token;
 const wo=await command('/work-orders',{external_code:runId,specification_id:'SP110-800'});
 const spool=await command('/spools',{work_order_id:wo.id,spool_code:runId});
 const task=await command('/tasks',{work_order_id:wo.id,spool_id:spool.id,specification_id:'SP110-800',process_id:'process-jx',device_id:'HY-JX-01',metric_code:'WIRE_GAP',recipe_version_id:'JX-V1.0',planned_length_m:'1000'});
 const start=await fetch('http://127.0.0.1:4234/api/v1/tasks/'+task.id+':start',{method:'POST',headers:{Cookie:cookie,'X-CSRF-Token':csrf,'Idempotency-Key':randomUUID(),'If-Match':'1','Content-Type':'application/json'},body:'{}'});assert.equal(start.status,200,await start.text());
 startSim();await until(()=>counts().n>=100);
 const load=(async()=>{for(let wave=0;wave<12;wave++){const rs=await Promise.all(Array.from({length:10},(_,i)=>request(i%2?'/production/tasks?limit=25':'/measurements?task_id='+task.id+'&limit=25')));report.queries.push(...rs.map(r=>({status:r.status,ms:r.ms})));assert.ok(rs.every(r=>r.status===200));await wait(400);}})();
 blocked=true;await until(()=>counts().n>=250);await kill(sim);
 report.queuedAtDisconnect=counts();assert.ok(report.queuedAtDisconnect.pending>0);report.cases.push('HTTP断开后SQLite保留积压');
 blocked=false;startSim();await load;const exit=await sim.done;assert.equal(exit,0,simLogs.slice(-1500));assert.deepEqual({...counts()},{n:600,pending:0});report.cases.push('模拟器重启同run继续采集并排空');
 sql=new Pool({connectionString:direct,max:1});
 const q=new DatabaseSync(queueFile,{readOnly:true});let saved;try{saved=q.prepare('SELECT record_id,payload,state FROM sample ORDER BY sequence').all();}finally{q.close();}
 const rows=(await sql.query('SELECT r.raw_payload,v.value::text,e.quality_result FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id WHERE r.task_id=$1',[task.id])).rows;
 assert.equal(rows.length,600);const byId=new Map(rows.map(r=>[r.raw_payload.record_id,r]));assert.equal(byId.size,600);
 for(const s of saved){const p=JSON.parse(s.payload),r=byId.get(s.record_id);assert.ok(r);assert.deepEqual(r.raw_payload,p);assert.equal(s.state,'STORED');}
 const stats=(await sql.query('SELECT total,valid,failed FROM m04.task_statistics WHERE task_id=$1',[task.id])).rows[0];assert.equal(Number(stats.total),600);report.statistics=stats;report.cases.push('600条PG原文身份逐条与SQLite一致，汇总不重复');
 const retry=await request('/measurements:ingest',{schema_version:'1.0',batch_id:'stab01-retry-'+randomUUID(),sent_at:new Date().toISOString(),records:[JSON.parse(saved[0].payload)]},true);assert.equal(retry.status,200);assert.equal(retry.body.data.counts.duplicate,1);report.cases.push('断联后同源重试不重复计数');
 const pid=api.pid;pgProxy.set(false);const unavailable=await request('/production/tasks?limit=25');assert.equal(unavailable.status,503);assert.equal((await request('/health/live')).status,200);pgProxy.set(true);const recovered=Date.now();await until(async()=>{try{return(await request('/production/tasks?limit=25')).status===200;}catch{return false;}},15000);assert.equal(api.pid,pid);assert.equal(api.exitCode,null);report.pgRecoveryMs=Date.now()-recovered;report.cases.push('PG断联明确503，原进程自动恢复查询');
 const resumed=await request('/measurements:ingest',{schema_version:'1.0',batch_id:'stab01-recovered-'+randomUUID(),sent_at:new Date().toISOString(),records:[JSON.parse(saved[1].payload)]},true);assert.equal(resumed.status,200);assert.equal(resumed.body.data.counts.duplicate,1);report.cases.push('PG恢复后写接口恢复、未形成重复事实');
 Object.assign(process.env,apiEnv);const {ovalityTimeseries}=require(path.join(source,'apps/platform/dist/modules/m04-measurements/timeseries'));
 const historyUrl=new URL(env.DATABASE_URL);historyUrl.pathname='/db01_restore_20261102';const history=new Pool({connectionString:historyUrl.toString(),max:1});let ref;try{ref=(await history.query("SELECT factory_id,raw_payload FROM m04.measurement_record WHERE raw_payload->>'storage'='INFLUXDB' LIMIT 1")).rows[0];}finally{await history.end();}assert.ok(ref);
 const original=await ovalityTimeseries.read(ref.factory_id,[ref.raw_payload]);tsProxy.set(false);await assert.rejects(()=>ovalityTimeseries.read(ref.factory_id,[ref.raw_payload]),e=>e.code==='TIMESERIES_UNAVAILABLE');tsProxy.set(true);const again=await ovalityTimeseries.read(ref.factory_id,[ref.raw_payload]);assert.deepEqual(again,original);report.cases.push('中心时序连接断开明确报错、恢复后原值一致');
 report.cases.push('120次混合并发查询全部200');report.completed=new Date().toISOString();
 console.log(JSON.stringify({passed:report.cases.length,cases:report.cases,counts:counts(),queries:report.queries.length,pgRecoveryMs:report.pgRecoveryMs}));
}
main().catch(e=>{report.failure={name:e.name,message:e.message,code:e.code};console.error(e.name,e.message);process.exitCode=1;}).finally(async()=>{for(const p of children)await kill(p);if(sql)await sql.end();pgProxy.close();tsProxy.close();gateway.closeAllConnections();gateway.close();fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(out,'api.log'),apiLogs);fs.writeFileSync(path.join(out,'simulator.log'),simLogs);});
