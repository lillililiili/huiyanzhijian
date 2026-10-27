// Explicit local maintenance operation. Never changes database or device credentials.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
const root=resolve('.'),require=createRequire(resolve(root,'apps/platform/package.json')),{Pool}=require('pg');
if(process.argv[2]!=='--apply')throw Error('Explicit --apply required; supply new password on stdin');
let password='';for await(const chunk of process.stdin)password+=chunk;password=password.trim();if(password.length<6||password.length>128)throw Error('Password length must be 6-128');
const parse=path=>Object.fromEntries(readFileSync(path,'utf8').trim().split(/\r?\n/).filter(l=>l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const config=parse('runtime/b1/local.env'),sim=parse('runtime/simulator/simulator.env'),url=new URL(config.MIGRATION_DATABASE_URL);
if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/huiyan_b1'||sim.SIM_BIND_ADDRESS!=='127.0.0.1')throw Error('Local deployment only');
const access=JSON.parse(readFileSync('runtime/b1/access.json','utf8')),simAccess=JSON.parse(readFileSync('runtime/simulator/access.json','utf8'));
const pool=new Pool({connectionString:config.MIGRATION_DATABASE_URL}),db=await pool.connect();
try{await db.query('BEGIN');await db.query("SELECT pg_advisory_xact_lock(hashtextextended('admin-identities',0))");
 const users=(await db.query('SELECT id,login_name FROM m00.app_user ORDER BY login_name FOR UPDATE')).rows;
 for(const u of users){const salt=randomBytes(16).toString('hex'),hash=salt+':'+scryptSync(password,salt,64).toString('hex');
  await db.query('UPDATE m00.app_user SET password_hash=$2,version=version+1,updated_at=now() WHERE id=$1',[u.id,hash]);
  await db.query('UPDATE m00.user_session SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL',[u.id]);
  const factories=(await db.query('SELECT DISTINCT factory_id FROM m00.user_role WHERE user_id=$1',[u.id])).rows;
  for(const f of factories)await db.query("INSERT INTO m00.audit_event(id,factory_id,actor_type,actor_id,action,resource_type,resource_id,request_id,result,details) VALUES($1,$2,'SYSTEM','local-maintenance','PASSWORD_RESET','USER',$3,$4,'SUCCESS',$5)",[randomUUID(),f.factory_id,u.id,randomUUID(),JSON.stringify({reason:'用户明确要求统一本地登录密码',credentials_changed:true,sessions_revoked:true})]);
  access.users[u.login_name]=password;
 }
 await db.query('COMMIT');
 writeFileSync('runtime/b1/access.json',JSON.stringify(access,null,2),{mode:0o600});
 sim.SIM_WEB_PASSWORD=password;sim.SIM_LOCAL_SIMPLE_PASSWORD='true';simAccess.password=password;
 writeFileSync('runtime/simulator/simulator.env',Object.entries(sim).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600});
 writeFileSync('runtime/simulator/access.json',JSON.stringify(simAccess,null,2),{mode:0o600});
 console.log(JSON.stringify({updated_users:users.map(u=>u.login_name),simulator_config_updated:true,simulator_recreate_required:true,roles_unchanged:true,device_and_database_credentials_unchanged:true}));
}catch(e){await db.query('ROLLBACK');throw e;}finally{db.release();await pool.end();}
