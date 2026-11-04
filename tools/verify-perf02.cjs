// Bounded read-only HTTP load. Login writes a session/audit, never business samples.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),{createRequire}=require('node:module');
const source=path.resolve(__dirname,'..'),root=path.resolve(process.env.PERF02_RUNTIME_ROOT||source);
const {Pool}=createRequire(path.join(source,'apps/platform/package.json'))('pg');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
const base=process.env.PERF02_API||'http://127.0.0.1:4192',label=process.argv[2]||'baseline',rounds=Number(process.env.PERF02_ROUNDS||1),levels=(process.env.PERF02_LEVELS||'1,5,10').split(',').map(Number);
if(!/^[a-z0-9-]+$/.test(label)||!['127.0.0.1','localhost'].includes(new URL(base).hostname)||rounds<1||rounds>3||levels.some(n=>![1,5,10,20].includes(n)))throw Error('Bounded local audit only');
const out=path.join(root,'临时文件夹/PERF02_低并发查询修复');fs.mkdirSync(out,{recursive:true});
const digest=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
async function main(){
 const db=new Pool({connectionString:env.DATABASE_URL,max:1});let cookie;
 const data={at:new Date().toISOString(),base,label,rounds,levels,db:{},requests:[]};
 try{
  data.db.counts=(await db.query('SELECT count(*)::int n FROM m04.measurement_record')).rows;
  const selected=(await db.query("SELECT r.factory_id,r.task_id,count(*)::int n FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id WHERE v.metric_code='OVALITY' AND r.task_id IS NOT NULL GROUP BY 1,2 ORDER BY n DESC LIMIT 1")).rows[0];data.db.selected=selected;
  const sql=fs.readFileSync(path.join(source,'apps/platform/modules/m04-measurements/api.ts'),'utf8').split('async taskActivity(')[1].match(/db.query\(`([\s\S]*?)`,\[actor.factory,ids\]/)[1];
  const ids=(await db.query('SELECT id FROM m02.inspection_task WHERE factory_id=$1',[selected.factory_id])).rows.map(x=>x.id);
  data.plan=(await db.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql,[selected.factory_id,ids])).rows[0]['QUERY PLAN'];
  const login=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:JSON.parse(fs.readFileSync(path.join(root,'runtime/b1/access.json'),'utf8')).users.admin})});
  if(!login.ok)throw Error('Login failed: '+login.status);cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
  const routes=['/production/tasks?limit=25','/measurements?task_id='+encodeURIComponent(selected.task_id)+'&limit=25&order=desc'];
  for(let round=1;round<=rounds;round++)for(const route of routes)for(const concurrency of levels){
   const results=await Promise.all(Array.from({length:concurrency},async()=>{const start=performance.now();try{
    const r=await fetch(base+'/api/v1'+route,{headers:{Cookie:cookie},signal:AbortSignal.timeout(20000)}),text=await r.text(),body=JSON.parse(text),items=body.data?.items;
    return {status:r.status,ms:Math.round(performance.now()-start),bytes:Buffer.byteLength(text),code:body.code,rows:items?.length,total:body.data?.total,
     content_hash:items?digest(items.map(x=>route.startsWith('/measurements')?{id:x.id,value:x.value,raw:x.raw_payload,quality:x.quality_result,received:x.received_at}:{id:x.id,measurements:x.measurements,record:x.activity?.latest})):undefined};
   }catch(e){return {status:0,ms:Math.round(performance.now()-start),code:e.name};}}));
   data.requests.push({round,route,concurrency,results});
   console.log(JSON.stringify({round,route:route.split('?')[0],concurrency,ok:results.filter(x=>x.status===200).length,ms:results.map(x=>x.ms)}));
  }
 }finally{await db.end();fs.writeFileSync(path.join(out,label+'.json'),JSON.stringify(data,null,2));}
}
main().catch(e=>{console.error('PERF02 verification failed:',e.message);process.exitCode=1});
