import {Pool} from 'pg';
import {pool,transaction,timestamp} from './db';
import {allow,type Actor} from '../modules/m00-identity/api';
import {pageQuery} from './admin-query';
import {requireValue} from './errors';
import {makeLog,stdoutLog,registerLogSink,type LogRecord} from './structured-log';
// Logging cannot occupy the business pool during an outage. Same restricted DB role, separate 2-slot pool.
export const logStoragePool=new Pool({connectionString:process.env.DATABASE_URL,max:2,connectionTimeoutMillis:1000,statement_timeout:1000,idleTimeoutMillis:10000,allowExitOnIdle:true,application_name:'huiyan-runtime-log'});
logStoragePool.on('error',()=>{unavailable(makeLog('RUNTIME_LOG_UNAVAILABLE','ERROR'));});
let rotated=0,pending=0,lastFailure=0,failed=0;
const segments=new Set('recipes versions api v1 admin users options reset settings platform personal audits logs status diagnostics auth login logout me factory factories catalog production tasks plans spools work-orders measurements device-status ingestion-batches operations overview health live ready ingestion profile device-sessions production-events receipts devices assignment assignment-acks discovery-profiles task-details task-associations task-activity spool-summaries work-order-summaries alarms analytics reports templates mes edge-sync config deliveries enqueue deliver import parse submit simulator initialize start end reassociate edit delete heartbeat ingest'.split(' '));
export function safeRoute(path:string){return path.split('/').map(s=>s.split(':').map(x=>segments.has(x)?x:x?'_':'').join(':')).join('/').slice(0,180);}
function unavailable(record:LogRecord){failed++;if(Date.now()-lastFailure<60000)return;lastFailure=Date.now();const n=failed;failed=0;stdoutLog({...makeLog('RUNTIME_LOG_UNAVAILABLE','ERROR',{context:{failed_count:n}}),request_id:record.request_id,trace_id:record.trace_id,span_id:record.span_id});}
export async function recordLog(record:LogRecord){
 if(!record.factory_id)return;
 // stdout already contains the event. Bound pending DB work rather than growing a queue during outages.
 if(pending>=64){unavailable(record);return;}pending++;
 try{await logStoragePool.query(`INSERT INTO ops.runtime_log(id,factory_id,level,request_id,method,route,status,code,duration_ms,occurred_at,event,message,module,instance,trace_id,span_id,parent_span_id,actor_id,actor_kind,context,error)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,[record.id,record.factory_id,record.level,record.request_id,record.method||'',record.route||'',record.status??0,record.code||'',record.duration_ms??0,record.occurred_at,record.event,record.message,record.module,record.instance,record.trace_id,record.span_id,record.parent_span_id,record.actor_id,record.actor_kind,JSON.stringify(record.context),record.error?JSON.stringify(record.error):null]);
  if(Date.now()-rotated>60000){rotated=Date.now();await logStoragePool.query('SELECT ops.rotate_runtime_log()');}
 }catch{unavailable(record);}finally{pending--;}
}
registerLogSink(recordLog);
export async function queryLogs(actor:Actor,q:Record<string,string>){allow(actor,'logs:read','USER');const {page,limit}=pageQuery(q,['from','to','service','level','request_id','trace_id','event','module','code','actor_id','task_id','device_id']);if(q.service)requireValue(q.service==='platform-api','LOG_SOURCE_UNAVAILABLE','该服务没有启用网页日志源',404);if(q.level)requireValue(['DEBUG','INFO','WARN','ERROR'].includes(q.level));
 q={...q,to:q.to||new Date().toISOString()}; const args:any[]=[actor.factory],where=["factory_id=$1","occurred_at>=now()-interval '7 days'"];
 for(const k of ['level','request_id','trace_id','event','module','code','actor_id'])if(q[k]){args.push(q[k]);where.push(`${k}=$${args.length}`);}for(const k of ['from','to'])if(q[k]){args.push(q[k]);where.push(`occurred_at${k==='from'?'>=':'<'}$${args.length}::timestamptz`);}
 for(const k of ['task_id','device_id'])if(q[k]){args.push(q[k]);where.push(`(context->>'${k}'=$${args.length} OR context->'${k}s' ? $${args.length})`);}
 return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const count=await db.query('SELECT count(*)::int AS n FROM ops.runtime_log WHERE '+where.join(' AND '),args);const rows=await db.query(`SELECT id,service,level,request_id,method,route,status,code,duration_ms,event,message,module,instance,trace_id,span_id,parent_span_id,actor_id,actor_kind,context,error,${timestamp('occurred_at')} AS occurred_at FROM ops.runtime_log WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC,id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,(page-1)*limit]);const source=await db.query('SELECT min(occurred_at) AS earliest,max(occurred_at) AS latest FROM ops.runtime_log WHERE factory_id=$1',[actor.factory]);return {as_of:q.to,items:rows.rows,total:count.rows[0].n,page,limit,source:'ops.runtime_log / platform-api',retention_days:7,maximum_rows:100000,available:source.rows[0],expired:!!q.to&&Date.parse(q.to)<Date.now()-7*86400000};});
}
export async function runtimeStatus(actor:Actor){allow(actor,'data:read','USER');const checked_at=new Date().toISOString();await pool.query('SELECT 1');const rows=await pool.query("SELECT process_name,last_seen_at,capabilities,last_seen_at>now()-interval '15 seconds' AS healthy FROM ops.process_heartbeat WHERE process_name='analysis-worker'");return {checked_at,api:'HEALTHY',database:'HEALTHY',analysis_worker:rows.rows[0]?{...rows.rows[0],state:rows.rows[0].healthy?'HEALTHY':'ABNORMAL'}:{state:'UNKNOWN',capabilities:[]},redis:'DISABLED',message_queue:'DISABLED',minio:'DISABLED'};}


