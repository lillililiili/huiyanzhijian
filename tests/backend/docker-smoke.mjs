// Isolated container acceptance. Leaves evidence and databases; never alters the acceptance database.
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');process.chdir(root);
const require=createRequire(resolve(root,'apps/platform/package.json')),{Pool}=require('pg');
const settings=Object.fromEntries(readFileSync('runtime/b1/local.env','utf8').trim().split(/\r?\n/).map(l=>{const p=l.indexOf('=');return [l.slice(0,p),l.slice(p+1)];}));
const access=JSON.parse(readFileSync('runtime/b1/access.json','utf8')),suffix=Date.now(),database='hy_b1_container_'+suffix,restored=database+'_restore',name='huiyan-b1-proof-'+suffix,volume=name+'-queue',evidence=resolve(root,'临时文件夹/第一阶段_B1后端模拟器',database);
mkdirSync(evidence,{recursive:true});const db=new Pool({connectionString:settings.MIGRATION_DATABASE_URL});
function execute(file,args,options={}){const r=spawnSync(file,args,{cwd:root,env:process.env,encoding:'utf8',maxBuffer:32*1024*1024,...options});if(r.status!==0)throw Error(file+' failed: '+String(r.stderr).slice(-2000));return r.stdout;}
const env={...process.env,...settings,DATABASE_URL:settings.DATABASE_URL.replace('/huiyan_b1','/'+database),MIGRATION_DATABASE_URL:settings.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+database)};
let started=false;
try{
 await db.query('CREATE DATABASE '+database);
 for(const script of ['migrate','bootstrap'])execute(process.execPath,['dist/db/'+script+'.js'],{cwd:resolve(root,'apps/platform'),env});
 execute('docker',['run','-d','--name',name,'--network','huiyan-b1_default','-p','127.0.0.1:4195:4192','-e','DATABASE_URL','-e','CURSOR_SECRET','-e','PORT=4192','-e','BIND_HOST=0.0.0.0','huiyan-backend:b1','node','dist/composition/supervisor.js'],{env:{...env,DATABASE_URL:env.DATABASE_URL.replace('127.0.0.1:4193','database:5432')}});started=true;
 let ready=false;for(let i=0;i<50;i++){try{if((await fetch('http://127.0.0.1:4195/api/v1/health/ready')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}assert.ok(ready,'Isolated container API must become ready before writing fixtures');
 writeFileSync(resolve(evidence,'tasks.jsonl'),execute(process.execPath,['tools/b1-acceptance.mjs','prepare-tasks','CONTAINER-'+suffix],{env:{...process.env,API_URL:'http://127.0.0.1:4195'}}));
 for(const [i,device] of ['HY-DG-01','HY-JX-01','HY-BY-01'].entries()){
  const args=['run','--rm','--network','huiyan-b1_default','--mount','type=volume,source='+volume+',target=/data','-e','DEVICE_TOKEN','-e','API_URL=http://'+name+':4192','-e','SIM_DB=/data/queue.sqlite','huiyan-simulator:b1','node','dist/cli.js','run','--device',device,'--run','container-'+i,'--count','4','--interval-ms','50','--scenario','mixed'];
  writeFileSync(resolve(evidence,'simulator-'+i+'.log'),execute('docker',args,{env:{...process.env,DEVICE_TOKEN:access.device_token}}));
 }
 const summary=JSON.parse(execute(process.execPath,['tools/b1-acceptance.mjs','summary'],{env:{...process.env,API_URL:'http://127.0.0.1:4195'}}));assert.equal(summary.total,12);for(const group of Object.values(summary.groups)){assert.equal(group.total,4);assert.equal(group.pass,2);assert.equal(group.fail,1);assert.equal(group.not_evaluated,1);}writeFileSync(resolve(evidence,'acceptance-summary.json'),JSON.stringify(summary,null,2));
 const inspect=new Pool({connectionString:env.MIGRATION_DATABASE_URL});
 const fingerprint="SELECT count(*)::text AS records,md5(string_agg(payload_hash,'' ORDER BY ingest_order)) AS hashes FROM m04.measurement_record";
 const original=(await inspect.query(fingerprint)).rows[0];assert.equal(original.records,'12');
 const groups=(await inspect.query("SELECT v.metric_code,count(*)::text AS total,count(*) FILTER(WHERE v.value IS NULL)::text AS invalid,count(*) FILTER(WHERE e.quality_result='FAIL')::text AS failed FROM m04.measurement_value v JOIN m04.measurement_evaluation e USING(record_id) GROUP BY v.metric_code")).rows;
 for(const r of groups){assert.equal(r.total,'4');assert.equal(r.invalid,'1');assert.equal(r.failed,'1');}await inspect.end();
 const dump=execute('docker',['exec','huiyan-b1-database-1','pg_dump','-U','hy_migrator','-d',database,'-Fc'],{encoding:null});writeFileSync(resolve(evidence,'database.dump'),dump);
 await db.query('CREATE DATABASE '+restored);
 execute('docker',['exec','-i','huiyan-b1-database-1','pg_restore','-U','hy_migrator','-d',restored,'--exit-on-error'],{input:dump});
 const restoreDb=new Pool({connectionString:settings.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+restored)});assert.deepEqual((await restoreDb.query(fingerprint)).rows[0],original);assert.equal((await restoreDb.query('SELECT count(*)::text AS n FROM public.hy_schema_migration')).rows[0].n,'2');await restoreDb.end();
 const untouched=(await db.query('SELECT count(*)::text AS n FROM m04.measurement_record')).rows[0].n;assert.equal(untouched,'0');
 writeFileSync(resolve(evidence,'result.json'),JSON.stringify({database,restored,simulator_volume:volume,container_pipeline:'PASS',groups,backup_restore:'PASS',fingerprint:original,acceptance_database_measurements:untouched,frontend:'not tested',hardware:'not tested',mes:'not tested'},null,2));console.log('Container pipeline and backup/restore PASS. Evidence: '+evidence);
}finally{
 if(started){const logs=spawnSync('docker',['logs',name],{encoding:'utf8'});writeFileSync(resolve(evidence,'backend.log'),logs.stdout+logs.stderr);execute('docker',['stop',name]);}
 await db.end();
}
