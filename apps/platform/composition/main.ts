import {RuleManagement} from '../modules/m03-rules/management';
import {SimulationQueries} from '../modules/m02-tasks/simulation';
import 'reflect-metadata';
import {AdminApi} from '../modules/m00-identity/admin';
import {queryLogs,recordLog,runtimeStatus,safeRoute} from '../infrastructure/runtime-log';
import {diagnostics} from '../modules/m04-measurements/diagnostics';
import {taskActivity} from './activity';
import {All,Controller,Module,Req,Res} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import type {Request,Response} from 'express';
import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../infrastructure/db';
import {ApiError,requireValue,object,textField,idPattern} from '../infrastructure/errors';
import {parseJson} from '../infrastructure/schema';
import {IdentityApi,allow,deviceScope,type Actor} from '../modules/m00-identity/api';
import {CatalogManagement} from '../modules/m01-catalog/management';
import {CatalogApi} from '../modules/m01-catalog/api';
import {RuleApi} from '../modules/m03-rules/api';
import {ProductionQueries} from '../modules/m02-tasks/queries';
import {ProductionApi} from '../modules/m02-tasks/production';
import {TaskAssociations} from '../modules/m02-tasks/associations';
import {TaskApi} from '../modules/m02-tasks/api';
import {WorkOrderApi} from '../modules/m02-tasks/work-orders';
import {MeasurementApi} from '../modules/m04-measurements/api';
const identity=new IdentityApi(),catalog=new CatalogApi(),rules=new RuleApi(),tasks=new TaskApi(identity,catalog,rules),measurements=new MeasurementApi(identity,catalog,tasks,rules);
const ruleManagement=new RuleManagement(identity,catalog,rules);
const productionQueries=new ProductionQueries();
const adminApi=new AdminApi(identity);
const catalogManagement=new CatalogManagement(identity,catalog);
const associations=new TaskAssociations(tasks,identity);
const production=new ProductionApi(tasks,identity,catalog,rules);
const workOrders=new WorkOrderApi(tasks,identity);
function summaryFor(id:string,rows:any[]){return rows.find(r=>r.task_id===id)||{task_id:id,total:0,valid:0,invalid:0,passed:0,failed:0,unevaluated:0,quarantined:0,first_sample_at:null,latest_sample_at:null,minimum:null,maximum:null,mean:null,unit:null};}
const rates=new Map<string,{count:number;until:number}>();
function rate(key:string,limit:number){const now=Date.now();if(rates.size>10000)for(const [k,v] of rates)if(v.until<now)rates.delete(k);let v=rates.get(key);if(!v||v.until<now){v={count:0,until:now+60000};rates.set(key,v);}requireValue(++v.count<=limit,'RATE_LIMITED','请求过于频繁，请稍后重试',429);}
const cookieOptions={httpOnly:true,sameSite:'strict' as const,secure:process.env.COOKIE_SECURE==='true',path:'/api/v1',maxAge:8*3600000};
function cookie(req:Request,name:string){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1)||'';}
async function body(req:Request){if(['GET','HEAD'].includes(req.method))return undefined;requireValue(!req.headers['content-encoding'],'MEDIA_TYPE_UNSUPPORTED','不支持压缩请求',415);requireValue(req.headers['content-type']?.split(';')[0]==='application/json','MEDIA_TYPE_UNSUPPORTED','请求必须使用application/json',415);let size=0;const chunks:Buffer[]=[];for await(const chunk of req){size+=chunk.length;requireValue(size<=1048576,'PAYLOAD_TOO_LARGE','请求体超过1MiB',413);chunks.push(Buffer.from(chunk));}return parseJson(Buffer.concat(chunks).toString('utf8'));}
function page(req:Request){const limit=Number(req.query.limit||50);requireValue(Number.isInteger(limit)&&limit>0&&limit<=100);const after=String(req.query.after_id||'');requireValue(after===''||idPattern.test(after));return {limit,after};}
function paged(rows:any[],limit:number){return {items:rows.slice(0,limit),has_more:rows.length>limit,next_cursor:rows.length>limit?rows[limit-1].id:null};}
@Controller()
class ApiController{
 @All('{*path}')
 async route(@Req() req:Request,@Res() res:Response){
  const requestId=typeof req.headers['x-request-id']==='string'&&idPattern.test(req.headers['x-request-id'])?req.headers['x-request-id']:randomUUID(),started=Date.now();let status=200,code='OK';res.setHeader('X-Request-Id',requestId);res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  let logActor:Actor|undefined;
  try{
   const path=req.path.replace(/\/$/,'');const method=req.method;let data:any;
   if(method==='GET'&&path==='/api/v1/health/live')data={alive:true};
   else if(method==='GET'&&path==='/api/v1/health/ready'){
    await pool.query('SELECT 1');const w=await pool.query("SELECT process_name,last_seen_at>now()-interval '15 seconds' AS healthy,capabilities FROM ops.process_heartbeat WHERE process_name='analysis-worker'");data={database:'UP',analysis_worker:w.rows[0]||{healthy:false,capabilities:[]},implemented:['device-ingestion-1.0','task-binding'],not_implemented:['analysis','reports','MES','hardware','source-alarms','evidence','position-1.1']};
   }else{
    requireValue(path.startsWith('/api/v1/'),'RESOURCE_NOT_FOUND','接口不存在',404);rate('ip:'+req.ip,600);
    if(path==='/api/v1/auth/login'&&method==='POST'){
     rate('login:'+req.ip,15);const b=await body(req);object(b,['username','password']);textField(b.username);textField(b.password,256);const login=await identity.login(b.username,b.password,requestId);res.cookie('hy_session',login.token,cookieOptions);res.cookie('hy_csrf',login.csrf,{...cookieOptions,httpOnly:false});data={user:login.user,csrf_token:login.csrf};
    }else{
     const bearer=req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];const actor:Actor=bearer?await identity.device(bearer):await identity.person(cookie(req,'hy_session'));const ctx={actor,requestId};
     logActor=actor;
     if(actor.kind==='USER'&& !['GET','HEAD'].includes(method))identity.csrf(actor,String(req.headers['x-csrf-token']||''));if(actor.kind==='DEVICE')rate('device:'+actor.id,120);
     const b=await body(req),key=String(req.headers['idempotency-key']||''),version=String(req.headers['if-match']||'');const p=page(req);
     if(path==='/api/v1/auth/me'&&method==='GET'){requireValue(actor.kind==='USER','ACCESS_DENIED','需要人员身份',403);const csrf=cookie(req,'hy_csrf');identity.csrf(actor,csrf);data={user:await identity.profile(actor),csrf_token:csrf};}
     else if(path==='/api/v1/auth/logout'&&method==='POST'){allow(actor,'data:read','USER');data=await identity.logout(ctx);res.clearCookie('hy_session',cookieOptions);res.clearCookie('hy_csrf',{...cookieOptions,httpOnly:false});}
     else if(path==='/api/v1/ingestion/profile'&&method==='GET'){allow(actor,'device:ingest','DEVICE');data=await measurements.profile(actor);}
     else if(path==='/api/v1/simulator/catalog'&&method==='GET'){
      allow(actor,'device:ingest','DEVICE');requireValue(actor.environment==='SIMULATED','SOURCE_NOT_ALLOWED','仅模拟来源可查询',403);
      data=await transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       const result=await new SimulationQueries().catalog(actor,req.query as Record<string,string>,await measurements.simulationSampledTasks(actor,db),db);
       const devices=[];for(const id of actor.devices){const d=await catalog.getDevice(actor.factory,id,db);if(d.data_environment==='SIMULATED')devices.push({id:d.id,name:d.name,metric_code:d.metric_code,enabled:d.enabled,version:d.version});}
       const specs=new Map<string,string>();for(const id of new Set<string>(result.items.map((r:any)=>r.specification_id))){const spec=await catalog.getSpecification(actor.factory,id,db);specs.set(id,spec.code);}
       return {...result,items:result.items.map((r:any)=>({...r,specification_code:specs.get(r.specification_id)})),devices,factory_id:actor.factory};
      });
     }
     else if(path==='/api/v1/device-sessions'&&method==='POST')data=await measurements.session(ctx,b);
     else if(path==='/api/v1/device-status:heartbeat'&&method==='POST')data=await measurements.heartbeat(ctx,b);
     else if(path==='/api/v1/production-events'&&method==='POST'){deviceScope(actor,b?.device_id);await measurements.checkConnection(actor,b?.device_id,b?.connection_id);data=await production.productionEvent(ctx,b);}
     else if(path==='/api/v1/measurements:ingest'&&method==='POST'){allow(actor,'device:ingest','DEVICE');data=await measurements.ingest(ctx,b);}
     else if(path==='/api/v1/receipts:query'&&method==='POST')data=await measurements.receipts(actor,b);
     else if(/^\/api\/v1\/devices\/[^/]+\/assignment$/.test(path)&&method==='GET')data=await tasks.assignment(actor,path.split('/')[4]);
     else if(/^\/api\/v1\/devices\/[^/]+\/assignment-acks$/.test(path)&&method==='POST'){const device=path.split('/')[4];deviceScope(actor,device);await measurements.checkConnection(actor,device,b?.connection_id);data=await tasks.ack(ctx,device,b);}
     else{
      allow(actor,'data:read','USER');
      if(path==='/api/v1/admin/users/options'&&method==='GET'){const options=await adminApi.options(actor);data={...options,factories:await catalog.factories(options.factory_ids)};}
      else if(path==='/api/v1/admin/users'&&method==='GET')data=await adminApi.users(actor,req.query as Record<string,string>);
      else if(path==='/api/v1/admin/users'&&method==='POST'){allow(actor,'users:manage');data=await adminApi.saveUser(ctx,null,b,key,version,(await catalog.factories(await adminApi.scope(actor))).map(r=>r.id));}
      else if(/^\/api\/v1\/admin\/users\/[^/:]+$/.test(path)&&method==='POST'){allow(actor,'users:manage');data=await adminApi.saveUser(ctx,path.split('/')[5],b,key,version,(await catalog.factories(await adminApi.scope(actor))).map(r=>r.id));}
      else if(/^\/api\/v1\/admin\/users\/[^/:]+:reset$/.test(path)&&method==='POST')data=await adminApi.reset(ctx,path.split('/')[5].split(':')[0],b,key,version);
      else if(path==='/api/v1/admin/settings'&&method==='GET')data=await adminApi.settings(actor);
      else if(/^\/api\/v1\/admin\/settings\/(platform|personal)$/.test(path)&&method==='POST')data=await adminApi.saveSettings(ctx,path.split('/')[5],b,key,version);
      else if(path==='/api/v1/admin/audits'&&method==='GET')data=await adminApi.audits(actor,req.query as Record<string,string>);
      else if(path==='/api/v1/admin/logs'&&method==='GET')data=await queryLogs(actor,req.query as Record<string,string>);
      else if(path==='/api/v1/admin/diagnostics'&&method==='GET')data=await diagnostics(actor,req.query as Record<string,string>);
      else if(path==='/api/v1/admin/status'&&method==='GET')data=await runtimeStatus(actor);
      else if(path==='/api/v1/auth/factories'&&method==='GET')data=await catalog.factories(await identity.factories(actor));
      else if(path==='/api/v1/auth/factory'&&method==='POST'){object(b,['factory_id']);textField(b.factory_id);requireValue((await catalog.factories([b.factory_id])).length,'ACCESS_DENIED','工厂不可用',403);data=await identity.switchFactory(ctx,b.factory_id);}
      else if(path==='/api/v1/catalog/specifications'&&method==='GET')data=await catalogManagement.list(actor,req.query as Record<string,string>);
      else if(path==='/api/v1/catalog/specifications'&&method==='POST')data=await catalogManagement.saveSpecification(ctx,null,b,key,version);
      else if(/^\/api\/v1\/catalog\/specifications\/[^/]+$/.test(path)&&method==='GET')data=await catalogManagement.specification(actor,path.split('/')[5]);
      else if(/^\/api\/v1\/catalog\/specifications\/[^/]+$/.test(path)&&method==='POST')data=await catalogManagement.saveSpecification(ctx,path.split('/')[5],b,key,version);
      else if(/^\/api\/v1\/catalog\/devices\/[^/]+$/.test(path)&&method==='POST')data=await catalogManagement.saveDevice(ctx,path.split('/')[5],b,key,version);
      else if(/^\/api\/v1\/catalog\/revisions\/(specifications|devices)\/[^/]+$/.test(path)&&method==='GET')data=await catalogManagement.revisions(actor,path.split('/')[5],path.split('/')[6],req.query as Record<string,string>);
      else if(path==='/api/v1/recipes'&&method==='GET')data=await rules.list(actor.factory);
      else if(path==='/api/v1/recipes'&&method==='POST')data=await ruleManagement.save(ctx,null,b,key,version);
      else if(/^\/api\/v1\/recipes\/[^/]+\/versions$/.test(path)&&method==='GET')data=await ruleManagement.versions(actor,path.split('/')[4]);
      else if(/^\/api\/v1\/recipes\/[^/]+\/versions$/.test(path)&&method==='POST')data=await ruleManagement.save(ctx,path.split('/')[4],b,key,version);
      else if(/^\/api\/v1\/recipes\/[^/]+\/status$/.test(path)&&method==='POST')data=await ruleManagement.setStatus(ctx,path.split('/')[4],b,key,version);
      else if(path==='/api/v1/catalog'&&method==='GET')data={...await catalog.list(actor.factory),recipes:await rules.list(actor.factory)};
      else if(/^\/api\/v1\/spool-summaries\/[^/]+$/.test(path)&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       const scope=await tasks.spoolScope(actor,path.split('/')[4],db);
       return {...scope,measurements:await measurements.taskSummaries(actor,scope.tasks.map(t=>t.id),db),as_of:new Date().toISOString()};
      });
      else if(path==='/api/v1/production/tasks'&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       const result=await production.searchInTransaction(actor,req.query as Record<string,string>,db);
       const summaries=await measurements.taskSummaries(actor,result.items.map((t:any)=>t.id),db);
       const activity=await measurements.taskActivity(actor,result.items.map((t:any)=>t.id),db),connections=await measurements.status(actor,db);
       return {...result,items:result.items.map((t:any)=>({...t,measurements:summaryFor(t.id,summaries),activity:taskActivity(t,connections.find(c=>c.device_id===t.device_id),activity.find(a=>a.task_id===t.id),result.as_of)}))};
      });
      else if(['/api/v1/production/plans','/api/v1/production/spools'].includes(path)&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       return path.endsWith('/plans')?productionQueries.plans(actor,req.query as Record<string,string>,db):productionQueries.spools(actor,req.query as Record<string,string>,db);
      });
      else if(path==='/api/v1/production/work-orders'&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return productionQueries.workOrders(actor,req.query as Record<string,string>,db);
      });
      else if(/^\/api\/v1\/work-order-summaries\/[^/]+$/.test(path)&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return productionQueries.workOrder(actor,path.split('/')[4],db);
      });
      else if(path==='/api/v1/operations/overview'&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       const active=await productionQueries.runningTasks(actor,db),connections=await measurements.status(actor,db),latest=await measurements.taskActivity(actor,active.map(t=>t.id),db),as_of=new Date().toISOString();
       return {as_of,connections,tasks:active.map(t=>({...t,activity:taskActivity(t,connections.find(c=>c.device_id===t.device_id),latest.find(a=>a.task_id===t.id),as_of)}))};
      });
      else if(/^\/api\/v1\/task-activity\/[^/]+$/.test(path)&&method==='GET'){
       const task=await tasks.get(actor,path.split('/')[4]),connections=await measurements.status(actor),latest=await measurements.taskActivity(actor,[task.id]);
       data=taskActivity(task,connections.find(c=>c.device_id===task.device_id),latest[0]);
      }
      else if(path==='/api/v1/plans'&&method==='GET')data=await production.plans(actor);
      else if(path==='/api/v1/plans'&&method==='POST')data=await production.createPlan(ctx,b,key);
      else if(/^\/api\/v1\/plans\/[^/:]+$/.test(path)&&method==='GET')data=await transaction(async db=>{
       await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
       const plan=await production.plan(actor,path.split('/')[4],db),summaries=await measurements.taskSummaries(actor,plan.items.filter((i:any)=>i.task).map((i:any)=>i.task.id),db);
       return {...plan,items:plan.items.map((i:any)=>({...i,task:i.task?{...i.task,measurements:summaryFor(i.task.id,summaries)}:null}))};
      });
      else if(/^\/api\/v1\/plans\/[^/:]+:(generate|start|remove)$/.test(path)&&method==='POST'){const [id,action]=path.split('/')[4].split(':');data=await production.executePlan(ctx,id,action as 'generate'|'start'|'remove',b,key);}
      else if(path==='/api/v1/discovery-profiles'&&method==='GET')data=await production.profiles(actor);
      else if(/^\/api\/v1\/discovery-profiles\/[^/]+$/.test(path)&&method==='POST')data=await production.configure(ctx,path.split('/')[4],b,key,version);
      else if(/^\/api\/v1\/spools\/[^/:]+:edit$/.test(path)&&method==='POST')data=await production.editSpool(ctx,path.split('/')[4].split(':')[0],b,key,version);
      else if(/^\/api\/v1\/tasks\/[^/]+:reassociate$/.test(path)&&method==='POST')data=await associations.correct(ctx,path.split('/')[4].split(':')[0],b,key,version);
      else if(/^\/api\/v1\/task-associations\/[^/]+$/.test(path)&&method==='GET')data=await associations.history(actor,path.split('/')[4]);
      else if(/^\/api\/v1\/task-details\/[^/]+$/.test(path)&&method==='GET'){const id=path.split('/')[4];data={...await production.taskDetail(actor,id),measurements:await measurements.taskSummary(actor,id)};}
      else if(path==='/api/v1/work-orders'&&method==='POST')data=await tasks.createWorkOrder(ctx,b,key);
      else if(/^\/api\/v1\/work-orders\/[^/:]+:delete$/.test(path)&&method==='POST')data=await workOrders.remove(ctx,path.split('/')[4].split(':')[0],b,key);
      else if(path==='/api/v1/spools'&&method==='POST')data=await tasks.createSpool(ctx,b,key);
      else if(path==='/api/v1/tasks'&&method==='POST')data=await tasks.create(ctx,b,key);
      else if(['/api/v1/work-orders','/api/v1/spools','/api/v1/tasks'].includes(path)&&method==='GET')data=paged(await tasks.list(actor,path.endsWith('work-orders')?'work_order':path.endsWith('spools')?'cable_spool':'inspection_task',p.limit+1,p.after),p.limit);
      else if(/^\/api\/v1\/tasks\/[^/:]+:(start|end)$/.test(path)&&method==='POST'){const [id,action]=path.split('/')[4].split(':');data=await tasks.transition(ctx,id,action as 'start'|'end',b,key,version);}
      else if(/^\/api\/v1\/tasks\/[^/:]+$/.test(path)&&method==='GET')data=await tasks.get(actor,path.split('/')[4]);
      else if(path==='/api/v1/measurements'&&method==='GET')data=await measurements.query(actor,req.query as Record<string,string>);
      else if(/^\/api\/v1\/measurements\/[^/]+$/.test(path)&&method==='GET')data=await measurements.detail(actor,path.split('/')[4]);
      else if(path==='/api/v1/device-status'&&method==='GET')data=await measurements.status(actor);
      else if(path==='/api/v1/audit-events'&&method==='GET')data=paged(await identity.audits(actor,p.limit+1,p.after),p.limit);
      else if(path==='/api/v1/ingestion-batches'&&method==='GET'){allow(actor,'audit:read');data=paged(await measurements.batches(actor,p.limit+1,p.after),p.limit);}
      else if(/^\/api\/v1\/ingestion-batches\/[^/]+$/.test(path)&&method==='GET'){allow(actor,'audit:read');data=await measurements.batch(actor,path.split('/')[4]);}
      else throw new ApiError(501,'FEATURE_NOT_IMPLEMENTED','此功能尚未在B1阶段开通');
     }
    }
   }
   if(path.startsWith('/api/v1/catalog/')&&data?.version)res.setHeader('ETag',`"${data.version}"`);
   res.status(200).json({code:'OK',message:'成功',request_id:requestId,data});
  }catch(err){
   let e:ApiError;if(err instanceof ApiError)e=err;else if((err as any)?.code==='23505')e=new ApiError(409,'RESOURCE_CONFLICT','记录已经存在或设备已被占用');else e=new ApiError(503,'DEPENDENCY_UNAVAILABLE','服务暂时不可用，请凭请求号核查',[],'UNKNOWN');status=e.status;code=e.code;
   if(status===401)res.setHeader('WWW-Authenticate','Bearer');if(status===429)res.setHeader('Retry-After','60');res.status(status).json({code,message:e.message,request_id:requestId,data:null,write_outcome:e.outcome,retryable:status>=500||status===429,retry_after_ms:status===429?60000:status>=500?1000:null,field_errors:e.fields});
  }finally{const log={request_id:requestId,method:req.method,route:safeRoute(req.path),status,code,duration_ms:Date.now()-started};console.log(JSON.stringify({time:new Date().toISOString(),level:status>=500?'ERROR':status>=400?'WARN':'INFO',event:'HTTP_REQUEST',...log}));await recordLog(logActor,log);if(logActor&&req.path.startsWith('/api/v1/admin/')&&req.method==='POST'&&status>=400)await identity.audit({actor:logActor,requestId},'ADMIN_COMMAND_REJECTED','ADMIN',null,{code},undefined,'FAILURE').catch(()=>{});}
 }
}
@Module({controllers:[ApiController]})class AppModule{}
async function main(){requireValue(process.env.DATABASE_URL&&process.env.CURSOR_SECRET,'CONFIG_INVALID','数据库和游标签名配置缺失');const app=await NestFactory.create(AppModule,{bodyParser:false,logger:['error','warn']});app.enableShutdownHooks();await app.listen(Number(process.env.PORT||4192),process.env.BIND_HOST||'127.0.0.1');console.log(JSON.stringify({event:'API_READY',port:Number(process.env.PORT||4192)}));}
main().catch(()=>{console.error(JSON.stringify({event:'STARTUP_FAILED'}));process.exitCode=1;});
