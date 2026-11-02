// Run from workspace root. Secrets remain under runtime, never in the deliverable.
const fs=require('fs'),p=require('path'),crypto=require('crypto');
const dir=p.resolve('runtime/ts01'),secrets=p.join(dir,'secrets');fs.mkdirSync(secrets,{recursive:true});
const file=p.join(dir,'influx-init.env');
if(!fs.existsSync(file))fs.writeFileSync(file,`DOCKER_INFLUXDB_INIT_MODE=setup\nDOCKER_INFLUXDB_INIT_USERNAME=huiyan-center\nDOCKER_INFLUXDB_INIT_PASSWORD=${crypto.randomBytes(32).toString('hex')}\nDOCKER_INFLUXDB_INIT_ADMIN_TOKEN=${crypto.randomBytes(32).toString('hex')}\nDOCKER_INFLUXDB_INIT_ORG=huiyan-center\nDOCKER_INFLUXDB_INIT_BUCKET=ovality-samples\nDOCKER_INFLUXDB_INIT_RETENTION=0\n`,{mode:0o600});
async function main(){if(process.argv[2]!=='authorize'){console.log('Center InfluxDB init configuration prepared; existing file preserved.');return;}
 const cfg=Object.fromEntries(fs.readFileSync(file,'utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)]}));
 const url='http://127.0.0.1:4206',headers={Authorization:'Token '+cfg.DOCKER_INFLUXDB_INIT_ADMIN_TOKEN,'Content-Type':'application/json'};
 const tokenFile=p.join(secrets,'runtime.token');if(fs.existsSync(tokenFile)){console.log('Runtime bucket token already exists; preserved.');return;}
 const res=await fetch(url+'/api/v2/buckets?org=huiyan-center&name=ovality-samples',{headers});if(!res.ok)throw Error('Bucket lookup failed');const buckets=(await res.json()).buckets;if(buckets.length!==1)throw Error('Bucket unavailable');const b=buckets[0];
 const auth=await fetch(url+'/api/v2/authorizations',{method:'POST',headers,body:JSON.stringify({orgID:b.orgID,description:'TS01 center OVALITY read/write only',permissions:['read','write'].map(action=>({action,resource:{type:'buckets',id:b.id,orgID:b.orgID}}))})});if(!auth.ok)throw Error('Bucket authorization failed');const a=await auth.json();
 fs.writeFileSync(tokenFile,a.token,{mode:0o600,flag:'wx'});fs.writeFileSync(p.join(dir,'target.json'),JSON.stringify({orgID:b.orgID,bucketID:b.id,authorizationID:a.id}));console.log('Bucket-scoped runtime token persisted; no admin token mounted in backend.');
}
main().catch(()=>{console.error('TS01 setup failed; existing data and credentials preserved.');process.exitCode=1;});
