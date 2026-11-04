const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const source=path.resolve(__dirname,'..'),root=path.resolve(process.env.PERF02_RUNTIME_ROOT||source),{Pool}=createRequire(path.join(source,'apps/platform/package.json'))('pg');
const env=Object.fromEntries(fs.readFileSync(path.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const n=l.indexOf('=');return [l.slice(0,n),l.slice(n+1)];}));
const bases=['http://127.0.0.1:4192','http://127.0.0.1:4194'],results=[];
const normalize=v=>Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).filter(([k])=>!['as_of','received_age_seconds','sample_age_seconds','next_cursor'].includes(k)).map(([k,x])=>[k,normalize(x)])):v;
async function main(){
 const db=new Pool({connectionString:env.DATABASE_URL,max:1});
 try{
  const samples=(await db.query(`SELECT DISTINCT ON(v.metric_code) v.metric_code,r.task_id,count(*) FILTER(WHERE e.quality_result='FAIL') AS failed
   FROM m04.measurement_record r JOIN m04.measurement_value v ON v.record_id=r.id JOIN m04.measurement_evaluation e ON e.record_id=r.id AND e.version=1
   WHERE r.task_id IS NOT NULL GROUP BY 1,2 ORDER BY v.metric_code,failed DESC`)).rows;
  const cookies=[];for(const base of bases){const res=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:JSON.parse(fs.readFileSync(path.join(root,'runtime/b1/access.json'),'utf8')).users.admin})});assert.equal(res.status,200);cookies.push(res.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '));}
  async function get(i,route,auth=true){const r=await fetch(bases[i]+'/api/v1'+route,{headers:auth?{Cookie:cookies[i]}:{}});return {status:r.status,body:await r.json()};}
  async function compare(label,routes,auth=true){const values=[];for(let i=0;i<2;i++)values.push(await get(i,Array.isArray(routes)?routes[i]:routes,auth));assert.equal(values[0].status,values[1].status,label);if(values[0].status===200)assert.deepEqual(normalize(values[0].body.data),normalize(values[1].body.data),label);else assert.equal(values[0].body.code,values[1].body.code,label);results.push({label,status:values[0].status,rows:values[0].body.data?.items?.length,total:values[0].body.data?.total});return values;}
  await compare('task list including latest activity and statistics','/production/tasks?limit=25');
  for(const sample of samples)for(const quality of ['', 'PASS','FAIL','NOT_EVALUATED']){
   const route='/measurements?task_id='+sample.task_id+'&limit=7&order=desc'+(quality?'&quality='+quality:'');const v=await compare(sample.metric_code+' '+(quality||'ALL'),route);
   if(v.every(x=>x.body.data?.next_cursor))await compare(sample.metric_code+' '+quality+' next page',v.map(x=>route+'&cursor='+encodeURIComponent(x.body.data.next_cursor)));
  }
  await compare('unknown task','/measurements?task_id=00000000-0000-0000-0000-000000000000&limit=7');
  await compare('invalid cursor','/measurements?cursor=invalid');await compare('invalid quality','/measurements?quality=INVALID');await compare('unauthenticated','/measurements?limit=7',false);
 }finally{await db.end();fs.writeFileSync(path.join(root,'临时文件夹/PERF02_低并发查询修复/api-parity.json'),JSON.stringify(results,null,2));}
 console.log(JSON.stringify({passed:results.length,results},null,2));
}
main().catch(e=>{console.error(e.name+': '+e.message.slice(0,500));process.exitCode=1});
