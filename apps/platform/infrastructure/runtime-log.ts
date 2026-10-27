import {randomUUID} from 'node:crypto';
import {pool,transaction,timestamp} from './db';
import {allow,type Actor} from '../modules/m00-identity/api';
import {pageQuery} from './admin-query';
import {requireValue} from './errors';
let rotated=0;
const segments=new Set('recipes versions api v1 admin users options reset settings platform personal audits logs status diagnostics auth login logout me factory catalog production tasks plans spools work-orders measurements device-status ingestion-batches operations overview health live ready ingestion profile device-sessions production-events receipts devices assignment assignment-acks discovery-profiles task-details task-associations task-activity spool-summaries work-order-summaries'.split(' '));
export function safeRoute(path:string){return path.split('/').map(s=>segments.has(s)?s:s?'_':'').join('/').slice(0,180);}
export async function recordLog(actor:Actor|undefined,log:{request_id:string;method:string;route:string;status:number;code:string;duration_ms:number}){
 if(!actor)return;
 try{await pool.query('INSERT INTO ops.runtime_log(id,factory_id,level,request_id,method,route,status,code,duration_ms) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[randomUUID(),actor.factory,log.status>=500?'ERROR':log.status>=400?'WARN':'INFO',log.request_id,log.method,log.route,log.status,log.code,log.duration_ms]);if(Date.now()-rotated>60000){rotated=Date.now();await pool.query('SELECT ops.rotate_runtime_log()');}}
 catch{console.error(JSON.stringify({event:'RUNTIME_LOG_UNAVAILABLE',request_id:log.request_id}));}
}
export async function queryLogs(actor:Actor,q:Record<string,string>){allow(actor,'logs:read','USER');const {page,limit}=pageQuery(q,['from','to','service','level','request_id']);if(q.service)requireValue(q.service==='platform-api','LOG_SOURCE_UNAVAILABLE','该服务没有启用网页日志源',404);if(q.level)requireValue(['INFO','WARN','ERROR'].includes(q.level));
 q={...q,to:q.to||new Date().toISOString()}; const args:any[]=[actor.factory],where=["factory_id=$1","occurred_at>=now()-interval '7 days'"];
 for(const k of ['level','request_id'])if(q[k]){args.push(q[k]);where.push(`${k}=$${args.length}`);}for(const k of ['from','to'])if(q[k]){args.push(q[k]);where.push(`occurred_at${k==='from'?'>=':'<'}$${args.length}::timestamptz`);}
 return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const count=await db.query('SELECT count(*)::int AS n FROM ops.runtime_log WHERE '+where.join(' AND '),args);const rows=await db.query(`SELECT id,service,level,request_id,method,route,status,code,duration_ms,${timestamp('occurred_at')} AS occurred_at FROM ops.runtime_log WHERE ${where.join(' AND ')} ORDER BY occurred_at DESC,id DESC LIMIT $${args.length+1} OFFSET $${args.length+2}`,[...args,limit,(page-1)*limit]);const source=await db.query('SELECT min(occurred_at) AS earliest,max(occurred_at) AS latest FROM ops.runtime_log WHERE factory_id=$1',[actor.factory]);return {as_of:q.to,items:rows.rows,total:count.rows[0].n,page,limit,source:'ops.runtime_log / platform-api',retention_days:7,maximum_rows:100000,available:source.rows[0],expired:!!q.to&&Date.parse(q.to)<Date.now()-7*86400000};});
}
export async function runtimeStatus(actor:Actor){allow(actor,'data:read','USER');const checked_at=new Date().toISOString();await pool.query('SELECT 1');const rows=await pool.query("SELECT process_name,last_seen_at,capabilities,last_seen_at>now()-interval '15 seconds' AS healthy FROM ops.process_heartbeat WHERE process_name='analysis-worker'");return {checked_at,api:'HEALTHY',database:'HEALTHY',analysis_worker:rows.rows[0]?{...rows.rows[0],state:rows.rows[0].healthy?'HEALTHY':'ABNORMAL'}:{state:'UNKNOWN',capabilities:[]},redis:'DISABLED',message_queue:'DISABLED',minio:'DISABLED'};}


