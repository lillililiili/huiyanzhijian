const fs=require('node:fs'),p=require('node:path'),{spawn}=require('node:child_process');
const work=p.resolve(__dirname,'../..'),root=fs.existsSync(p.join(work,'runtime/b1/local.env'))?work:p.resolve(work,'../..'),dir=p.join(root,'runtime/jdg01');
async function main(){
 const cfg=Object.fromEntries(fs.readFileSync(p.join(root,'runtime/ts01/influx-init.env'),'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)]}));
 const token=cfg.DOCKER_INFLUXDB_INIT_ADMIN_TOKEN,headers={Authorization:'Token '+token,'Content-Type':'application/json'},base='http://127.0.0.1:4206';
 const orgs=await (await fetch(base+'/api/v2/orgs',{headers})).json(),org=orgs.orgs.find(o=>o.name==='huiyan-center');
 const name='jdg01-isolated-'+Date.now();let response=await fetch(base+'/api/v2/buckets',{method:'POST',headers,body:JSON.stringify({orgID:org.id,name,retentionRules:[]})});if(!response.ok)throw Error('Cannot create isolated bucket');const bucket=await response.json();
 response=await fetch(base+'/api/v2/authorizations',{method:'POST',headers,body:JSON.stringify({orgID:org.id,description:name,permissions:['read','write'].map(action=>({action,resource:{type:'buckets',id:bucket.id,orgID:org.id}}))})});if(!response.ok)throw Error('Cannot create isolated token');const auth=await response.json();
 const state=JSON.parse(fs.readFileSync(p.join(dir,'state.json')));Object.assign(state.env,{OVALITY_INFLUX_URL:base,OVALITY_INFLUX_ORG:org.name,OVALITY_INFLUX_BUCKET:name,OVALITY_INFLUX_TOKEN:auth.token});state.bucketId=bucket.id;state.authorizationId=auth.id;fs.writeFileSync(p.join(dir,'state.json'),JSON.stringify(state));
 const pids=JSON.parse(fs.readFileSync(p.join(dir,'pids.json')));process.kill(pids.api);
 const log=fs.openSync(p.join(dir,'api.log'),'a'),child=spawn(process.execPath,['dist/composition/main.js'],{cwd:p.join(work,'apps/platform'),env:state.env,windowsHide:true,detached:true,stdio:['ignore',log,log]});child.unref();pids.api=child.pid;fs.writeFileSync(p.join(dir,'pids.json'),JSON.stringify(pids));console.log('Dedicated test bucket/token enabled; production bucket unchanged');
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
