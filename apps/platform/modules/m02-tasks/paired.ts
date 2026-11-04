import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {IdentityApi,type Context} from '../m00-identity/api';
import {unapproved} from '../m03-rules/api';

export const SHEATH='SHEATH_THICKNESS';
export const sheathRule={...unapproved,method_id:'sheath-a-mean-minus-b-mean.meter-time.v3',method_version:'3',parameters:{unit:'mm'}};

/** M02-owned companion: one capture slot, two separately addressable result tasks. */
export async function ensureSheathTask(db:PoolClient,ctx:Context,source:any,identity:IdentityApi,nextCode:()=>Promise<string>){
 if(source.metric_code!=='OVALITY')return null;
 const old=(await db.query('SELECT * FROM m02.inspection_task WHERE factory_id=$1 AND acquisition_source_task_id=$2',[ctx.actor.factory,source.id])).rows[0];
 if(old)return old;
 const id=randomUUID(),code=await nextCode();
 const selection=source.context_snapshot?.sheath_selection;
 const snapshot={...source.context_snapshot,simultaneous_detection:{source_task_id:source.id,source_task_code:source.task_code,metrics:['OVALITY',SHEATH]}};
 const child=(await db.query(`INSERT INTO m02.inspection_task(id,factory_id,task_code,work_order_id,spool_id,device_id,process_id,specification_id,metric_code,planned_length_m,data_environment,state,rule_snapshot,context_snapshot,acquisition_source_task_id,creation_source,started_at,ended_at,end_reason,association_version,recipe_version_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,[id,source.factory_id,code,source.work_order_id,source.spool_id,source.device_id,source.process_id,source.specification_id,SHEATH,source.planned_length_m,source.data_environment,source.state,JSON.stringify(selection?.rule_snapshot||sheathRule),JSON.stringify(snapshot),source.id,source.creation_source||'MANUAL',source.started_at,source.ended_at,source.end_reason,source.association_version||1,selection?.recipe_version_id||null])).rows[0];
 await identity.audit(ctx,'TASK_CREATED','TASK',id,{source_task_id:source.id,simultaneous_metrics:['OVALITY',SHEATH]},db);
 return child;
}

export async function syncSheathState(db:PoolClient,ctx:Context,source:any,identity:IdentityApi){
 const old=(await db.query('SELECT * FROM m02.inspection_task WHERE acquisition_source_task_id=$1 AND factory_id=$2 FOR UPDATE',[source.id,ctx.actor.factory])).rows[0];
 if(!old||old.state===source.state)return;
 const child=(await db.query(`UPDATE m02.inspection_task SET state=$2,started_at=$3,ended_at=$4,end_reason=$5,version=version+1 WHERE id=$1 RETURNING *`,[old.id,source.state,source.started_at,source.ended_at,source.end_reason])).rows[0];
 await db.query('INSERT INTO m02.task_transition(id,task_id,from_state,to_state,actor_id,request_id,reason,task_version) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),child.id,old.state,child.state,ctx.actor.id,ctx.requestId,source.end_reason||'双项同步采集',child.version]);
 await identity.audit(ctx,'TASK_SYNC_TRANSITION','TASK',child.id,{source_task_id:source.id,state:child.state},db);
}

export async function readSheathCompanion(db:Pick<PoolClient,'query'>,factory:string,sourceId:string){return (await db.query('SELECT * FROM m02.inspection_task WHERE factory_id=$1 AND acquisition_source_task_id=$2',[factory,sourceId])).rows[0]||null;}
