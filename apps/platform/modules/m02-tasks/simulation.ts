import type {PoolClient} from 'pg';
import {object,requireValue,idField,textField} from '../../infrastructure/errors';
import {allow,type Actor} from '../m00-identity/api';
export class SimulationQueries {
 async catalog(actor:Actor,q:Record<string,string>,sampled:string[],db:PoolClient){
  allow(actor,'device:ingest','DEVICE');requireValue(actor.environment==='SIMULATED','SOURCE_NOT_ALLOWED','仅模拟来源可查询模拟目录',403);
  object(q,[],['page','limit','q','status','id']);const page=Number(q.page||1),limit=Number(q.limit||20);
  requireValue(Number.isSafeInteger(page)&&page>0&&page<=100000&&Number.isSafeInteger(limit)&&limit>0&&limit<=100);
  if(q.q)textField(q.q,128);if(q.id)idField(q.id);requireValue(!q.status||['all','pending','tested'].includes(q.status));
  const values:any[]=[actor.factory,actor.devices,sampled],where=['TRUE'];
  if(q.id){values.push(q.id);where.push(`r.id=$${values.length}`);}
  if(q.q){values.push('%'+q.q.trim().replace(/[\\%_]/g,'\\$&')+'%');where.push(`concat_ws(' ',r.spool_code,r.external_code,r.id) ILIKE $${values.length}`);}
  if(q.status&&q.status!=='all')where.push(q.status==='tested'?'r.has_samples':'NOT r.has_samples');
  const cte=`WITH members AS(SELECT s.*,coalesce(s.canonical_spool_id,s.id) root_id,w.external_code,w.specification_id FROM m02.cable_spool s JOIN m02.work_order w ON w.id=s.work_order_id WHERE s.factory_id=$1),
  roots AS(SELECT s.* FROM members s WHERE s.canonical_spool_id IS NULL AND NOT EXISTS(SELECT 1 FROM m02.inspection_task x JOIN members m ON m.id=x.spool_id WHERE m.root_id=s.id AND x.data_environment='REAL')),
  scoped AS(SELECT t.*,m.root_id FROM m02.inspection_task t JOIN members m ON m.id=t.spool_id WHERE t.factory_id=$1 AND t.data_environment='SIMULATED' AND t.device_id=ANY($2::text[])),
  counts AS(SELECT s.*,count(t.id)::int task_count,count(t.id) FILTER(WHERE t.state='RUNNING')::int running_count,count(t.id) FILTER(WHERE t.state='CREATED')::int waiting_count,count(t.id) FILTER(WHERE t.state='ENDED')::int ended_count,coalesce(bool_or(t.id=ANY($3::text[])),false) has_samples FROM roots s LEFT JOIN scoped t ON t.root_id=s.id GROUP BY s.id,s.factory_id,s.work_order_id,s.spool_code,s.created_at,s.version,s.canonical_spool_id,s.root_id,s.external_code,s.specification_id),filtered AS(SELECT r.* FROM counts r WHERE ${where.join(' AND ')})`;
  const total=(await db.query(cte+' SELECT count(*)::int n FROM filtered',values)).rows[0].n;
  const items=(await db.query(cte+` SELECT * FROM filtered ORDER BY created_at DESC,id DESC LIMIT $${values.length+1} OFFSET $${values.length+2}`,[...values,limit,(page-1)*limit])).rows;
  const ids=items.map(r=>r.id);
  const tasks=(await db.query(`WITH ranked AS(SELECT t.id,t.task_code,t.spool_id,t.work_order_id,t.device_id,t.metric_code,t.state,t.version,t.planned_length_m,coalesce(s.canonical_spool_id,s.id) root_id,row_number() OVER(PARTITION BY coalesce(s.canonical_spool_id,s.id) ORDER BY t.created_at DESC,t.id) n FROM m02.inspection_task t JOIN m02.cable_spool s ON s.id=t.spool_id WHERE t.factory_id=$1 AND t.data_environment='SIMULATED' AND t.device_id=ANY($2::text[]) AND coalesce(s.canonical_spool_id,s.id)=ANY($3::text[])) SELECT * FROM ranked WHERE n<=200 ORDER BY root_id,n`,[actor.factory,actor.devices,ids])).rows;
  return {items:items.map(s=>({...s,tasks:tasks.filter(t=>t.root_id===s.id),tasks_truncated:s.task_count>200})),total,page,limit,as_of:new Date().toISOString()};
 }
}
