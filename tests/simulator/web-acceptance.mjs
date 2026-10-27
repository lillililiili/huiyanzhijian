// Real container/API acceptance. Uses new databases/volumes; no business writes to huiyan_b1.
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');process.chdir(root);
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg');
const env=Object.fromEntries(readFileSync('runtime/b1/local.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const access=JSON.parse(readFileSync('runtime/b1/access.json','utf8')),suffix=Date.now(),database='hy_simweb_'+suffix,backend='simweb-backend-'+suffix,project='simweb-test-'+suffix;
const evidence=resolve('临时文件夹/SIMWEB01',database);mkdirSync(evidence,{recursive:true});
const privateFolder=resolve('runtime/simulator-tests',database);mkdirSync(privateFolder,{recursive:true});const config=resolve(privateFolder,'simulator.env');
const password='SimWeb-Isolated-Test-2026!',url='http://127.0.0.1:4197',apiUrl='http://127.0.0.1:4195';
const owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL});
const results=[];let cookie='',csrf='';
function run(file,args,options={}){const r=spawnSync(file,args,{cwd:root,env:process.env,encoding:'utf8',maxBuffer:16*1024*1024,...options});if(r.status!==0)throw Error(file+' failed: '+String(r.stderr).slice(-1000));return r.stdout;}
const compose=args=>run('docker',['compose','--env-file',config,'-f','tools/simulator/compose.yaml',...args]);
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function request(path,body,headers={}){const r=await fetch(url+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json','X-Sim-CSRF':csrf}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
async function login(){const r=await request('/login',{username:'admin',password});assert.equal(r.status,200);cookie=r.cookie.split(';')[0];csrf=r.body.csrf;}
async function until(fn,label,seconds=25){for(let i=0;i<seconds*5;i++){const value=await fn();if(value)return value;await pause(200);}throw Error('Timed out: '+label);}
async function state(){return (await request('/state')).body;}
async function finished(id){return until(async()=>{const r=(await state()).runs.find(r=>r.id===id);return r&&!['STARTING','RUNNING','STOPPING'].includes(r.job.status)?r:null;},'job '+id,75);}
try{
 await owner.query('CREATE DATABASE '+database);
 const dbEnv={...process.env,...env,DATABASE_URL:env.DATABASE_URL.replace('/huiyan_b1','/'+database),MIGRATION_DATABASE_URL:env.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+database)};
 for(const name of ['migrate','bootstrap'])run(process.execPath,['dist/db/'+name+'.js'],{cwd:resolve('apps/platform'),env:dbEnv});
 run('docker',['run','-d','--name',backend,'--network','huiyan-b1_default','-p','127.0.0.1:4195:4192','-e','DATABASE_URL','-e','CURSOR_SECRET','-e','PORT=4192','-e','BIND_HOST=0.0.0.0','huiyan-backend:b1','node','dist/composition/supervisor.js'],{env:{...dbEnv,DATABASE_URL:dbEnv.DATABASE_URL.replace('127.0.0.1:4193','database:5432')}});
 await until(async()=>{try{return (await fetch(apiUrl+'/api/v1/health/ready')).ok;}catch{return false;}},'backend');
 const tasks=run(process.execPath,['tools/b1-acceptance.mjs','prepare-tasks','SIMWEB-'+suffix],{env:{...process.env,API_URL:apiUrl}}).trim().split(/\r?\n/).map(JSON.parse);
 run(process.execPath,['tools/b1-acceptance.mjs','end-task',tasks.find(t=>t.device_id==='HY-BY-01').task_id],{env:{...process.env,API_URL:apiUrl}});
 writeFileSync(config,`SIM_PROJECT_NAME=${project}\nSIM_API_URL=http://host.docker.internal:4195\nSIM_DEVICE_TOKEN=${access.device_token}\nSIM_WEB_PASSWORD=${password}\nSIM_WEB_PORT=4197\nSIM_BIND_ADDRESS=127.0.0.1\nSIM_ALLOWED_HOSTS=127.0.0.1,localhost\n`,{mode:0o600});
 compose(['up','-d','--wait']);
 assert.equal((await request('/state')).status,401);assert.equal((await request('/login',{username:'admin',password:'incorrect'})).status,401);await login();
 const initial=await state();assert.equal(initial.totals.generated,0);assert.equal(initial.runs.length,0);
 const devices=(await request('/devices')).body;assert.equal(devices.connected,true,JSON.stringify(devices));assert.equal(devices.devices.length,3);results.push('independent-compose/empty/real-upstream');
 const input={request_id:randomUUID(),device_id:'HY-JX-01',scenario:'mixed',count:12,interval_ms:100,seed:0};
 assert.equal((await request('/runs',input,{'X-Sim-CSRF':''})).status,403);assert.equal((await request('/runs',input,{Origin:'https://untrusted.example'})).status,403);
 assert.equal((await request('/runs',{...input,count:0})).status,400);assert.equal((await request('/runs',{...input,device_id:'missing-device'})).status,403);
 assert.equal((await request('/runs',{...input,device_id:'HY-BY-01'})).status,409);assert.equal((await request('/runs/not-a-run')).status,404);results.push('authentication/csrf/origin/invalid-input/no-assignment');
 const started=await request('/runs',input);assert.equal(started.status,202,JSON.stringify(started.body));const id=started.body.run_id;
 assert.equal((await request('/runs',input)).body.id,started.body.id);
 assert.equal((await request('/runs',{...input,count:13})).status,409);
 assert.equal((await request('/runs',{...input,request_id:randomUUID()})).status,409);
 const first=await finished(id);assert.equal(first.generated,12);assert.equal(first.stored,12);assert.equal(first.pending,0);
 assert.equal((await request('/runs/'+id+'/control',{action:'replay'})).status,200);await finished(id);
 const details=(await request('/runs/'+id)).body;assert.ok(details.items.every(r=>r.receipt.receipt_status==='DUPLICATE'));assert.equal(details.items.filter(r=>r.payload.values[0].value===null).length,3);results.push('web-start/duplicate-command/device-exclusion/replay/invalid-null');
 const slow=await request('/runs',{...input,request_id:randomUUID(),count:100,interval_ms:200});assert.equal(slow.status,202);const slowId=slow.body.run_id;
 await until(async()=>{const r=(await state()).runs.find(r=>r.id===slowId);return r?.generated>=3;},'slow samples');
 assert.equal((await request('/runs/'+slowId+'/control',{action:'pause'})).status,200);await pause(600);const paused=(await state()).runs.find(r=>r.id===slowId).generated;await pause(700);assert.equal((await state()).runs.find(r=>r.id===slowId).generated,paused);
 assert.equal((await request('/runs/'+slowId+'/control',{action:'resume'})).status,200);await until(async()=>(await state()).runs.find(r=>r.id===slowId).generated>paused,'resume');
 run('docker',['stop',backend]);await pause(500);
 assert.equal((await request('/runs/'+slowId+'/control',{action:'stop'})).status,200);const stopped=await finished(slowId);assert.ok(stopped.generated<100);assert.ok(stopped.pending>0,'outage leaves unconfirmed samples');
 const generated=(await state()).totals.generated;
 compose(['restart']);await until(async()=>{try{return (await fetch(url+'/health')).ok;}catch{return false;}},'web restart');
 assert.equal((await request('/state')).status,401);await login();assert.equal((await state()).totals.generated,generated);
 assert.equal((await request('/devices')).body.connected,false);assert.equal((await request('/runs',{...input,request_id:randomUUID()})).status,503);await pause(600);assert.equal((await state()).totals.generated,generated);
 results.push('pause/resume/stop/offline-history/restart-no-auto-capture');
 run('docker',['start',backend]);await until(async()=>{try{return (await fetch(apiUrl+'/api/v1/health/ready')).ok;}catch{return false;}},'backend recovery');
 assert.equal((await request('/runs/'+slowId+'/control',{action:'drain'})).status,200);const drained=await finished(slowId);assert.equal(drained.pending,0);assert.equal(drained.generated,stopped.generated);
 const db=new Pool({connectionString:dbEnv.MIGRATION_DATABASE_URL});const count=(await db.query('SELECT count(*)::integer AS n FROM m04.measurement_record')).rows[0].n;assert.equal(count,generated);await db.end();results.push('stopped-run-drain/real-database-reconciliation');
 await request('/logout',{});assert.equal((await request('/state')).status,401);results.push('logout-revocation');
 const untouched=(await owner.query('SELECT count(*)::integer AS n FROM m04.measurement_record')).rows[0].n;assert.equal(untouched,0);
 const fixture={database,backend,project,config,evidence,url,apiUrl,browser_test_password:password,tasks,records:count,results,acceptance_database_records:untouched};
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify(fixture,null,2));writeFileSync(resolve('runtime/simulator-tests/latest.json'),JSON.stringify(fixture,null,2));
 console.log('SIMWEB API PASS; isolated browser fixture left running at '+url+'. Evidence: '+evidence);
}catch(e){writeFileSync(resolve(evidence,'failure.txt'),String(e.stack||e));throw e;}
finally{await owner.end();}
