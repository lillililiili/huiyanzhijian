import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import {RuleApi} from '../m03-rules/api';
import {digest} from '../../infrastructure/canonical';

/** A derived result is not another device upload. The original is retained by FK. */
export async function storeSheathResult(db:PoolClient,sourceId:string,task:any){
 if(!task)return;
 const source=(await db.query(`SELECT r.*,to_char(r.sample_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sample_iso,to_char(r.received_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS received_iso,p.sheath_result
 FROM m04.measurement_record r JOIN m04.measurement_projection p ON p.record_id=r.id
 WHERE r.id=$1 AND r.factory_id=$2 AND r.task_id=$3`,[sourceId,task.factory_id,task.acquisition_source_task_id])).rows[0];
 if(!source)return;
 const result=source.sheath_result,valid=result?.status==='VERIFIED'&&source.receipt_status==='STORED';
 const status=valid?'VALID':result?.status==='INVALID'?'INVALID':'MISSING';
 const id=randomUUID(),value={metric_code:'SHEATH_THICKNESS',value:valid?result.value:null,unit:'mm',data_status:status,source_quality_result:'NOT_EVALUATED',method_id:result?.method||task.rule_snapshot.method_id,window:{},reason_code:valid?null:'SHEATH_'+(result?.status||'NOT_PROVIDED')};
 const raw={schema_version:'1.0',record_id:id,task_id:task.id,device_id:source.device_id,capture_session_id:source.capture_session_id,capture_sequence:String(source.capture_sequence),sample_time:source.sample_iso,time_source:source.time_source,data_environment:source.data_environment,data_status:status,recipe_version_id:task.recipe_version_id,values:[value],derived_from_record_id:sourceId,raw:{schema_version:'ht03-derived-sheath.v1',data:{source_task_id:source.task_id,source_record_id:sourceId,calculation:result}}};
 const evaluation=source.receipt_status==='STORED'?new RuleApi().evaluate(value,task.rule_snapshot,source.data_environment):{quality_result:'NOT_EVALUATED',reason_code:source.isolation_reason||'QUARANTINED'};
 const inserted=await db.query(`INSERT INTO m04.measurement_record(id,factory_id,device_id,source_record_key,capture_session_id,capture_sequence,task_id,sample_kind,sample_time,received_at,time_source,position_quality,source_type,data_environment,data_status,receipt_status,isolation_reason,raw_payload,payload_hash,schema_version,derived_from_record_id,recipe_version_id)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'UNKNOWN',$12,$13,$14,$15,$16,$17,$18,'1.0',$19,$20) ON CONFLICT(derived_from_record_id) WHERE derived_from_record_id IS NOT NULL DO NOTHING RETURNING id`,[id,source.factory_id,source.device_id,'HT03:'+sourceId,source.capture_session_id,source.capture_sequence,task.id,source.sample_kind,source.sample_iso,source.received_iso,source.time_source,source.source_type,source.data_environment,status,source.receipt_status,source.isolation_reason,JSON.stringify(raw),digest(raw),sourceId,task.recipe_version_id]);
 if(!inserted.rowCount)return;
 await db.query(`INSERT INTO m04.measurement_value(record_id,metric_code,value,unit,data_status,source_quality_result,method_id,window_definition,reason_code) VALUES($1,'SHEATH_THICKNESS',$2,'mm',$3,'NOT_EVALUATED',$4,'{}',$5)`,[id,value.value,status,value.method_id,value.reason_code]);
 await db.query(`INSERT INTO m04.measurement_evaluation(record_id,version,quality_result,reason_code,rule_snapshot,recipe_version_id) VALUES($1,1,$2,$3,$4,$5)`,[id,evaluation.quality_result,evaluation.reason_code,JSON.stringify(task.rule_snapshot),task.recipe_version_id]);
 await db.query(`INSERT INTO m04.measurement_qualification(record_id,version,eligibility,reason_code) VALUES($1,1,$2,$3)`,[id,source.receipt_status==='STORED'?'EFFECTIVE':'QUARANTINED',source.isolation_reason]);
 await db.query(`INSERT INTO m04.measurement_projection(record_id,numeric_value,sheath_result,calculation_version) VALUES($1,$2,$3,'HT03.v1')`,[id,value.value,JSON.stringify(result)]);
 await db.query(`INSERT INTO m04.measurement_outbox(event_id,event_type,schema_version,factory_id,data_environment,aggregate_id,aggregate_version,payload) VALUES($1,'MeasurementStored.v1','1.0',$2,$3,$4,1,$5)`,[randomUUID(),source.factory_id,source.data_environment,id,JSON.stringify({record_id:id,task_id:task.id,derived_from_record_id:sourceId,eligibility:source.receipt_status==='STORED'?'EFFECTIVE':'QUARANTINED',quality_result:evaluation.quality_result,evaluation_version:1})]);
}
