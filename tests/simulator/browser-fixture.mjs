import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');process.chdir(root);
const fixture=JSON.parse(readFileSync('runtime/simulator-tests/latest.json','utf8'));
assert.match(fixture.database,/^hy_simweb_\d+$/);assert.match(fixture.backend,/^simweb-backend-\d+$/);assert.match(fixture.project,/^simweb-test-\d+$/);
const action=process.argv[2]||'verify';
if(action==='stop'){
 for(const args of [['compose','--env-file',fixture.config,'-f','tools/simulator/compose.yaml','stop'],['stop',fixture.backend]]){const r=spawnSync('docker',args,{stdio:'inherit'});assert.equal(r.status,0);}process.exit(0);
}
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg');
const settings=Object.fromEntries(readFileSync('runtime/b1/local.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const db=new Pool({connectionString:settings.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+fixture.database)});
const access=JSON.parse(readFileSync('runtime/b1/access.json','utf8'));
let cookie='',csrf='';
async function request(path,body,headers={}){const r=await fetch(fixture.apiUrl+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{'Content-Type':'application/json','X-CSRF-Token':csrf,'Idempotency-Key':randomUUID()}),...headers},body:body===undefined?undefined:JSON.stringify(body)});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return {data:b.data,response:r};}
try{
 if(action==='prepare'){
  // A second same-metric device exists only in this explicitly isolated test database.
  await db.query("INSERT INTO m01.device SELECT 'HY-DG-02',factory_id,line_id,process_id,'HY-DG-02','同指标第二台验收设备',metric_code,model,enabled,data_environment,capability_version,raw_schema_versions,source_identification,source_metadata,created_at,version FROM m01.device WHERE id='HY-DG-01' ON CONFLICT DO NOTHING");
  await db.query("UPDATE m00.access_credential SET device_ids=array_append(device_ids,'HY-DG-02') WHERE id='b1-simulator' AND NOT ('HY-DG-02'=ANY(device_ids))");
  const auth=await request('/auth/login',{username:'admin',password:access.users.admin});cookie=auth.response.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');csrf=auth.data.csrf_token;
  for(const [sourceId,target] of [['HY-BY-01','HY-BY-01'],['HY-DG-01','HY-DG-02']]){
   const source=(await request('/tasks/'+fixture.tasks.find(t=>t.device_id===sourceId).task_id)).data;
   const body=Object.fromEntries(['work_order_id','spool_id','specification_id','process_id','device_id','metric_code','recipe_version_id','planned_length_m'].map(k=>[k,source[k]]));body.device_id=target;
   const created=(await request('/tasks',body)).data;await request('/tasks/'+created.id+':start',{}, {'If-Match':created.version});console.log(JSON.stringify({device_id:target,task_id:created.id}));
  }await request('/auth/logout',{});
 }else{
  const byDevice=(await db.query("SELECT r.device_id,count(*)::integer AS records,count(*) FILTER(WHERE v.value IS NULL)::integer AS invalid FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id GROUP BY r.device_id ORDER BY r.device_id")).rows;
  const browserRuns=(await db.query("SELECT split_part(source_record_key,'-',1) AS source,count(*)::integer AS records FROM m04.measurement_record GROUP BY 1")).rows;
  const audit=(await db.query("SELECT count(*)::integer AS count FROM m00.audit_event")).rows[0];
  writeFileSync(resolve(fixture.evidence,'browser-database.json'),JSON.stringify({at:new Date().toISOString(),byDevice,browserRuns,audit},null,2));console.log(JSON.stringify({byDevice,browserRuns},null,2));
 }
}finally{await db.end();}
