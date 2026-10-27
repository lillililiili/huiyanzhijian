import {spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const action=process.argv[2]||'status',folder=resolve('runtime/simulator'),env=resolve(folder,'simulator.env');
if(action==='init'&&!existsSync(env)){
  const accessFile=resolve('runtime/b1/access.json');
  if(!existsSync(accessFile))throw Error('Create runtime/simulator/simulator.env using tools/simulator/.env.example and a real SIMULATED credential first.');
  const device=JSON.parse(readFileSync(accessFile,'utf8')).device_token,password=randomBytes(24).toString('base64url');
  mkdirSync(folder,{recursive:true});
  writeFileSync(env,`SIM_PROJECT_NAME=huiyan-simulator\nSIM_API_URL=http://host.docker.internal:4192\nSIM_DEVICE_TOKEN=${device}\nSIM_WEB_PASSWORD=${password}\nSIM_WEB_PORT=4196\nSIM_BIND_ADDRESS=127.0.0.1\nSIM_ALLOWED_HOSTS=127.0.0.1,localhost\n`,{mode:0o600});
  writeFileSync(resolve(folder,'access.json'),JSON.stringify({username:'admin',password,url:'http://127.0.0.1:4196'},null,2),{mode:0o600});
  console.log('Independent simulator configuration created. Login: runtime/simulator/access.json. No secret values printed.');
}
if(!existsSync(env))throw Error('Run node tools/simulator.mjs init first or configure runtime/simulator/simulator.env.');
function compose(args){const result=spawnSync('docker',['compose','--env-file',env,'-f','tools/simulator/compose.yaml',...args],{stdio:'inherit'});if(result.status!==0)throw Error('Simulator operation failed; queue volume was not removed.');}
if(action==='init'){
  if(spawnSync('docker',['image','inspect','node:22-bookworm'],{stdio:'ignore'}).status!==0)throw Error('Local node:22-bookworm image required; no automatic pull.');
  compose(['build']);compose(['up','-d','--wait']);
}else if(action==='start')compose(['up','-d','--wait']);
else if(action==='stop')compose(['stop']);
else if(action==='restart')compose(['restart']);
else if(action==='status')compose(['ps']);
else if(action==='logs')compose(['logs','--tail','100']);
else throw Error('Use init/start/stop/restart/status/logs.');
