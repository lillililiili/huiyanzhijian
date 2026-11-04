const fs=require('node:fs'),p=require('node:path'),{spawn,execFileSync}=require('node:child_process'),{randomBytes}=require('node:crypto');
const work=p.resolve(__dirname,'../..'),root=fs.existsSync(p.join(work,'runtime/b1/local.env'))?work:p.resolve(work,'../..'),dir=p.join(root,'runtime/jdg01');fs.mkdirSync(dir,{recursive:true});
const {Pool}=require(p.join(work,'apps/platform/node_modules/pg'));
const local=Object.fromEntries(fs.readFileSync(p.join(root,'runtime/b1/local.env'),'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
async function main(){
 const name='hy_jdg01_'+Date.now(),change=u=>{const v=new URL(u);v.pathname='/'+name;return v.toString()};
 const db=new Pool({connectionString:local.MIGRATION_DATABASE_URL});await db.query('CREATE DATABASE '+name);await db.end();
 const access={users:Object.fromEntries(JSON.parse(fs.readFileSync(p.join(work,'apps/platform/config/initial-catalog.json'))).users.map(u=>[u.username,'JDG01-'+randomBytes(12).toString('hex')])),device_token:randomBytes(32).toString('hex')};
 fs.writeFileSync(p.join(dir,'access.json'),JSON.stringify(access));
 const env={...process.env,...local,DATABASE_URL:change(local.DATABASE_URL),MIGRATION_DATABASE_URL:change(local.MIGRATION_DATABASE_URL),CURSOR_SECRET:randomBytes(32).toString('hex'),PORT:'44792',BIND_HOST:'127.0.0.1',ACCESS_FILE:p.join(dir,'access.json'),CONTRACT_ROOT:p.join(work,'contracts'),OVALITY_EDGE_TOKEN:randomBytes(32).toString('hex'),OVALITY_INFLUX_URL:'',EDGE_SYNC_TARGETS_FILE:'',API_URL:'http://127.0.0.1:44792'};
 fs.writeFileSync(p.join(dir,'state.json'),JSON.stringify({env,dbName:name,work}));
 for(const action of ['migrate','bootstrap'])execFileSync(process.execPath,['--import','tsx','db/'+action+'.ts'],{cwd:p.join(work,'apps/platform'),env,stdio:'pipe'});
 const pids={};for(const [key,cwd,args] of [['api','apps/platform',['dist/composition/main.js']],['preview','tests/jdg01',['preview.cjs']]]){
  const log=fs.openSync(p.join(dir,key+'.log'),'a');const child=spawn(process.execPath,args,{cwd:p.join(work,cwd),env,windowsHide:true,detached:true,stdio:['ignore',log,log]});child.unref();pids[key]=child.pid;
 }
 fs.writeFileSync(p.join(dir,'pids.json'),JSON.stringify(pids));console.log('JDG01 isolated database/API/preview ready: 44792/44781');
}
main().catch(e=>{console.error('Setup failed',e.message);process.exitCode=1});
