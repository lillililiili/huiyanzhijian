// Personnel acceptance helper, deliberately outside the device simulator.
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),access=JSON.parse(readFileSync(resolve(root,'runtime/b1/access.json'),'utf8')),url=process.env.API_URL||'http://127.0.0.1:4192';
let cookie='',csrf='';
async function request(path,body,extra={}){const response=await fetch(url+'/api/v1'+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf}:{}),...extra},body:body===undefined?undefined:JSON.stringify(body)});const payload=await response.json();if(!response.ok)throw Error(payload.code+': '+payload.message);return {payload,response};}
const login=await request('/auth/login',{username:'admin',password:access.users.admin});cookie=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');csrf=login.payload.data.csrf_token;
async function command(path,body,extra={}){return (await request(path,body,{'Idempotency-Key':randomUUID(),...extra})).payload.data;}
try{
 if(process.argv[2]==='prepare-tasks'){
  const prefix=process.argv[3]||('ACCEPT-'+Date.now());const configs=[['dg','HY-DG-01','SP035-400','SHIELD_OVERLAP_RATE','DG-V1.0'],['jx','HY-JX-01','SP110-800','WIRE_GAP','JX-V1.0'],['by','HY-BY-01','SP220-1200','OVALITY','BY-V1.0']];
  for(const [m,device,spec,metric,recipe] of configs){const order=await command('/work-orders',{external_code:prefix+'-'+m,specification_id:spec}),spool=await command('/spools',{work_order_id:order.id,spool_code:prefix+'-'+m});const task=await command('/tasks',{work_order_id:order.id,spool_id:spool.id,specification_id:spec,process_id:'process-'+m,device_id:device,metric_code:metric,recipe_version_id:recipe,planned_length_m:'1000'});await command('/tasks/'+task.id+':start',{}, {'If-Match':task.version});console.log(JSON.stringify({device_id:device,task_id:task.id,work_order:order.external_code,spool:spool.spool_code}));}
 }else if(process.argv[2]==='end-task'){
  const id=process.argv[3];if(!id)throw Error('Supply task ID');const task=(await request('/tasks/'+id)).payload.data;const ended=await command('/tasks/'+id+':end',{reason:'人工验收结束，不代表整盘合格'},{'If-Match':task.version});console.log(JSON.stringify({task_id:ended.id,state:ended.state}));
 }else if(process.argv[2]==='summary'){
  const groups={};let cursor='',total=0,asOf='';
  do{const page=(await request('/measurements?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''))).payload.data;asOf=page.as_of;
   for(const r of page.items){const g=groups[r.metric_code]??={total:0,valid:0,invalid:0,pass:0,fail:0,not_evaluated:0,quarantined:0};g.total++;total++;g[r.raw_payload.data_status==='VALID'?'valid':'invalid']++;g[r.quality_result.toLowerCase()]++;if(r.receipt_status==='QUARANTINED')g.quarantined++;}
   cursor=page.next_cursor;if(total>100000)throw Error('Acceptance helper limit exceeded; use a scoped query');
  }while(cursor);console.log(JSON.stringify({as_of:asOf,total,groups,note:'测量记录级统计，不是有效检测长度或整盘成品率'},null,2));
 }else{
  const path=process.argv[2]==='catalog'?'/catalog':process.argv[2]==='audit'?'/audit-events':process.argv[2]==='batches'?'/ingestion-batches':process.argv[2]==='tasks'?'/tasks':process.argv[2]==='devices'?'/device-status':'/measurements?limit=100';const data=(await request(path)).payload.data;console.log(JSON.stringify(data,null,2));
 }
}finally{await request('/auth/logout',{});}
