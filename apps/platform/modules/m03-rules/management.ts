import {randomUUID} from 'node:crypto';
import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {pool,transaction,lock} from '../../infrastructure/db';
import {digest} from '../../infrastructure/canonical';
import {object,requireValue,textField,idField} from '../../infrastructure/errors';
import {IdentityApi,allow,type Actor,type Context} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';
import {RuleApi,units} from './api';

const methods:Record<string,string>={SHIELD_OVERLAP_RATE:'test-dg',WIRE_GAP:'test-jx',OVALITY:'roundness-min-max.v1'};
export class RuleManagement {
 constructor(private identity:IdentityApi,private catalog:CatalogApi,private rules:RuleApi){}
 async versions(actor:Actor,id:string){
  allow(actor,'data:read','USER');idField(id);
  return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const target=await this.rules.get(actor.factory,id,db);
   const versions=(await this.rules.list(actor.factory,db)).filter(r=>r.group_id===target.group_id);
   const events=(await db.query('SELECT recipe_version_id,enabled,version,actor_id,reason,recorded_at FROM m03.recipe_state_event WHERE factory_id=$1 AND recipe_version_id=ANY($2::text[]) ORDER BY id DESC',[actor.factory,versions.map(r=>r.id)])).rows;
   return {versions,events};
  });
 }
 async command(ctx:Context,key:string,payload:unknown,fn:(db:PoolClient)=>Promise<any>){
  allow(ctx.actor,'rules:write','USER');idField(key);const hash=digest(payload);
  return transaction(async db=>{await lock(db,'production:'+ctx.actor.factory);await lock(db,`rules:${ctx.actor.factory}:${ctx.actor.id}:${key}`);
   const old=await db.query('SELECT * FROM m03.recipe_command_receipt WHERE factory_id=$1 AND actor_id=$2 AND command_key=$3',[ctx.actor.factory,ctx.actor.id,key]);
   if(old.rowCount){requireValue(old.rows[0].payload_hash===hash,'IDEMPOTENCY_CONFLICT','同一请求键内容不同',409);return old.rows[0].response;}
   const result=await fn(db);await db.query('INSERT INTO m03.recipe_command_receipt(factory_id,actor_id,command_key,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[ctx.actor.factory,ctx.actor.id,key,hash,JSON.stringify(result)]);return result;
  });
 }
 checkVersion(actual:string,expected:string){requireValue(expected,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);requireValue(String(actual)===expected.replace(/^"|"$/g,''),'RESOURCE_VERSION_MISMATCH','配方已变更，请刷新核对后重新提交',412);}
 async recordState(db:PoolClient,ctx:Context,id:string,enabled:boolean,reason:string){
  const state=(await db.query('UPDATE m03.recipe_state SET enabled=$2,version=version+1 WHERE recipe_version_id=$1 RETURNING version',[id,enabled])).rows[0];
  await db.query('INSERT INTO m03.recipe_state_event(factory_id,recipe_version_id,enabled,version,actor_id,request_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7)',[ctx.actor.factory,id,enabled,state.version,ctx.actor.id,ctx.requestId,reason]);
 }
 async setStatus(ctx:Context,id:string,b:any,key:string,version:string){
  allow(ctx.actor,'rules:write','USER');idField(id);object(b,['enabled','reason']);requireValue(typeof b.enabled==='boolean');textField(b.reason,500);
  return this.command(ctx,key,['status',id,version,b],async db=>{const before=await this.rules.get(ctx.actor.factory,id,db);this.checkVersion(before.version,version);
   requireValue(before.approval_state==='TEST_ONLY','RULE_NOT_APPROVED','本功能仅维护模拟测试版本',422);
   await this.recordState(db,ctx,id,b.enabled,b.reason.trim());const after=await this.rules.get(ctx.actor.factory,id,db);
   await this.identity.audit(ctx,'RECIPE_STATUS_CHANGED','RECIPE',id,{before,after,reason:b.reason},db);return after;
  });
 }
 async save(ctx:Context,id:string|null,b:any,key:string,version:string){
  allow(ctx.actor,'rules:write','USER');object(b,['code','name','metric_code','unit','comparison','specification_ids','standard_reference','reason']);
  textField(b.code,64);textField(b.name,128);textField(b.standard_reference,1000);textField(b.reason,500);
  requireValue(b.code===b.code.trim()&&Object.hasOwn(methods,b.metric_code));requireValue(b.unit===(b.metric_code==='OVALITY'?'1':units[b.metric_code]),'RULE_UNIT_INVALID','单位必须与当前接入指标一致',422);
  if(b.metric_code==='OVALITY')requireValue(b.comparison?.operator==='GE','RULE_VALUE_INVALID','圆整度使用下限判定',422);
  object(b.comparison,['operator','lower','upper']);const c=b.comparison;requireValue(['GE','LE','BETWEEN'].includes(c.operator));
  for(const k of ['lower','upper']){const needed=k==='lower'?c.operator!=='LE':c.operator!=='GE';
   if(!needed){requireValue(c[k]===null);continue;}
   requireValue(typeof c[k]==='string'&&/^\d{1,14}(\.\d{1,10})?$/.test(c[k]),'RULE_VALUE_INVALID','阈值必须为非负十进制数，最多10位小数；不可留空',422);
   requireValue(b.unit!=='1'||new Decimal(c[k]).gte(0)&&new Decimal(c[k]).lte(1),'RULE_VALUE_INVALID','圆整度下限必须位于0至1',422);
   requireValue(b.unit!=='%'||new Decimal(c[k]).lte(100),'RULE_VALUE_INVALID','百分比阈值不能超过100',422);
  }
  if(c.operator==='BETWEEN')requireValue(new Decimal(c.lower).lte(c.upper),'RULE_VALUE_INVALID','下限不能大于上限',422);
  requireValue(Array.isArray(b.specification_ids)&&b.specification_ids.length<=200&&new Set(b.specification_ids).size===b.specification_ids.length);for(const spec of b.specification_ids)idField(spec);
  if(id)idField(id);
  return this.command(ctx,key,['save',id,version,b],async db=>{
   const before=id?await this.rules.get(ctx.actor.factory,id,db):null;
   if(before){this.checkVersion(before.version,version);requireValue(before.approval_state==='TEST_ONLY'&&before.metric_code===b.metric_code&&before.code===b.code,'RULE_IDENTITY_INVALID','已有配方的编号、指标不可更改，生产版本不可在此编辑',422);}
   else {const used=await db.query('SELECT 1 FROM m03.recipe_metadata WHERE factory_id=$1 AND lower(code)=lower($2)',[ctx.actor.factory,b.code]);requireValue(!used.rowCount,'RECIPE_CODE_EXISTS','配方编号已存在，请编辑已有配方或使用新编号',409);}
   for(const specId of b.specification_ids){const spec=await this.catalog.getSpecification(ctx.actor.factory,specId,db);
    requireValue(spec.enabled,'SPEC_DISABLED','所选规格已停用',422);
    // Applicability is read only through M01's public API, never M01 tables.
    requireValue(await this.catalog.metricApplicable(specId,b.metric_code,db),'SPEC_INCOMPATIBLE','所选规格不适用此检测项',422);
   }
   const target=randomUUID(),group=before?.group_id||target;
   const number=before?Number((await db.query('SELECT max(version_number) AS n FROM m03.recipe_metadata WHERE factory_id=$1 AND group_id=$2',[ctx.actor.factory,group])).rows[0].n)+1:1;
   const rule={schema_version:'rule-snapshot.v1',method_id:methods[b.metric_code],method_version:'1',approval_state:'TEST_ONLY',comparison:c,parameters:{test_only:true,method:'provided_scalar_no_instrument_formula',unit:b.unit,recipe_code:b.code,recipe_name:b.name.trim(),recipe_revision:`V${number}.0`,standard_reference:b.standard_reference.trim(),specification_ids:b.specification_ids}};
   await db.query("INSERT INTO m03.recipe_version(id,factory_id,metric_code,revision,approval_state,rule_snapshot,source_metadata,snapshot_hash) VALUES($1,$2,$3,$4,'TEST_ONLY',$5,$6,$7)",[target,ctx.actor.factory,b.metric_code,`V${number}.0`,JSON.stringify(rule),JSON.stringify({standard_reference:b.standard_reference.trim(),reason:b.reason.trim(),actor_id:ctx.actor.id}),digest(rule)]);
   await db.query('INSERT INTO m03.recipe_metadata(recipe_version_id,factory_id,group_id,code,name,version_number,unit,specification_ids,standard_reference,reason,actor_id,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)',[target,ctx.actor.factory,group,b.code,b.name.trim(),number,b.unit,b.specification_ids,b.standard_reference.trim(),b.reason.trim(),ctx.actor.id,ctx.requestId]);
   await db.query('INSERT INTO m03.recipe_state(recipe_version_id) VALUES($1)',[target]);
   if(before)await this.recordState(db,ctx,before.id,false,'新版本 '+`V${number}.0`+' 替代：'+b.reason.trim());
   await db.query('INSERT INTO m03.recipe_state_event(factory_id,recipe_version_id,enabled,version,actor_id,request_id,reason) VALUES($1,$2,true,1,$3,$4,$5)',[ctx.actor.factory,target,ctx.actor.id,ctx.requestId,b.reason.trim()]);
   const after=await this.rules.get(ctx.actor.factory,target,db);await this.identity.audit(ctx,before?'RECIPE_VERSION_CREATED':'RECIPE_CREATED','RECIPE',target,{previous_version_id:before?.id||null,after,reason:b.reason},db);return after;
  });
 }
}
