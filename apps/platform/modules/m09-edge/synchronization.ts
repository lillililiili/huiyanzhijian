import {readFileSync,existsSync} from 'node:fs';
import {pool,transaction,lock} from '../../infrastructure/db';
import {requireValue,object,textField} from '../../infrastructure/errors';
import {AdminApi} from '../m00-identity/admin';
import {IdentityApi,allow,type Actor,type Context} from '../m00-identity/api';
import {CatalogApi} from '../m01-catalog/api';

type Target={factoryId:string;deviceId:string;url:string;token:string};
// Addresses and credentials are installation-owned; never accept URLs from the UI.
function targets():Target[]{
 const file=process.env.EDGE_SYNC_TARGETS_FILE;if(!file||!existsSync(file))return [];
 const values=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(values))throw Error('Invalid edge target configuration');
 const seen=new Set<string>();
 return values.map((t:Target)=>{const u=new URL(t.url),id=t.factoryId+'/'+t.deviceId;if(!t.factoryId||!t.deviceId||seen.has(id)||!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash||typeof t.token!=='string'||t.token.length<32)throw Error('Invalid edge target configuration');seen.add(id);return t;});
}
export class EdgeSynchronization {
 private busy=false;
 constructor(private identity:IdentityApi,private admin:AdminApi,private catalog:CatalogApi){}
 async list(actor:Actor){
  allow(actor,'settings:write','USER');
  const rows=(await pool.query('SELECT * FROM m09.edge_point_sync WHERE factory_id=$1 ORDER BY device_id',[actor.factory])).rows;
  const configured=targets().filter(t=>t.factoryId===actor.factory);
  const ids=[...new Set([...configured.map(t=>t.deviceId),...rows.map(r=>r.device_id)])];
  const items=[];for(const id of ids){const device=await this.catalog.getDevice(actor.factory,id);const r=rows.find(r=>r.device_id===id);items.push({device_id:id,device_name:device.name,environment:device.data_environment,target_ready:configured.some(t=>t.deviceId===id),...(r||{version:'0',delivery_state:'UNCONFIGURED',distance_mm:null})});}
  return {items};
 }
 async save(ctx:Context,id:string,b:any,key:string,version:string){
  allow(ctx.actor,'settings:write','USER');object(b,['distance_mm','reason']);textField(b.reason,500);
  requireValue(Number.isInteger(b.distance_mm)&&b.distance_mm>0&&b.distance_mm<=2147483647,'VALIDATION_FAILED','测径仪间距须为1～2147483647的整数，单位mm');
  const result=await this.admin.command(ctx,'settings:write',key,['edge-point-sync',id,version,b],async db=>{
   await this.catalog.getDevice(ctx.actor.factory,id,db);
   requireValue(targets().some(t=>t.factoryId===ctx.actor.factory&&t.deviceId===id),'EDGE_TARGET_MISSING','尚未安装此设备的边缘推送通道',409);
   await lock(db,'m09-sync:'+ctx.actor.factory+':'+id);
   const before=(await db.query('SELECT * FROM m09.edge_point_sync WHERE factory_id=$1 AND device_id=$2 FOR UPDATE',[ctx.actor.factory,id])).rows[0];
   requireValue(String(before?.version||0)===version,'VERSION_CONFLICT','同步配置已变更，请刷新后重试',409);
   const r=(await db.query(`INSERT INTO m09.edge_point_sync(factory_id,device_id,distance_mm) VALUES($1,$2,$3)
    ON CONFLICT(factory_id,device_id) DO UPDATE SET distance_mm=$3,version=m09.edge_point_sync.version+1,updated_at=now(),delivery_state='PENDING',last_error=NULL RETURNING *`,[ctx.actor.factory,id,b.distance_mm])).rows[0];
   await this.identity.audit(ctx,'EDGE_SYNC_CONFIG_UPDATE','EDGE_SYNC_CONFIG',id,{before:before||null,after:r,reason:b.reason},db);return r;
  });
  void this.pushPending();return result;
 }
 start(){void this.pushPending();setInterval(()=>void this.pushPending(),15000).unref();}
 async pushPending(){
  if(this.busy)return;this.busy=true;
  try {
   const configured=targets();
   for(const target of configured){
    // The transaction lock serializes updates and network delivery per device,
    // including multiple API instances. Timeout keeps the lock bounded.
    await transaction(async db=>{
     const held=await db.query('SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS held',['m09-sync:'+target.factoryId+':'+target.deviceId]);if(!held.rows[0].held)return;
     const r=(await db.query('SELECT * FROM m09.edge_point_sync WHERE factory_id=$1 AND device_id=$2 FOR UPDATE',[target.factoryId,target.deviceId])).rows[0];if(!r||r.distance_mm==null)return;
     if(r.last_attempt_at && Date.now()-new Date(r.last_attempt_at).getTime()<14000)return;
     let receipt:any,error='';
     try {
      const res=await fetch(new URL('/edge/v1/sync-config',target.url),{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'Content-Type':'application/json',Authorization:'Bearer '+target.token},body:JSON.stringify({deviceId:target.deviceId,revision:String(r.version),distanceMm:r.distance_mm})});
      if(!res.ok)throw Error('HTTP '+res.status);
      receipt=await res.json();
      if(receipt?.accepted!==true||receipt.deviceId!==target.deviceId||receipt.revision!==String(r.version)||!['ACTIVE','NEXT_RUN'].includes(receipt.state)||typeof receipt.activeRevision!=='string'||!/^([1-9][0-9]*|)$/.test(receipt.activeRevision)||receipt.state==='ACTIVE'&&receipt.activeRevision!==String(r.version))throw Error('ACK_INVALID');
     }catch(e){error=e instanceof Error&&/^(HTTP [0-9]{3}|ACK_INVALID)$/.test(e.message)?e.message:'边缘连接失败或超时';}
     if(error){await db.query("UPDATE m09.edge_point_sync SET delivery_state='RETRYING',last_attempt_at=now(),last_error=$3 WHERE factory_id=$1 AND device_id=$2",[target.factoryId,target.deviceId,error]);return;}
     await db.query('UPDATE m09.edge_point_sync SET delivered_version=version,active_version=$3,delivery_state=$4,last_attempt_at=now(),delivered_at=CASE WHEN delivered_version=version THEN delivered_at ELSE now() END,last_error=NULL WHERE factory_id=$1 AND device_id=$2',[target.factoryId,target.deviceId,receipt.activeRevision||null,receipt.state]);
    }).catch(()=>console.warn(JSON.stringify({event:'EDGE_SYNC_DELIVERY_DEFERRED',device:target.deviceId})));
   }
  }catch{console.warn(JSON.stringify({event:'EDGE_SYNC_CONFIGURATION_UNAVAILABLE'}));}finally{this.busy=false;}
 }
}
