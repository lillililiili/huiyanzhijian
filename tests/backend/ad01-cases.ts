import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function ad01Cases(t:any,h:any){
 const {req,command,login,db,owner}=h,admin=await login('admin'),viewer=await login('viewer');
 const ok=(r:any)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body.data;};
 const read=async(path:string,who=admin)=>ok(await req(path,'GET',undefined,who));
 const password='Isolated-'+randomUUID(),roles=[{factory_id:'factory-local',role_code:'viewer'}];let user:any,session:any;
 const auth=async(name:string,pw:string)=>{const r=await req('/auth/login','POST',{username:name,password:pw});ok(r);return {Cookie:r.cookies.map((c:string)=>c.split(';')[0]).join('; '),'X-CSRF-Token':r.body.data.csrf_token};};
 await t.test('AD01 create user persists hashed password, idempotency and filtered pages',async()=>{
  const body={login_name:'ad01-isolated',display_name:'AD01隔离用户',password,roles,reason:'隔离验收'},key=randomUUID();user=ok(await command('/admin/users',body,admin,{'Idempotency-Key':key}));assert.equal(ok(await command('/admin/users',body,admin,{'Idempotency-Key':key})).id,user.id);assert.equal((await command('/admin/users',{...body,display_name:'changed'},admin,{'Idempotency-Key':key})).status,409);
  assert.equal((await command('/admin/users',body,admin)).status,409);const stored=(await db.query('SELECT * FROM m00.app_user WHERE id=$1',[user.id])).rows[0];assert.notEqual(stored.password_hash,password);assert.ok(!JSON.stringify(user).includes(password));
  const result=await read('/admin/users?q=ad01-isolated&limit=1');assert.equal(result.total,1);assert.equal(result.items[0].version,'1');assert.equal((await read('/admin/users?q=absent')).total,0);assert.equal((await read('/admin/users?limit=1&page=2')).items.length,1);session=await auth('ad01-isolated',password);
 });
 await t.test('AD01 server auth, CSRF, invalid IDs and cross factory grant rejection',async()=>{
  for(const path of ['/admin/users','/admin/audits','/admin/logs','/admin/diagnostics']){assert.equal((await req(path)).status,401);assert.equal((await req(path,'GET',undefined,viewer)).status,403);}
  const body={display_name:'AD01',status:'ACTIVE',roles,reason:'测试'};
  assert.equal((await command('/admin/users/absent',body,admin,{'If-Match':'1'})).status,404);
  assert.equal((await command('/admin/users/'+user.id,{...body,roles:[{factory_id:'not-managed',role_code:'admin'}]},admin,{'If-Match':'1'})).status,403);
  assert.equal((await command('/admin/users/'+user.id,body,{Cookie:admin.Cookie},{'If-Match':'1'})).status,403);
  for(const query of ['page=0','limit=101','from=bad','q=a&q=b','arbitrary=x'])assert.equal((await req('/admin/users?'+query,'GET',undefined,admin)).status,400);
 });
 await t.test('AD01 simultaneous edits conflict; role changes revoke existing sessions',async()=>{
  const body={display_name:'AD01更新',status:'ACTIVE',roles:[{factory_id:'factory-local',role_code:'quality'}],reason:'角色调整'};
  const responses=await Promise.all([command('/admin/users/'+user.id,body,admin,{'If-Match':'1'}),command('/admin/users/'+user.id,{...body,display_name:'另一个更新'},admin,{'If-Match':'1'})]);assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);assert.equal((await req('/auth/me','GET',undefined,session)).status,401);session=await auth('ad01-isolated',password);assert.ok((await read('/auth/me',session)).user.permissions.includes('task:write'));user=(await read('/admin/users?q=ad01-isolated')).items[0];
 });
 await t.test('AD01 disable, enable, password reset revoke access without exposing credentials',async()=>{
  let body={display_name:user.display_name,status:'DISABLED',roles:user.roles,reason:'停用测试'};user=ok(await command('/admin/users/'+user.id,body,admin,{'If-Match':user.version}));assert.equal((await req('/auth/me','GET',undefined,session)).status,401);assert.equal((await req('/auth/login','POST',{username:'ad01-isolated',password})).status,401);
  user=ok(await command('/admin/users/'+user.id,{...body,status:'ACTIVE'},admin,{'If-Match':user.version}));const next=password+'9';ok(await command('/admin/users/'+user.id+':reset',{password:next,reason:'重置测试'},admin,{'If-Match':user.version}));assert.equal((await req('/auth/login','POST',{username:'ad01-isolated',password})).status,401);session=await auth('ad01-isolated',next);user=(await read('/admin/users?q=ad01-isolated')).items[0];
  assert.equal((await command('/admin/users/'+user.id+':reset',{password:'short',reason:'测试'},admin,{'If-Match':user.version})).status,400);
 });
 await t.test('AD01 last effective admin protected including simultaneous competing demotions',async()=>{
  const root=(await read('/admin/users?q=admin')).items.find((u:any)=>u.login_name==='admin');assert.equal((await command('/admin/users/'+root.id,{display_name:root.display_name,status:'DISABLED',roles:root.roles,reason:'隔离数据库保护测试'},admin,{'If-Match':root.version})).body.code,'LAST_ADMIN');
  const promoted=ok(await command('/admin/users/'+user.id,{display_name:user.display_name,status:'ACTIVE',roles:[{factory_id:'factory-local',role_code:'admin'}],reason:'隔离测试提升'},admin,{'If-Match':user.version}));const other=await auth('ad01-isolated',password+'9');
  const responses=await Promise.all([command('/admin/users/'+root.id,{display_name:root.display_name,status:'ACTIVE',roles,reason:'并发撤权'},admin,{'If-Match':root.version}),command('/admin/users/'+promoted.id,{display_name:promoted.display_name,status:'ACTIVE',roles,reason:'并发撤权'},other,{'If-Match':promoted.version})]);assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal((await db.query("SELECT count(*)::int n FROM m00.app_user u JOIN m00.user_role r ON r.user_id=u.id WHERE u.status='ACTIVE' AND r.role_code='admin' AND r.factory_id='factory-local'")).rows[0].n,1);
  // Restore only the isolated database fixture; never deployed user accounts.
  await owner.query("UPDATE m00.user_role SET role_code='admin' WHERE user_id=$1 AND factory_id='factory-local'",[root.id]);Object.assign(admin,await login('admin'));
 });
 await t.test('AD01 platform and personal config persist, conflicts reject, business rules untouched',async()=>{
  const before=(await db.query('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h FROM m03.recipe_version t')).rows[0].h;
  const b={platform_name:'AD01平台',organization_name:'验收机构',default_page_size:50,reason:'设置验收'};ok(await command('/admin/settings/platform',b,admin,{'If-Match':'0'}));assert.equal((await command('/admin/settings/platform',b,admin,{'If-Match':'0'})).status,409);assert.equal((await command('/admin/settings/platform',b,viewer,{'If-Match':'1'})).status,403);assert.equal((await command('/admin/settings/platform',{...b,default_page_size:7},admin,{'If-Match':'1'})).status,400);
  ok(await command('/admin/settings/personal',{page_size:20,density:'compact',reason:'个人测试'},viewer,{'If-Match':'0'}));assert.equal((await read('/admin/settings',await login('viewer'))).personal.density,'compact');assert.equal((await read('/admin/settings')).personal.density,'comfortable');assert.equal((await read('/admin/settings')).platform.platform_name,'AD01平台');assert.equal((await db.query('SELECT md5(jsonb_agg(to_jsonb(t) ORDER BY id)::text) h FROM m03.recipe_version t')).rows[0].h,before);
 });
 await t.test('AD01 factory isolation and user scope management',async()=>{
  await owner.query("INSERT INTO m01.factory(id,code,name,timezone,status) VALUES('ad01-other','AD01','隔离工厂','Asia/Shanghai','ACTIVE')");const uid=(await db.query("SELECT id FROM m00.app_user WHERE login_name='admin'")).rows[0].id;
  assert.equal((await command('/auth/factory',{factory_id:'ad01-other'},admin)).status,403);await owner.query("INSERT INTO m00.user_role VALUES($1,'admin','ad01-other')",[uid]);ok(await command('/auth/factory',{factory_id:'ad01-other'},admin));assert.equal((await read('/admin/settings')).platform.version,'0');assert.equal((await read('/admin/users?q=ad01-isolated')).total,0);assert.equal((await read('/admin/audits?action=USER_CREATE')).total,0);
  ok(await command('/auth/factory',{factory_id:'factory-local'},admin));const u=(await read('/admin/users?q=ad01-isolated')).items[0];ok(await command('/admin/users/'+u.id,{display_name:u.display_name,status:'ACTIVE',roles:[...roles,{factory_id:'ad01-other',role_code:'viewer'}],reason:'多工厂测试'},admin,{'If-Match':u.version}));const target=await auth('ad01-isolated',password+'9');assert.equal((await read('/auth/factories',target)).length,2);ok(await command('/auth/factory',{factory_id:'ad01-other'},target));assert.equal((await req('/admin/users','GET',undefined,target)).status,403);
 });
 await t.test('AD01 append-only audit filters, time bounds, pagination, redaction and invalid query',async()=>{
  const id=randomUUID();await owner.query("INSERT INTO m00.audit_event(id,factory_id,actor_type,actor_id,action,resource_type,request_id,result,details,occurred_at) VALUES($1,'factory-local','USER','fixture','AD01_BOUND','USER','redaction-test','SUCCESS',$2,'2026-10-26T01:00:00.123456Z')",[id,JSON.stringify({password:'NeverReturn',nested:{token:'NeverReturn'},before:null,after:{status:'ACTIVE'}})]);
  const p=await read('/admin/audits?action=AD01_BOUND&from=2026-10-26T01:00:00.123456Z&to=2026-10-26T01:00:01Z');assert.equal(p.total,1);assert.ok(!JSON.stringify(p).includes('NeverReturn'));assert.equal((await read('/admin/audits?action=AD01_BOUND&to=2026-10-26T01:00:00.123456Z')).total,0);
  assert.equal((await read('/admin/audits?action=AD01_BOUND&from=2026-10-26T01:00:00.123456Z&to=2026-10-26T01:00:00.123457Z')).total,1);assert.equal((await req('/admin/audits?from=2026-02-31T00:00:00Z','GET',undefined,admin)).status,400);
  const a=await read('/admin/audits?limit=2'),b=await read('/admin/audits?limit=2&page=2');assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,4);assert.ok((await read('/admin/audits?resource_id='+user.id)).total>0);assert.equal((await req('/admin/audits?from=no','GET',undefined,admin)).status,400);
  await assert.rejects(db.query('UPDATE m00.audit_event SET action=action WHERE id=$1',[id]));await assert.rejects(db.query('DELETE FROM m00.audit_event WHERE id=$1',[id]));
 });
 await t.test('AD01 real logs query pages, retention, safe fields, diagnostics and real heartbeat',async()=>{
  for(let i=0;i<4;i++)await read('/admin/settings');const cutoff=encodeURIComponent(new Date().toISOString()),a=await read('/admin/logs?limit=2&to='+cutoff),b=await read('/admin/logs?limit=2&page=2&to='+cutoff);assert.ok(a.total>=4);assert.equal(new Set([...a.items,...b.items].map(x=>x.id)).size,4);assert.ok(!JSON.stringify(a).includes(password));assert.ok(!JSON.stringify(a).includes('Cookie'));
  assert.equal((await req('/admin/logs?service=docker','GET',undefined,admin)).status,404);assert.equal((await req('/admin/logs?path=/etc/passwd','GET',undefined,admin)).status,400);assert.equal((await read('/admin/logs?to=2000-01-01T00:00:00Z')).expired,true);
  const status=await read('/admin/status');assert.equal(status.database,'HEALTHY');assert.equal(status.redis,'DISABLED');assert.ok(status.analysis_worker.capabilities.includes('health-only'));
  const diag=await read('/admin/diagnostics?limit=1');assert.equal(diag.items.length,1);const detail=await read('/admin/diagnostics?id='+diag.items[0].id);assert.ok(detail.receipts.length>0);assert.ok(!JSON.stringify(detail).includes('raw_payload'));assert.equal((await read('/admin/diagnostics?id=absent')).total,0);
  await owner.query("INSERT INTO ops.runtime_log(id,factory_id,level,request_id,method,route,status,code,duration_ms,occurred_at) VALUES($1,'factory-local','INFO','expired','GET','/test',200,'OK',1,now()-interval '8 days')",[randomUUID()]);await db.query('SELECT ops.rotate_runtime_log()');assert.equal((await db.query("SELECT count(*)::int n FROM ops.runtime_log WHERE request_id='expired'")).rows[0].n,0);
 });
}

