import type {PoolClient} from 'pg';
import Decimal from 'decimal.js';
import {pool} from '../../infrastructure/db';
import {ApiError} from '../../infrastructure/errors';
export const units:Record<string,string>={SHIELD_OVERLAP_RATE:'%',WIRE_GAP:'mm',OVALITY:'%'};
export const unapproved={schema_version:'rule-snapshot.v1',method_id:null,method_version:null,approval_state:'UNAPPROVED',comparison:null,parameters:{}};
export class RuleApi{
 async get(factory:string,id:string,db:PoolClient|typeof pool=pool){const row=(await db.query(this.select+' WHERE r.factory_id=$1 AND r.id=$2',[factory,id])).rows[0];if(!row)throw new ApiError(404,'RESOURCE_NOT_FOUND','配方版本不存在');return row;}
 private select=`SELECT r.*,m.group_id,m.code,m.name,m.version_number,m.unit,m.specification_ids,m.standard_reference,m.reason,m.actor_id,s.enabled,s.version FROM m03.recipe_version r JOIN m03.recipe_metadata m ON m.recipe_version_id=r.id JOIN m03.recipe_state s ON s.recipe_version_id=r.id`;
 async getSnapshot(factory:string,id:string|null,metric:string,environment:string,db:PoolClient|typeof pool=pool,specificationId?:string){
  if(!id)return structuredClone(unapproved);const row=await this.get(factory,id,db);
  if(row.metric_code!==metric)throw new ApiError(422,'RULE_NOT_APPROVED','配方与指标不匹配');
  if(!row.enabled)throw new ApiError(422,'RECIPE_DISABLED','所选配方版本已停用，请重新选择；已有任务保留原快照');
  if(row.approval_state==='TEST_ONLY'&&environment!=='SIMULATED')throw new ApiError(422,'RULE_NOT_APPROVED','测试规则不能用于真实环境');
  if(row.specification_ids.length&&(!specificationId||!row.specification_ids.includes(specificationId)))throw new ApiError(422,'RECIPE_NOT_APPLICABLE','配方不适用于当前规格');
  return row.rule_snapshot;
 }
 async list(factory:string,db:PoolClient|typeof pool=pool){return (await db.query(this.select+' WHERE r.factory_id=$1 ORDER BY m.code,m.version_number DESC',[factory])).rows;}
 evaluate(value:any,rule:any,environment:string){
  if(value.data_status!=='VALID')return {quality_result:'NOT_EVALUATED',reason_code:value.reason_code||'INVALID_DATA'};
  if(!rule.comparison||!['APPROVED','TEST_ONLY'].includes(rule.approval_state)||(rule.approval_state==='TEST_ONLY'&&environment!=='SIMULATED')||rule.method_id!==value.method_id)return {quality_result:'NOT_EVALUATED',reason_code:'METHOD_NOT_APPROVED'};
  const x=new Decimal(value.value),c=rule.comparison;const ok=c.operator==='GE'?x.gte(c.lower):c.operator==='LE'?x.lte(c.upper):x.gte(c.lower)&&x.lte(c.upper);return {quality_result:ok?'PASS':'FAIL',reason_code:null};
 }
}
