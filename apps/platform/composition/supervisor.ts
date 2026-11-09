import {spawn,type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
import {startGateway} from './workload-gateway';
let stopping=false;const children=new Set<ChildProcess>();
function launch(file:string,env:NodeJS.ProcessEnv=process.env){if(stopping)return;const child=spawn(process.execPath,[join(__dirname,file)],{stdio:'inherit',env});children.add(child);child.on('exit',()=>{children.delete(child);if(!stopping)setTimeout(()=>launch(file,env),2000);});}
const port=Number(process.env.PORT||4192);
const split=process.env.SPLIT_WORKLOADS==='true';
const ports={online:port+1,ingest:port+2,reports:port+3};
const gateway=split?startGateway(ports,port,process.env.BIND_HOST||'127.0.0.1'):undefined;
if(split){for(const [role,p] of Object.entries(ports))launch('main.js',{...process.env,PORT:String(p),BIND_HOST:'127.0.0.1',WORKLOAD_ROLE:role,DB_POOL_MAX:role==='reports'?'2':role==='ingest'?'4':'6'});}else launch('main.js');
if(process.env.ENABLE_ANALYSIS_WORKER!=='false')launch('analysis-worker.js');
for(const sig of ['SIGTERM','SIGINT'] as const)process.on(sig,()=>{stopping=true;gateway?.close();for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(0),3000);});
