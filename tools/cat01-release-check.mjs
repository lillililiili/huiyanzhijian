import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const folder=resolve('临时文件夹/CAT01_基础档案维护');mkdirSync(folder,{recursive:true});
const require=createRequire(resolve('apps/platform/package.json')),{Pool}=require('pg');
const env=Object.fromEntries(readFileSync('runtime/b1/local.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1)];}));
const tables=['m02.work_order','m02.cable_spool','m02.inspection_task','m02.task_device_binding','m02.task_association_change','m02.batch_plan','m02.plan_item','m04.measurement_record','m04.measurement_value','m04.measurement_evaluation'];
async function snapshot(){const db=new Pool({connectionString:env.DATABASE_URL}),result={};try{for(const table of tables){const rows=(await db.query(`SELECT row_to_json(t)::text AS row FROM ${table} t ORDER BY row_to_json(t)::text`)).rows;result[table]={count:rows.length,sha256:createHash('sha256').update(rows.map(r=>r.row).join('\n')).digest('hex')};}return result;}finally{await db.end();}}
const action=process.argv[2];
if(action==='before'){writeFileSync(resolve(folder,'before-data.json'),JSON.stringify(await snapshot(),null,2));console.log('Business row hashes recorded.');}
else if(action==='migrate'){execFileSync(process.execPath,['dist/db/migrate.js'],{cwd:resolve('apps/platform'),env:{...process.env,...env},stdio:'inherit'});}
else if(action==='verify'){
 const before=JSON.parse(readFileSync(resolve(folder,'before-data.json'),'utf8')),after=await snapshot(),unchanged=JSON.stringify(before)===JSON.stringify(after);writeFileSync(resolve(folder,'data-integrity.json'),JSON.stringify({unchanged,before,after},null,2));if(!unchanged)throw Error('Business data changed; inspect evidence before claiming preservation');
 const containers=JSON.parse(execFileSync('docker',['inspect','huiyan-local-web-1','huiyan-b1-backend-1','huiyan-b1-database-1','huiyan-simulator-simulator-1'],{encoding:'utf8'})).map(c=>({name:c.Name,image:c.Image,created:c.Created,state:c.State.Status,health:c.State.Health?.Status}));
 writeFileSync(resolve(folder,'deployment.json'),JSON.stringify({containers,backend_compiled_sha256:execFileSync('docker',['exec','huiyan-b1-backend-1','sha256sum','/app/platform/dist/composition/main.js'],{encoding:'utf8'}).trim(),web_index_sha256:execFileSync('docker',['exec','huiyan-local-web-1','sha256sum','/usr/share/nginx/html/index.html'],{encoding:'utf8'}).trim()},null,2));console.log(JSON.stringify({business_rows_unchanged:unchanged,containers}));
}else throw Error('Use before / migrate / verify');
