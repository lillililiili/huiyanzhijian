import {randomBytes,randomUUID,scrypt as scryptCb,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import type {PoolClient} from 'pg';
import {pool,timestamp} from '../../infrastructure/db';
import {sha} from '../../infrastructure/canonical';
import {redact} from '../../infrastructure/admin-query';
import {ApiError,requireValue} from '../../infrastructure/errors';
const scrypt=promisify(scryptCb);
export type Actor={id:string;kind:'USER'|'DEVICE';factory:string;permissions:string[];devices:string[];environment:string|null;csrfHash?:string;sessionHash?:string};
export type Context={actor:Actor;requestId:string};
export async function passwordHash(password:string){const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64) as Buffer;return salt+':'+hash.toString('hex');}
async function checkPassword(password:string,stored:string){const [salt,value]=stored.split(':');const hash=await scrypt(password,salt,64) as Buffer;const target=Buffer.from(value,'hex');return target.length===hash.length&&timingSafeEqual(target,hash);}
export function allow(actor:Actor,permission:string,kind?:Actor['kind']){if((kind&&actor.kind!==kind)||!actor.permissions.includes(permission))throw new ApiError(403,'ACCESS_DENIED','当前身份无此操作权限');}
export function deviceScope(actor:Actor,deviceId:string,environment?:string){allow(actor,'device:ingest','DEVICE');if(!actor.devices.includes(deviceId)||(environment!==undefined&&actor.environment!==environment))throw new ApiError(403,'SOURCE_NOT_ALLOWED','设备或来源环境超出凭据范围');}
export class IdentityApi{
 async audit(ctx:Context,action:string,resourceType:string,resourceId:string|null,details:unknown={},db=pool as PoolClient|typeof pool,result='SUCCESS'){
  await db.query('INSERT INTO m00.audit_event(id,factory_id,actor_type,actor_id,action,resource_type,resource_id,request_id,result,details) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[randomUUID(),ctx.actor.factory,ctx.actor.kind,ctx.actor.id,action,resourceType,resourceId,ctx.requestId,result,JSON.stringify(details)]);
 }
 async login(username:string,password:string,requestId:string){
  const r=await pool.query('SELECT * FROM m00.app_user WHERE login_name=$1',[username]);const user=r.rows[0];
  const ok=user?await checkPassword(password,user.password_hash):await checkPassword(password,'0123456789abcdef0123456789abcdef:'+ '00'.repeat(64));
  if(!user||!ok||user.status!=='ACTIVE'){await pool.query("INSERT INTO m00.audit_event(id,actor_type,action,resource_type,request_id,result,details) VALUES($1,'ANONYMOUS','LOGIN','SESSION',$2,'FAILURE',$3)",[randomUUID(),requestId,JSON.stringify({reason:'AUTHENTICATION_FAILED'})]);throw new ApiError(401,'AUTH_REQUIRED','账号或密码不正确，或账号已停用');}
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  await pool.query("INSERT INTO m00.user_session(token_hash,user_id,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '8 hours')",[sha(token),user.id,sha(csrf)]);
  const actor=await this.person(token);await this.audit({actor,requestId},'LOGIN','SESSION',null);return {token,csrf,user:{id:user.id,username:user.login_name,name:user.display_name,permissions:actor.permissions,factory_id:actor.factory}};
 }
 async person(token:string):Promise<Actor>{
  const r=await pool.query("SELECT s.*,u.status FROM m00.user_session s JOIN m00.app_user u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'",[sha(token)]);if(!r.rowCount)throw new ApiError(401,'AUTH_REQUIRED','请重新登录');
  const roles=await pool.query('SELECT ur.factory_id,r.permission_codes FROM m00.user_role ur JOIN m00.app_role r ON r.code=ur.role_code WHERE user_id=$1 ORDER BY ur.factory_id,ur.role_code',[r.rows[0].user_id]);if(!roles.rowCount)throw new ApiError(403,'ACCESS_DENIED','账号未分配工厂权限');
  const factory=roles.rows.some(x=>x.factory_id===r.rows[0].active_factory)?r.rows[0].active_factory:roles.rows[0].factory_id;
  return {kind:'USER',id:r.rows[0].user_id,factory,permissions:[...new Set<string>(roles.rows.filter(x=>x.factory_id===factory).flatMap(x=>x.permission_codes))],devices:[],environment:null,csrfHash:r.rows[0].csrf_hash,sessionHash:sha(token)};
 }
 async device(token:string):Promise<Actor>{const r=await pool.query('SELECT * FROM m00.access_credential WHERE token_hash=$1 AND revoked_at IS NULL AND expires_at>now()',[sha(token)]);if(!r.rowCount)throw new ApiError(401,'AUTH_EXPIRED','设备凭据缺失、过期或已撤销');const c=r.rows[0];return {kind:'DEVICE',id:c.id,factory:c.factory_id,permissions:c.scopes,devices:c.device_ids,environment:c.data_environment};}
 async profile(actor:Actor){const r=await pool.query('SELECT login_name,display_name FROM m00.app_user WHERE id=$1',[actor.id]);return {id:actor.id,username:r.rows[0].login_name,name:r.rows[0].display_name,permissions:actor.permissions,factory_id:actor.factory};}
 async logout(ctx:Context){await pool.query('UPDATE m00.user_session SET revoked_at=now() WHERE token_hash=$1',[ctx.actor.sessionHash]);await this.audit(ctx,'LOGOUT','SESSION',null);return {logged_out:true};}
 async factories(actor:Actor){return (await pool.query('SELECT DISTINCT factory_id FROM m00.user_role WHERE user_id=$1',[actor.id])).rows.map(r=>r.factory_id);}
 async switchFactory(ctx:Context,factory:string){requireValue((await this.factories(ctx.actor)).includes(factory),'ACCESS_DENIED','未分配该工厂',403);await pool.query('UPDATE m00.user_session SET active_factory=$2 WHERE token_hash=$1 AND revoked_at IS NULL',[ctx.actor.sessionHash,factory]);await this.audit(ctx,'FACTORY_SWITCH','SESSION',null,{from:ctx.actor.factory,to:factory});return {factory_id:factory};}
 csrf(actor:Actor,value:string){requireValue(actor.csrfHash&&sha(value)===actor.csrfHash,'ACCESS_DENIED','CSRF校验失败',403);}
 async audits(actor:Actor,limit:number,after:string){allow(actor,'audit:read','USER');return (await pool.query(`SELECT id,factory_id,actor_type,actor_id,action,resource_type,resource_id,request_id,result,details,${timestamp('occurred_at')} AS occurred_at FROM m00.audit_event WHERE factory_id=$1 AND ($2='' OR id::text>$2) ORDER BY id LIMIT $3`,[actor.factory,after,limit])).rows.map(redact);}
}
