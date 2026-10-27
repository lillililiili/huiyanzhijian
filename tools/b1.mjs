import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
await import('./prepare-b1.mjs');
const settings=Object.fromEntries(readFileSync('runtime/b1/compose.env','utf8').trim().split(/\r?\n/).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1)];}));
const base=['compose','--env-file','runtime/b1/compose.env','-f','docker/b1.compose.yaml'];
function run(args,extra={}){const r=spawnSync('docker',args,{cwd:root,env:{...process.env,...extra},stdio:'inherit'});if(r.status!==0)throw Error('Docker operation failed. No data was removed.');}
function compose(args,extra){run([...base,...args],extra);}
const action=process.argv[2]||'status';
if(action==='init'){
 for(const image of ['node:22-bookworm','postgis/postgis:16-3.5']){const r=spawnSync('docker',['image','inspect',image],{stdio:'ignore'});if(r.status!==0)throw Error('Missing local image: '+image+'; acquire it explicitly first.');}
 compose(['up','-d','--wait','database']);compose(['build','backend','simulator']);
 const migration='postgres://hy_migrator:'+settings.B1_MIGRATION_PASSWORD+'@database:5432/huiyan_b1';
 compose(['run','--rm','--no-deps','-e','MIGRATION_DATABASE_URL','backend','node','dist/db/migrate.js'],{MIGRATION_DATABASE_URL:migration});
 compose(['run','--rm','--no-deps','-e','MIGRATION_DATABASE_URL','-e','ACCESS_FILE=/run/b1-access.json','-v',resolve('runtime/b1/access.json')+':/run/b1-access.json:ro','backend','node','dist/db/bootstrap.js'],{MIGRATION_DATABASE_URL:migration});
 compose(['up','-d','--wait','backend']);
}else if(action==='start')compose(['up','-d','--wait','database','backend']);
else if(action==='sim')compose(['run','--rm','--no-deps','simulator','node','dist/cli.js',...process.argv.slice(3)]);
else if(action==='stop')compose(['stop','backend','database']);
else if(action==='status')compose(['ps']);
else if(action==='logs')compose(['logs','--tail','100','backend']);
else if(action==='backup'){
 const folder=resolve('runtime/b1/backups');mkdirSync(folder,{recursive:true});const file=resolve(folder,'huiyan_b1-'+new Date().toISOString().replace(/[:.]/g,'-')+'.dump');const result=spawnSync('docker',[...base,'exec','-T','database','pg_dump','-U','hy_migrator','-d','huiyan_b1','-Fc'],{maxBuffer:256*1024*1024});if(result.status!==0)throw Error('Backup failed; source database unchanged');writeFileSync(file,result.stdout,{mode:0o600});console.log('Backup saved: '+file);
}else throw Error('Use init/start/stop/status/logs/backup/sim. Never deletes volumes.');
