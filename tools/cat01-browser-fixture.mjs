// Isolated UI acceptance. Application services and users on 4181/4192 are untouched.
import {readFileSync,writeFileSync,mkdirSync,createWriteStream} from 'node:fs';
import {resolve,relative,extname} from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync,spawn} from 'node:child_process';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import http from 'node:http';
const root=resolve('runtime/cat01'),platform=resolve(root,'apps/platform'),require=createRequire(resolve(platform,'package.json')),{Pool}=require('pg');
const folder=resolve(root,'browser');mkdirSync(folder,{recursive:true});
const base=Object.fromEntries(readFileSync(resolve(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const dbName='hy_cat01_browser_'+Date.now(),env={...process.env,...base,DATABASE_URL:base.DATABASE_URL.replace('/huiyan_b1','/'+dbName),MIGRATION_DATABASE_URL:base.MIGRATION_DATABASE_URL.replace('/huiyan_b1','/'+dbName),PORT:'4202'};
const db=new Pool({connectionString:base.MIGRATION_DATABASE_URL});await db.query(`CREATE DATABASE ${dbName}`);await db.end();
for(const entry of ['migrate','bootstrap'])execFileSync(process.execPath,['dist/db/'+entry+'.js'],{cwd:platform,env,stdio:'pipe'});
const owner=new Pool({connectionString:env.MIGRATION_DATABASE_URL});const salt=randomBytes(16).toString('hex'),hash=salt+':'+scryptSync('123456',salt,64).toString('hex');
for(const [name,role] of [['cat01-admin','admin'],['cat01-viewer','viewer']]){const id=randomUUID();await owner.query("INSERT INTO m00.app_user(id,login_name,display_name,password_hash,status) VALUES($1,$2,$2,$3,'ACTIVE')",[id,name,hash]);await owner.query('INSERT INTO m00.user_role VALUES($1,$2,$3)',[id,role,'factory-local']);}
await owner.end();writeFileSync(resolve(folder,'private.json'),JSON.stringify({dbName,env}),{mode:0o600});
const children=[];for(const entry of ['main','analysis-worker']){const c=spawn(process.execPath,['dist/composition/'+entry+'.js'],{cwd:platform,env,stdio:['ignore','pipe','pipe'],windowsHide:true});const log=createWriteStream(resolve(folder,entry+'.log'));c.stdout.pipe(log);c.stderr.pipe(log);children.push(c);}
const dist=resolve(root,'apps/web/dist');const server=http.createServer((req,res)=>{
 if(req.url.startsWith('/api/')){const proxy=http.request({host:'127.0.0.1',port:4202,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});proxy.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'FIXTURE_API_OFFLINE',message:'隔离API离线'}));});req.pipe(proxy);return;}
 const file=resolve(dist,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname.replace(/\/$/,'/index.html'))),rel=relative(dist,file);if(rel.startsWith('..')||rel.includes(':')){res.writeHead(403);res.end();return;}
 try{res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.html':'text/html'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));}catch{res.writeHead(404);res.end();}
});server.listen(4201,'127.0.0.1',()=>console.log(JSON.stringify({browser:'http://localhost:4201',database:dbName,api_port:4202,isolated:true})));
function stop(){children.forEach(c=>c.kill());server.close(()=>process.exit());}process.on('SIGINT',stop);process.on('SIGTERM',stop);
