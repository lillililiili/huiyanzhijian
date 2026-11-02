// HWREADY01: bounded read-only HTTP/DB observation; never emits credentials.
const fs=require('node:fs'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..'),out=path.join(root,'临时文件夹/HWREADY01_真机联调准备度');
const {Pool}=createRequire(path.join(root,'apps/platform/package.json'))('pg');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const access=JSON.parse(fs.readFileSync(path.join(root,'runtime/b1/access.json'),'utf8'));
async function main(){
 fs.mkdirSync(out,{recursive:true});const db=new Pool({connectionString:env.DATABASE_URL,max:1});
 const login=await fetch('http://127.0.0.1:4192/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:access.users.admin})});
 if(!login.ok)throw Error('Audit login failed');const cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const data={at:new Date().toISOString(),mode:'bounded read-only requests; login creates one audit/session record',db:{},http:[]};
 try {
 data.db.counts=(await db.query('SELECT v.metric_code,r.data_environment,count(*)::int AS n FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id GROUP BY 1,2')).rows;
 data.db.integrity=(await db.query('SELECT count(*)::int AS records,count(p.record_id)::int AS projected FROM m04.measurement_record r LEFT JOIN m04.measurement_projection p ON p.record_id=r.id')).rows;
 data.db.tasks=(await db.query('SELECT count(*)::int AS n FROM m02.inspection_task')).rows;
 data.db.size=(await db.query('SELECT pg_database_size(current_database())::text AS bytes')).rows;
 data.db.indices=(await db.query("SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='m04' AND tablename='measurement_record'")).rows;
 const task=(await db.query("SELECT task_id,count(*) n FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id WHERE v.metric_code='OVALITY' AND task_id IS NOT NULL GROUP BY task_id ORDER BY n DESC LIMIT 1")).rows[0];
 data.db.selected_task=task;
 const routes=['/production/tasks?limit=25','/measurements?task_id='+encodeURIComponent(task.task_id)+'&limit=25&order=desc'];
 for(const route of routes)for(const concurrency of [1,5,10]){
   const results=await Promise.all(Array.from({length:concurrency},async()=>{const start=performance.now();try{const r=await fetch('http://127.0.0.1:4192/api/v1'+route,{headers:{Cookie:cookie},signal:AbortSignal.timeout(20000)}),text=await r.text();let b;try{b=JSON.parse(text)}catch{}return {ms:Math.round(performance.now()-start),status:r.status,bytes:Buffer.byteLength(text),code:b?.code,rows:b?.data?.items?.length};}catch(e){return {ms:Math.round(performance.now()-start),status:0,code:e.name};}}));
   data.http.push({route,concurrency,results});
 }
 }finally{await db.end()}
 fs.writeFileSync(path.join(out,'read-only-observation.json'),JSON.stringify(data,null,2));console.log(JSON.stringify(data,null,2));
}
main().catch(e=>{console.error('Audit failed:',e.name);process.exitCode=1});
