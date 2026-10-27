// Isolated acceptance fixture only. Never mutates deployed application users.
import {readFileSync,writeFileSync,mkdirSync,createWriteStream} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes} from 'node:crypto';
import http from 'node:http';
const root=resolve('.'),platform=resolve('apps/platform'),require=createRequire(resolve(platform,'package.json')),{Pool}=require('pg');
const folder=resolve('runtime/ad01');mkdirSync(folder,{recursive:true});
const base=Object.fromEntries(readFileSync('runtime/b1/local.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const dbName='hy_ad01_browser_'+Date.now(),env={...process.env,...base,DATABASE_URL:base.DATABASE_URL.replace('/huiyan_b1','/'+dbName),MIGRATION_DATABASE_URL:base.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+dbName),PORT:'4197'};
const db=new Pool({connectionString:base.MIGRATION_DATABASE_URL});await db.query(`CREATE DATABASE ${dbName}`);await db.end();
for(const file of ['db/migrate.ts','db/bootstrap.ts'])execFileSync(process.execPath,['--import','tsx',file],{cwd:platform,env,stdio:'pipe'});
const password='Fixture-'+randomBytes(18).toString('base64url');
writeFileSync(resolve(folder,'access.json'),JSON.stringify({password,dbName,env:{DATABASE_URL:env.DATABASE_URL,MIGRATION_DATABASE_URL:env.MIGRATION_DATABASE_URL}}),{mode:0o600});
const {passwordHash}=await import('../apps/platform/dist/modules/m00-identity/api.js');const hash=await passwordHash(password);const owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL});
await owner.query("INSERT INTO m01.factory(id,code,name,timezone,status) VALUES('factory-isolated','ISOLATED','AD01隔离工厂','Asia/Shanghai','ACTIVE')");
for(const [name,role] of [['ad01-admin','admin'],['ad01-viewer','viewer'],['ad01-editable','viewer']]){const id=randomUUID();await owner.query("INSERT INTO m00.app_user(id,login_name,display_name,password_hash,status) VALUES($1,$2,$2,$3,'ACTIVE')",[id,name,hash]);await owner.query('INSERT INTO m00.user_role VALUES($1,$2,$3)',[id,role,'factory-local']);if(name==='ad01-admin')await owner.query("INSERT INTO m00.user_role VALUES($1,'admin','factory-isolated')",[id]);}
// Fixed real persisted fixture rows make stable multi-page browser acceptance possible.
for(let i=0;i<24;i++)await owner.query("INSERT INTO m00.audit_event(id,factory_id,actor_type,actor_id,action,resource_type,resource_id,request_id,result,details) VALUES($1,'factory-local','SYSTEM','AD01_FIXTURE','ACCEPTANCE_FIXTURE','TEST',$2,$3,'SUCCESS',$4)",[randomUUID(),String(i),randomUUID(),JSON.stringify({reason:'隔离验收夹具，不是生产操作'})]);
await owner.end();
const children=[];for(const entry of ['main','analysis-worker']){const c=spawn(process.execPath,['dist/composition/'+entry+'.js'],{cwd:platform,env,stdio:['ignore','pipe','pipe'],windowsHide:true});const log=createWriteStream(resolve(folder,entry+'.log'));c.stdout.pipe(log);c.stderr.pipe(log);children.push(c);}
const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){const proxy=http.request({host:'127.0.0.1',port:4197,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});proxy.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'FIXTURE_API_OFFLINE',message:'隔离API已离线'}));});req.pipe(proxy);return;}
 const pathname=new URL(req.url,'http://localhost').pathname,rel=pathname==='/'?'index.html':decodeURIComponent(pathname).slice(1),file=resolve(root,'apps/web/dist',rel);if(!file.startsWith(resolve(root,'apps/web/dist')+ '\\')){res.writeHead(403);res.end();return;}try{const bytes=readFileSync(file);res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/html');res.end(bytes);}catch{res.writeHead(404);res.end();}
});server.listen(4182,'127.0.0.1',()=>console.log(JSON.stringify({browser:'http://127.0.0.1:4182',database:dbName,api_port:4197,isolated:true})));
function stop(){children.forEach(c=>c.kill());server.close(()=>process.exit());}process.on('SIGINT',stop);process.on('SIGTERM',stop);
