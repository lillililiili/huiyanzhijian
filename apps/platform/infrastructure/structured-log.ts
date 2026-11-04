import {AsyncLocalStorage} from 'node:async_hooks';
import {randomBytes,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';

export type LogLevel='DEBUG'|'INFO'|'WARN'|'ERROR';
export type LogContext={request_id:string;trace_id:string;span_id:string;parent_span_id:string|null;factory_id:string|null;actor_id:string|null;actor_kind:string|null;method:string|null;route:string|null;module:string;context:Record<string,unknown>};
export type LogRecord=LogContext & {schema_version:1;id:string;occurred_at:string;service:string;instance:string;level:LogLevel;event:string;message:string;status:number|null;code:string|null;duration_ms:number|null;error:ReturnType<typeof safeError>};
const storage=new AsyncLocalStorage<LogContext>();
const ranks={DEBUG:10,INFO:20,WARN:30,ERROR:40};
const ids=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const messages:Record<string,string>={HTTP_REQUEST:'请求处理完成',HTTP_REJECTED:'请求被拒绝',HTTP_FAILED:'请求处理失败',HTTP_SLOW:'请求处理耗时较长',LOGIN_SUCCEEDED:'登录成功',LOGIN_FAILED:'登录失败',AUTO_REPORT_SUCCEEDED:'自动报告已生成',AUTO_REPORT_FAILED:'自动报告未生成',AUTO_MES_COMPLETED:'自动MES投递步骤完成，业务确认以回执为准',AUTO_MES_FAILED:'自动MES投递步骤失败',AUDIT_WRITE_FAILED:'拒绝操作审计写入失败',API_READY:'平台API已就绪',STARTUP_FAILED:'平台API启动失败',DATABASE_IDLE_CONNECTION_ERROR:'数据库空闲连接异常',RUNTIME_LOG_UNAVAILABLE:'运行日志未写入数据库，请按请求号查容器日志',PROCESS_EXIT:'子进程退出',PROCESS_START:'子进程启动',PROCESS_SPAWN_FAILED:'子进程启动失败',PROCESS_STOP:'进程收到停止信号'};
const commands:Record<string,string>={'/api/v1/admin/users':'创建账号','/api/v1/admin/users/_':'修改账号','/api/v1/admin/users/_:reset':'重置账号密码','/api/v1/admin/settings/platform':'修改平台参数','/api/v1/admin/settings/personal':'修改个人偏好','/api/v1/auth/factory':'切换工厂','/api/v1/auth/logout':'退出登录'};
messages.ADMIN_COMMAND_SUCCEEDED='管理操作成功';messages.ADMIN_COMMAND_REJECTED='管理操作被拒绝';messages.ADMIN_COMMAND_FAILED='管理操作失败';
export function requestEvent(status:number,method:string,route:string,duration:number){
 if(route==='/api/v1/auth/login')return status>=400?'LOGIN_FAILED':'LOGIN_SUCCEEDED';
 if(method==='POST'&&commands[route])return status>=500?'ADMIN_COMMAND_FAILED':status>=400?'ADMIN_COMMAND_REJECTED':'ADMIN_COMMAND_SUCCEEDED';
 return status>=500?'HTTP_FAILED':status>=400?'HTTP_REJECTED':duration>=1000?'HTTP_SLOW':'HTTP_REQUEST';
}
export function safeId(v:unknown){return typeof v==='string'&&ids.test(v)?v:null;}
export function newLogContext(requestId:string,method:string,route:string,traceparent?:string):LogContext{
 const trace=typeof traceparent==='string'?/^00-([0-9a-f]{32})-([0-9a-f]{16})-0[01]$/.exec(traceparent):null;
 const valid=trace&& !/^0+$/.test(trace[1])&&!/^0+$/.test(trace[2]);
 return {request_id:safeId(requestId)||randomUUID(),trace_id:valid?trace[1]:randomBytes(16).toString('hex'),span_id:randomBytes(8).toString('hex'),parent_span_id:valid?trace[2]:null,factory_id:null,actor_id:null,actor_kind:null,method:safeId(method),route,module:moduleFor(route),context:{}};
}
export function moduleFor(route:string){if(/\/admin|\/auth/.test(route))return 'M00';if(/\/catalog/.test(route))return 'M01';if(/recipes|rules/.test(route))return 'M03';if(/measurement|ingestion|device-status|device-sessions/.test(route))return 'M04';if(/alarm/.test(route))return 'M05';if(/report|analytics|template/.test(route))return 'M06';if(/\/mes/.test(route))return 'M07';if(/edge/.test(route))return 'M09';if(/task|plan|spool|work-order|production|discovery/.test(route))return 'M02';return 'INFRA';}
export function withLogContext<T>(context:LogContext,fn:()=>T){return storage.run(context,fn);}
export function currentLogContext(){return storage.getStore();}
export function setLogActor(actor:{id:string;kind:string;factory:string}){const c=storage.getStore();if(c){c.actor_id=safeId(actor.id);c.actor_kind=safeId(actor.kind);c.factory_id=safeId(actor.factory);}}
/** Only identifiers and bounded counts are collected. No bodies, headers, SQL or user prose. */
export function inputSummary(body:any,query:any={},path=''){
 const out:Record<string,unknown>={};
 for(const key of ['task_id','device_id','batch_id','spool_id','work_order_id','plan_id','recipe_version_id','connection_id','data_environment']){const v=safeId(body?.[key]??query?.[key]);if(v)out[key]=v;}
 const m=/\/((?:tasks|task-details|task-activity|task-associations|devices|discovery-profiles|work-orders|spools|plans|users|measurements|ingestion-batches))\/([^/:]+)(?::[^/]+)?$/.exec(path);
 const names:Record<string,string>={tasks:'task_id','task-details':'task_id','task-activity':'task_id','task-associations':'task_id',devices:'device_id','discovery-profiles':'device_id','work-orders':'work_order_id',spools:'spool_id',plans:'plan_id',users:'target_user_id',measurements:'record_id','ingestion-batches':'batch_id'};
 if(m&&safeId(m[2]))out[names[m[1]]]=m[2];
 for(const key of ['page','limit']){const n=Number(query?.[key]);if(Number.isSafeInteger(n)&&n>0&&n<=100000)out[key]=n;}
 if(Array.isArray(body?.records))out.record_count=body.records.length;
 // Batch members can have different identities; never imply they all belong to the first record.
 if(Array.isArray(body?.records))for(const key of ['task_id','device_id']){const values=[...new Set(body.records.map((r:any)=>safeId(r?.[key])).filter(Boolean))];out[key+'s']=values.slice(0,8);if(values.length>8)out[key+'s_truncated']=true;}
 return out;
}
export function setLogInput(body:any,query:any,path:string){const c=storage.getStore();if(c)c.context=inputSummary(body,query,path);}
/** Exception messages/SQL detail may contain credentials or customer data. Preserve location, not raw text. */
export function safeError(err:unknown):{type:string;code:string|null;frames:string[];cause?:unknown;sqlstate?:string;object?:string}|null{
 if(!err)return null;const e=err as any;
 const type=['Error','TypeError','RangeError','SyntaxError','ApiError','DatabaseReadinessError','AggregateError'].includes(e.name)?e.name:'Error';
 const code=typeof e.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(e.code)?e.code:null;
 const frames=typeof e.stack==='string'?e.stack.split('\n').slice(1).flatMap((line:string)=>{const m=/([A-Za-z0-9_.-]+\.(?:[cm]?js|tsx?)):(\d+):(\d+)\)?$/.exec(line.trim());return m?[`${m[1]}:${m[2]}:${m[3]}`]:[];}).slice(0,16):[];
 const result:NonNullable<ReturnType<typeof safeError>>={type,code,frames};
 if(typeof e.sqlstate==='string'&&/^[A-Z0-9]{5}$/.test(e.sqlstate))result.sqlstate=e.sqlstate;
 if(['m04.measurement_raw','m07.measurement_outbox','m06.quality_report_snapshot','m06.report_approval'].includes(e.object))result.object=e.object;
 if(e.cause&&e.cause!==err){const cause=e.cause;result.cause={type:typeof cause.name==='string'&&['Error','TypeError','ApiError'].includes(cause.name)?cause.name:'Error',code:typeof cause.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(cause.code)?cause.code:null};}
 return result;
}
export function enabled(level:LogLevel){const configured=process.env.LOG_LEVEL as LogLevel;return ranks[level]>=ranks[configured in ranks?configured:'INFO'];}
export function requestLevel(status:number,method:string,route:string,duration:number):LogLevel{if(status>=500)return 'ERROR';if(status>=400||duration>=1000)return 'WARN';if(method==='GET'||method==='HEAD'||/heartbeat$/.test(route))return 'DEBUG';return 'INFO';}
function boundedContext(value:Record<string,unknown>){
 const out:Record<string,unknown>={};
 for(const [key,v] of Object.entries(value)){
  if(['task_id','device_id','batch_id','spool_id','work_order_id','plan_id','recipe_version_id','connection_id','data_environment','target_user_id','record_id','report_id','delivery_id','process_name'].includes(key)){const id=safeId(v);if(id)out[key]=id;}
  else if(['page','limit','record_count','failed_count','exit_code'].includes(key)&&Number.isSafeInteger(v))out[key]=v;
  else if(['task_ids','device_ids'].includes(key)&&Array.isArray(v))out[key]=v.filter(x=>safeId(x)).slice(0,8);
  else if(['task_ids_truncated','device_ids_truncated'].includes(key)&&typeof v==='boolean')out[key]=v;
 }
 return out;
}
export function makeLog(event:string,level:LogLevel,extra:{status?:number;code?:string;duration_ms?:number;error?:unknown;context?:Record<string,unknown>;module?:string}={}):LogRecord{
 const c=storage.getStore()||newLogContext(randomUUID(),'','');
 const message=event.startsWith('ADMIN_COMMAND_')&&c.route&&commands[c.route]?commands[c.route]+'：'+(event.endsWith('SUCCEEDED')?'成功':event.endsWith('REJECTED')?'已拒绝':'失败'):messages[event]||'平台运行事件';
 return {...c,context:boundedContext({...c.context,...extra.context}),schema_version:1,id:randomUUID(),occurred_at:new Date().toISOString(),service:'platform-api',instance:`${hostname()}:${process.pid}`,level,event,message,module:extra.module||c.module,status:extra.status??null,code:safeId(extra.code),duration_ms:extra.duration_ms===undefined?null:Math.max(0,Math.round(extra.duration_ms)),error:safeError(extra.error)};
}
let sink:((record:LogRecord)=>Promise<void>)|undefined;
export function registerLogSink(fn:(record:LogRecord)=>Promise<void>){sink=fn;}
export function stdoutLog(record:LogRecord){const line=JSON.stringify(record);if(record.level==='ERROR')console.error(line);else if(record.level==='WARN')console.warn(line);else console.log(line);}
export async function logEvent(event:string,level:LogLevel,extra:Parameters<typeof makeLog>[2]={}){if(!enabled(level))return;const record=makeLog(event,level,extra);stdoutLog(record);if(sink&&record.factory_id)await sink(record);}
