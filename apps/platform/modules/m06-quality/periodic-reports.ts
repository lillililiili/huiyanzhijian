import {randomUUID} from 'node:crypto';
import {pool,transaction} from '../../infrastructure/db';
import {sha} from '../../infrastructure/canonical';
import {requireValue} from '../../infrastructure/errors';
import {allow,IdentityApi,type Actor} from '../m00-identity/api';
import {reportContext} from '../m02-tasks/reporting-api';
import {reportMeasurements} from '../m04-measurements/reporting-api';
import {reportScope,reportPresentation} from './report-scope';
import type {PoolClient} from 'pg';
/** Report payloads contain display timestamps as well as source snapshots; preserve every value. */
export function reportDigest(value:any):string{const canonical=(v:any):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';return sha(canonical(value));}
export class PeriodicReports {
 private async collect(db:PoolClient,actor:Actor,input:any){
  const scope=reportScope(input),presentation=reportPresentation(input.presentation);
  const context=await reportContext(db,actor.factory,scope.order_id,scope.environment);
  if(scope.kind==='WORK_ORDER')scope.label=`${context.orders[0].external_code} · 全周期`;
  const values=await reportMeasurements(db,actor.factory,context.tasks.map(t=>t.id),scope);
  const found=new Set(values.taskStats.map(t=>t.task_id));
  const tasks=scope.kind==='WORK_ORDER'?context.tasks:context.tasks.filter(t=>found.has(t.id));
  const spools=scope.kind==='WORK_ORDER'?context.spools:context.spools.filter(s=>tasks.some(t=>t.spool_id===s.id));
  const orders=context.orders.filter(o=>spools.some(s=>s.work_order_id===o.id));
  const totals={total:0,valid:0,passed:0,failed:0,invalid:0,unevaluated:0,quarantined:0};
  for(const m of values.metrics)for(const k of Object.keys(totals) as (keyof typeof totals)[])totals[k]+=Number(m[k]);
  const captured=(await db.query('SELECT transaction_timestamp() captured')).rows[0].captured;
  return {schema:'REP04.1',scope,presentation,captured_at:captured,generated_by:actor.id,factory_id:actor.factory,orders,spools,tasks,totals,...values};
 }
 async preview(actor:Actor,input:any){allow(actor,'reports:read','USER');return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');return this.collect(db,actor,input);});}
 async generate(actor:Actor,input:any,key:string){
  allow(actor,'reports:write','USER');requireValue(typeof key==='string'&&key.length>=8&&key.length<=128,'REQUEST_INVALID','缺少有效生成请求键');
  reportScope(input);const hash=reportDigest(input);
  // Serialize repeated generation before beginning the data snapshot to avoid stale duplicate reads.
  const client=await pool.connect();const lockKey=`rep03:${actor.factory}:${actor.id}:${key}`;
  try{await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lockKey]);await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
   const prior=(await client.query('SELECT id,request_hash FROM m06.periodic_report WHERE factory_id=$1 AND generated_by=$2 AND command_key=$3',[actor.factory,actor.id,key])).rows[0];
   if(prior){requireValue(prior.request_hash===hash,'IDEMPOTENCY_CONFLICT','该请求键对应不同内容',409);await client.query('COMMIT');return {id:prior.id};}
   const snapshot=await this.collect(client,actor,input);requireValue(snapshot.totals.total>0,'REPORT_EMPTY','所选范围没有检测记录，无法生成报告',422);
   const id=randomUUID(),code=`HY-${snapshot.scope.kind==='WORK_ORDER'?'WO':snapshot.scope.kind[0]}-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${id.slice(0,8).toUpperCase()}`;
   const content=JSON.parse(JSON.stringify({...snapshot,id,report_code:code}));
   await client.query('INSERT INTO m06.periodic_report(id,factory_id,report_code,kind,scope,snapshot,snapshot_hash,generated_by,command_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,actor.factory,code,snapshot.scope.kind,JSON.stringify(snapshot.scope),JSON.stringify(content),reportDigest(content),actor.id,key,hash]);
   await new IdentityApi().audit({actor,requestId:id},'QUALITY_REPORT_GENERATE','PERIODIC_REPORT',id,{report_code:code,kind:snapshot.scope.kind,record_count:snapshot.totals.total},client);
   await client.query('COMMIT');return {id};
  }catch(e){await client.query('ROLLBACK');throw e;}finally{try{await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lockKey]);}finally{client.release();}}
 }
 async list(actor:Actor,q:any){allow(actor,'reports:read','USER');const page=Math.max(1,Number(q.page||1));requireValue(Number.isInteger(page)&&page<=100000);const kind=String(q.kind||'');
  return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const total=(await db.query("SELECT count(*)::int total FROM m06.periodic_report WHERE factory_id=$1 AND ($2='' OR kind=$2)",[actor.factory,kind])).rows[0].total;
   const items=(await db.query("SELECT id,report_code,kind,scope,snapshot_hash,created_at,snapshot->'totals' totals,snapshot->'presentation' presentation FROM m06.periodic_report WHERE factory_id=$1 AND ($2='' OR kind=$2) ORDER BY created_at DESC,id LIMIT 20 OFFSET $3",[actor.factory,kind,(page-1)*20])).rows;return {items,total,page};});
 }
 async detail(actor:Actor,id:string){allow(actor,'reports:read','USER');requireValue(/^[0-9a-f-]{36}$/i.test(id),'NOT_FOUND','报告不存在',404);const r=(await pool.query('SELECT snapshot,snapshot_hash FROM m06.periodic_report WHERE factory_id=$1 AND id=$2',[actor.factory,id])).rows[0];requireValue(r,'NOT_FOUND','报告不存在或不可访问',404);return {...r.snapshot,snapshot_hash:r.snapshot_hash};}
}
