import type {PoolClient} from 'pg';
import {object,requireValue,idField,textField} from '../../infrastructure/errors';
import type {Actor} from '../m00-identity/api';
import {deletionFacts,deletionEligibility} from './work-orders';

// These are live operational lists, not measurement export snapshots.
function filters(q:Record<string,string>,allowed:string[],states:string[]){
 object(q,[],['page','limit','q','state','from','to',...allowed]);
 for(const value of Object.values(q))requireValue(typeof value==='string');
 const page=Number(q.page||1),limit=Number(q.limit||20);
 requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000&&Number.isSafeInteger(limit)&&limit>0&&limit<=100);
 if(q.q)textField(q.q,128);
 if(q.state)requireValue(states.includes(q.state));
 if(q.environment)requireValue(['SIMULATED','REAL'].includes(q.environment));
 for(const name of ['specification_id','device_id','process_id','line_id','metric_code','work_order_id','id'])if(q[name])idField(q[name]);
 if(q.metric_code)requireValue(['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'].includes(q.metric_code));
 for(const name of ['from','to'])if(q[name])requireValue(/T.*(Z|[+-]\d\d:\d\d)$/.test(q[name])&&Number.isFinite(Date.parse(q[name])));
 requireValue(!q.from||!q.to||Date.parse(q.from)<Date.parse(q.to));
 return {page,limit};
}
class Predicate {
 values:any[];where=['TRUE'];
 constructor(factory:string){this.values=[factory];}
 add(sql:string,value:any){this.values.push(value);this.where.push(sql.replaceAll('?',`$${this.values.length}`));}
 term(sql:string,value:any){this.values.push(value);return sql.replaceAll('?',`$${this.values.length}`);}
 dates(q:Record<string,string>){if(q.from)this.add('r.created_at>=?::timestamptz',q.from);if(q.to)this.add('r.created_at<?::timestamptz',q.to);}
}
const literal=(s:string)=>'%'+s.trim().replace(/[\\%_]/g,'\\$&')+'%';
const planState=`CASE WHEN active_count=0 THEN 'EMPTY' WHEN running_count>0 THEN 'RUNNING' WHEN failed_count>0 THEN 'FAILED' WHEN ended_count=active_count THEN 'COMPLETED' WHEN ended_count>0 THEN 'PARTIAL' WHEN ungenerated_count=0 THEN 'READY' ELSE 'DRAFT' END`;
const spoolState=`CASE WHEN task_count=0 THEN 'NO_TASK' WHEN running_count>0 THEN 'RUNNING' WHEN cancelled_count=task_count THEN 'CANCELLED' WHEN ended_count+cancelled_count=task_count THEN 'COMPLETED' WHEN ended_count>0 THEN 'PARTIAL' ELSE 'WAITING' END`;
export class ProductionQueries {
 async plans(actor:Actor,q:Record<string,string>,db:PoolClient){
  const {page,limit}=filters(q,['specification_id','device_id','process_id','environment','has_errors'],['EMPTY','RUNNING','FAILED','COMPLETED','PARTIAL','READY','DRAFT']);
  if(q.has_errors)requireValue(['true','false'].includes(q.has_errors));
  const p=new Predicate(actor.factory);p.dates(q);
  if(q.state)p.add('r.state=?',q.state);
  if(q.has_errors)p.add('(r.failed_count>0)=?::boolean',q.has_errors);
  const match=['i.plan_id=r.id','i.removed_at IS NULL'];
  for(const k of ['specification_id','device_id','process_id'])if(q[k])match.push(p.term(`COALESCE(t.${k},i.request->>'${k}')=?`,q[k]));
  // An ungenerated item has no confirmed task environment; do not infer one from a device name.
  if(q.environment)match.push(p.term('t.data_environment=?',q.environment));
  if(match.length>2)p.where.push(`EXISTS(SELECT 1 FROM m02.plan_item i LEFT JOIN m02.inspection_task t ON t.id=i.task_id WHERE ${match.join(' AND ')})`);
  if(q.q)p.add(`(concat_ws(' ',r.id,r.name) ILIKE ? OR EXISTS(SELECT 1 FROM m02.plan_item i LEFT JOIN m02.inspection_task t ON t.id=i.task_id LEFT JOIN m02.cable_spool s ON s.id=COALESCE(t.spool_id,i.request->>'spool_id') LEFT JOIN m02.work_order w ON w.id=COALESCE(t.work_order_id,i.request->>'work_order_id') WHERE i.plan_id=r.id AND i.removed_at IS NULL AND concat_ws(' ',t.task_code,s.spool_code,w.external_code,t.context_snapshot->>'spool_code') ILIKE ?))`,literal(q.q));
  const cte=`WITH counts AS (
   SELECT p.*,count(i.id)::int AS item_count,count(i.id) FILTER(WHERE i.removed_at IS NULL)::int AS active_count,
   count(i.id) FILTER(WHERE i.removed_at IS NOT NULL)::int AS removed_count,
   count(i.id) FILTER(WHERE i.removed_at IS NULL AND i.last_error IS NOT NULL)::int AS failed_count,
   count(i.id) FILTER(WHERE i.removed_at IS NULL AND i.task_id IS NULL)::int AS ungenerated_count,
   count(t.id) FILTER(WHERE i.removed_at IS NULL AND t.state='CREATED')::int AS waiting_count,
   count(t.id) FILTER(WHERE i.removed_at IS NULL AND t.state='RUNNING')::int AS running_count,
   count(t.id) FILTER(WHERE i.removed_at IS NULL AND t.state='ENDED')::int AS ended_count,
   count(DISTINCT i.request->>'spool_id') FILTER(WHERE i.removed_at IS NULL)::int AS spool_count,
   count(DISTINCT COALESCE(s.canonical_spool_id,s.id)) FILTER(WHERE i.removed_at IS NULL)::int AS current_spool_count
   FROM m02.batch_plan p LEFT JOIN m02.plan_item i ON i.plan_id=p.id LEFT JOIN m02.inspection_task t ON t.id=i.task_id
   LEFT JOIN m02.cable_spool s ON s.id=COALESCE(t.spool_id,i.request->>'spool_id') WHERE p.factory_id=$1 GROUP BY p.id
  ), states AS(SELECT counts.*,${planState} AS state FROM counts), filtered AS(SELECT r.* FROM states r WHERE ${p.where.join(' AND ')})`;
  return this.page(db,cte,p.values,page,limit,'sum(active_count)::int AS active_items,sum(failed_count)::int AS failed_items');
 }
 async spools(actor:Actor,q:Record<string,string>,db:PoolClient){
  const {page,limit}=filters(q,['specification_id','device_id','metric_code','process_id','line_id','environment','work_order_id'],['NO_TASK','WAITING','RUNNING','COMPLETED','PARTIAL','CANCELLED']);
  const p=new Predicate(actor.factory);p.dates(q);if(q.state)p.add('r.state=?',q.state);if(q.specification_id)p.add('r.specification_id=?',q.specification_id);
  if(q.work_order_id)p.add('EXISTS(SELECT 1 FROM members m WHERE m.root_id=r.id AND m.work_order_id=?)',q.work_order_id);
  const match=['x.root_id=r.id'];
  for(const k of ['device_id','metric_code','process_id'])if(q[k])match.push(p.term(`x.${k}=?`,q[k]));
  if(q.line_id)match.push(p.term("x.context_snapshot->'device'->>'line_id'=?",q.line_id));
  if(q.environment)match.push(p.term('x.data_environment=?',q.environment));
  if(match.length>1)p.where.push(`EXISTS(SELECT 1 FROM linked x WHERE ${match.join(' AND ')})`);
  if(q.q)p.add(`(EXISTS(SELECT 1 FROM members m WHERE m.root_id=r.id AND concat_ws(' ',m.spool_code,m.external_code,m.id) ILIKE ?) OR EXISTS(SELECT 1 FROM linked x WHERE x.root_id=r.id AND concat_ws(' ',x.task_code,x.context_snapshot->>'spool_code') ILIKE ?))`,literal(q.q));
  const cte=`WITH members AS(
   SELECT s.*,COALESCE(s.canonical_spool_id,s.id) AS root_id,w.external_code,w.specification_id
   FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.factory_id=$1
  ), linked AS(SELECT t.*,m.root_id FROM m02.inspection_task t JOIN members m ON m.id=t.spool_id WHERE t.factory_id=$1), counts AS(
   SELECT s.*,(SELECT count(*)::int FROM members m WHERE m.root_id=s.id) AS identity_count,
   count(t.id)::int AS task_count,count(t.id) FILTER(WHERE t.state='CREATED')::int AS waiting_count,
   count(t.id) FILTER(WHERE t.state='RUNNING')::int AS running_count,count(t.id) FILTER(WHERE t.state='ENDED')::int AS ended_count,
   count(t.id) FILTER(WHERE t.state='CANCELLED')::int AS cancelled_count,
   COALESCE(array_agg(DISTINCT t.metric_code) FILTER(WHERE t.id IS NOT NULL),'{}') AS metrics,
   COALESCE(array_agg(DISTINCT t.data_environment) FILTER(WHERE t.id IS NOT NULL),'{}') AS environments
   FROM members s LEFT JOIN linked t ON t.root_id=s.id WHERE s.canonical_spool_id IS NULL
   GROUP BY s.id,s.factory_id,s.work_order_id,s.spool_code,s.created_at,s.version,s.canonical_spool_id,s.root_id,s.external_code,s.specification_id
  ), states AS(SELECT counts.*,${spoolState} AS state FROM counts), filtered AS(SELECT r.* FROM states r WHERE ${p.where.join(' AND ')})`;
  return this.page(db,cte,p.values,page,limit,'sum(task_count)::int AS tasks,sum(running_count)::int AS running_tasks');
 }
 async workOrders(actor:Actor,q:Record<string,string>,db:PoolClient){
  const {page,limit}=filters(q,['specification_id','id'],['NO_TASK','WAITING','RUNNING','PARTIAL','COMPLETED','CANCELLED']);
  const p=new Predicate(actor.factory);p.dates(q);
  if(q.id)p.add('r.id=?',q.id);
  if(q.specification_id)p.add('r.specification_id=?',q.specification_id);
  if(q.state)p.add('r.state=?',q.state);
  if(q.q)p.add("concat_ws(' ',r.external_code,r.id) ILIKE ?",literal(q.q));
  const cte=`WITH counts AS (
   SELECT w.*, ${deletionFacts}, (SELECT count(*)::int FROM m02.cable_spool s WHERE s.factory_id=$1 AND s.work_order_id=w.id) AS registered_spools,
   (SELECT count(DISTINCT COALESCE(s.canonical_spool_id,s.id))::int FROM m02.cable_spool s WHERE s.factory_id=$1 AND s.work_order_id=w.id) AS physical_spools,
   count(t.id)::int AS task_count,count(t.id) FILTER(WHERE t.state='CREATED')::int AS waiting_count,
   count(t.id) FILTER(WHERE t.state='RUNNING')::int AS running_count,count(t.id) FILTER(WHERE t.state='ENDED')::int AS ended_count,
   count(t.id) FILTER(WHERE t.state='CANCELLED')::int AS cancelled_count
   FROM m02.work_order w LEFT JOIN m02.inspection_task t ON t.work_order_id=w.id AND t.factory_id=$1
   WHERE w.factory_id=$1 GROUP BY w.id
  ), states AS(SELECT counts.*,${spoolState} AS state FROM counts), filtered AS(SELECT r.* FROM states r WHERE ${p.where.join(' AND ')})`;
  const result=await this.page(db,cte,p.values,page,limit,'coalesce(sum(task_count),0)::int AS tasks');
  return {...result,items:result.items.map((w:any)=>({...w,...deletionEligibility(w)}))};
 }
 async workOrder(actor:Actor,id:string,db:PoolClient){
  idField(id);const result=await this.workOrders(actor,{id,limit:'1'},db);
  requireValue(result.items.length,'RESOURCE_NOT_FOUND','工单不存在',404);return {...result.items[0],as_of:result.as_of};
 }
 async runningTasks(actor:Actor,db:PoolClient){
  return (await db.query(`SELECT t.*,s.spool_code AS current_spool_code,w.external_code AS current_order_code
   FROM m02.inspection_task t JOIN m02.cable_spool s ON s.id=t.spool_id JOIN m02.work_order w ON w.id=t.work_order_id
   WHERE t.factory_id=$1 AND t.state='RUNNING' ORDER BY t.device_id`,[actor.factory])).rows;
 }
 private async page(db:PoolClient,cte:string,values:any[],page:number,limit:number,summary:string){
  const totals=(await db.query(`${cte} SELECT count(*)::int AS total,${summary} FROM filtered`,values)).rows[0];
  const items=(await db.query(`${cte} SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,(page-1)*limit])).rows;
  return {...totals,items,page,limit,as_of:new Date().toISOString()};
 }
}
