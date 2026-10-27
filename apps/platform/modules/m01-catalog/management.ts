import {randomUUID} from 'node:crypto';
import Decimal from 'decimal.js';
import type {PoolClient} from 'pg';
import {pool,transaction,lock} from '../../infrastructure/db';
import {digest} from '../../infrastructure/canonical';
import {pageQuery} from '../../infrastructure/admin-query';
import {object,requireValue,textField,idField} from '../../infrastructure/errors';
import {IdentityApi,allow,type Actor,type Context} from '../m00-identity/api';
import {CatalogApi} from './api';

const metrics=['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'];
const structures=['tape','wire','combined','none'];
const specFields=['code','name','voltage_kv','conductor_area_mm2','core_count','shield_structure','enabled','cable_model','customer_code','product_type','description'];
const deviceFields=['name','model','manufacturer','serial_number','firmware','notes'];
const optionalText=(v:unknown,max:number)=>requireValue(typeof v==='string'&&v.length<=max,'VALIDATION_FAILED','文本长度超过限制');
const numeric=(v:unknown,integer:number,scale:number)=>requireValue(typeof v==='string'&&new RegExp(`^\\d{1,${integer}}(\\.\\d{1,${scale}})?$`).test(v),'VALIDATION_FAILED','数值须为规定精度的非负十进制字符串');

/** Directory maintenance only; no rule approval, protocol edits or device control. */
export class CatalogManagement {
 constructor(private identity:IdentityApi,private catalog:CatalogApi){}
 async specification(actor:Actor,id:string,db:PoolClient|typeof pool=pool){
  allow(actor,'data:read','USER');idField(id);
  const row=await this.catalog.getSpecification(actor.factory,id,db);
  const applicability=(await db.query('SELECT process_id,metric_code FROM m01.specification_applicability WHERE specification_id=$1 ORDER BY process_id,metric_code',[id])).rows;
  return {...row,applicability};
 }
 async list(actor:Actor,q:Record<string,string>){
  allow(actor,'data:read','USER');const {page,limit}=pageQuery(q,['q','enabled']);
  requireValue(!q.enabled||['true','false'].includes(q.enabled));
  return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
   const args=[actor.factory,q.q||'',q.enabled||''];
   const where="factory_id=$1 AND ($2='' OR strpos(lower(code||' '||name||' '||cable_model||' '||customer_code),lower($2))>0) AND ($3='' OR enabled::text=$3)";
   const count=await db.query('SELECT count(*)::int AS n FROM m01.product_specification WHERE '+where,args);
   const rows=await db.query('SELECT id,code,name,voltage_kv,conductor_area_mm2,core_count,shield_structure,enabled,version,cable_model,customer_code FROM m01.product_specification WHERE '+where+' ORDER BY created_at DESC,id LIMIT $4 OFFSET $5',[...args,limit,(page-1)*limit]);
   return {items:rows.rows,total:count.rows[0].n,page,limit};
  });
 }
 async revisions(actor:Actor,kind:string,id:string,q:Record<string,string>){
  allow(actor,'data:read','USER');requireValue(['specifications','devices'].includes(kind));idField(id);const {page,limit}=pageQuery(q,[]);
  if(kind==='specifications')await this.catalog.getSpecification(actor.factory,id);else await this.catalog.getDevice(actor.factory,id);
  return transaction(async db=>{await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');const args=[actor.factory,kind,id];
   const count=await db.query('SELECT count(*)::int AS n FROM m01.catalog_revision WHERE factory_id=$1 AND kind=$2 AND object_id=$3',args);
   const rows=await db.query('SELECT version,snapshot,actor_id,request_id,reason,recorded_at FROM m01.catalog_revision WHERE factory_id=$1 AND kind=$2 AND object_id=$3 ORDER BY version DESC LIMIT $4 OFFSET $5',[...args,limit,(page-1)*limit]);
   return {items:rows.rows,total:count.rows[0].n,page,limit};
  });
 }
 async command(ctx:Context,key:string,payload:unknown,fn:(db:PoolClient)=>Promise<any>){
  allow(ctx.actor,'catalog:write','USER');idField(key);const hash=digest(payload);
  return transaction(async db=>{
   // Shared factory lock serializes catalog changes with task creation and start.
   await lock(db,'production:'+ctx.actor.factory);await lock(db,`catalog:${ctx.actor.factory}:${ctx.actor.id}:${key}`);
   const old=await db.query('SELECT * FROM m01.catalog_command_receipt WHERE factory_id=$1 AND actor_id=$2 AND command_key=$3',[ctx.actor.factory,ctx.actor.id,key]);
   if(old.rowCount){requireValue(old.rows[0].payload_hash===hash,'IDEMPOTENCY_CONFLICT','同一请求键内容不同',409);return old.rows[0].response;}
   const result=await fn(db);await db.query('INSERT INTO m01.catalog_command_receipt(factory_id,actor_id,command_key,payload_hash,response) VALUES($1,$2,$3,$4,$5)',[ctx.actor.factory,ctx.actor.id,key,hash,JSON.stringify(result)]);return result;
  });
 }
 async history(db:PoolClient,ctx:Context,kind:string,before:any,after:any,reason:string){
  if(before)await db.query("INSERT INTO m01.catalog_revision(factory_id,kind,object_id,version,snapshot,actor_id,request_id,reason) VALUES($1,$2,$3,$4,$5,NULL,$6,'首次维护前基线，原修改人未知') ON CONFLICT DO NOTHING",[ctx.actor.factory,kind,before.id,before.version,JSON.stringify(before),ctx.requestId]);
  await db.query('INSERT INTO m01.catalog_revision(factory_id,kind,object_id,version,snapshot,actor_id,request_id,reason) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[ctx.actor.factory,kind,after.id,after.version,JSON.stringify(after),ctx.actor.id,ctx.requestId,reason]);
  await this.identity.audit(ctx,before?'CATALOG_UPDATED':'CATALOG_CREATED',kind.toUpperCase(),after.id,{before:before||null,after,reason},db);
 }
 async saveSpecification(ctx:Context,id:string|null,b:any,key:string,version:string){
  allow(ctx.actor,'catalog:write','USER');object(b,[...specFields,'applicability','reason']);textField(b.code,64);textField(b.name,128);textField(b.reason,500);
  requireValue(b.code===b.code.trim(),'VALIDATION_FAILED','编号首尾不可有空格');numeric(b.voltage_kv,3,3);numeric(b.conductor_area_mm2,12,4);
  requireValue(new Decimal(b.voltage_kv).gte(35)&&new Decimal(b.voltage_kv).lte(220)&&new Decimal(b.conductor_area_mm2).gt(0),'VALIDATION_FAILED','电压需35～220kV，截面积必须大于0');
  requireValue(Number.isInteger(b.core_count)&&b.core_count>0&&b.core_count<=1000);requireValue(structures.includes(b.shield_structure)&&typeof b.enabled==='boolean');
  for(const k of ['cable_model','customer_code','product_type'])optionalText(b[k],128);optionalText(b.description,2000);
  requireValue(Array.isArray(b.applicability)&&b.applicability.length>0&&b.applicability.length<=100,'VALIDATION_FAILED','至少选择一个适用工序和检测项');
  const keys=new Set();for(const a of b.applicability){object(a,['process_id','metric_code']);idField(a.process_id);requireValue(metrics.includes(a.metric_code));const k=a.process_id+':'+a.metric_code;requireValue(!keys.has(k));keys.add(k);
   // TEST_ONLY catalog setup: applicability is an explicit test selection, not inferred from
   // shield_structure. Production structure/metric compatibility must be governed by an
   // approved catalog rule; do not silently encode a guessed mapping here.
  }
  if(id){version=version.replace(/^"|"$/g,'');idField(id);requireValue(version,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);}
  return this.command(ctx,key,['specification',id,version,b],async db=>{
   const before=id?await this.specification(ctx.actor,id,db):null;if(before)requireValue(String(before.version)===version,'RESOURCE_VERSION_MISMATCH','规格已修改，请刷新核对后重新提交',412);
   for(const a of b.applicability){const p=await db.query('SELECT 1 FROM m01.inspection_process WHERE id=$1 AND factory_id=$2',[a.process_id,ctx.actor.factory]);requireValue(p.rowCount,'RESOURCE_NOT_FOUND','工序不存在或不在当前工厂',404);}
   const values=specFields.map(k=>b[k]),target=id||randomUUID();
   if(id)await db.query('UPDATE m01.product_specification SET '+specFields.map((f,i)=>`${f}=$${i+2}`).join(',')+',version=version+1,updated_at=now() WHERE id=$1',[id,...values]);
   else await db.query(`INSERT INTO m01.product_specification(id,factory_id,${specFields.join(',')},source_metadata) VALUES($1,$2,${values.map((_,i)=>'$'+(i+3)).join(',')},'{}')`,[target,ctx.actor.factory,...values]);
   await db.query('DELETE FROM m01.specification_applicability WHERE specification_id=$1',[target]);for(const a of b.applicability)await db.query('INSERT INTO m01.specification_applicability VALUES($1,$2,$3)',[target,a.process_id,a.metric_code]);
   const after=await this.specification(ctx.actor,target,db);await this.history(db,ctx,'specifications',before,after,b.reason);return after;
  });
 }
 async saveDevice(ctx:Context,id:string,b:any,key:string,version:string){
  version=version.replace(/^"|"$/g,'');allow(ctx.actor,'catalog:write','USER');object(b,[...deviceFields,'reason']);idField(id);textField(b.name,128);textField(b.model,128);textField(b.reason,500);for(const k of ['manufacturer','serial_number','firmware'])optionalText(b[k],128);optionalText(b.notes,2000);requireValue(version,'RESOURCE_VERSION_REQUIRED','需要If-Match版本',428);
  return this.command(ctx,key,['device',id,version,b],async db=>{const before=await this.catalog.getDevice(ctx.actor.factory,id,db);requireValue(String(before.version)===version,'RESOURCE_VERSION_MISMATCH','设备资料已修改，请刷新核对',412);
   const after=(await db.query('UPDATE m01.device SET '+deviceFields.map((f,i)=>`${f}=$${i+2}`).join(',')+',version=version+1,updated_at=now() WHERE id=$1 RETURNING *',[id,...deviceFields.map(k=>b[k])])).rows[0];await this.history(db,ctx,'devices',before,after,b.reason);return after;
  });
 }
}
