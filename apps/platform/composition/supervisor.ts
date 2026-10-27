import {spawn,type ChildProcess} from 'node:child_process';
import {join} from 'node:path';
let stopping=false;const children=new Set<ChildProcess>();
function launch(file:string){if(stopping)return;const child=spawn(process.execPath,[join(__dirname,file)],{stdio:'inherit',env:process.env});children.add(child);child.on('exit',()=>{children.delete(child);if(!stopping)setTimeout(()=>launch(file),2000);});}
launch('main.js');if(process.env.ENABLE_ANALYSIS_WORKER!=='false')launch('analysis-worker.js');
for(const sig of ['SIGTERM','SIGINT'] as const)process.on(sig,()=>{stopping=true;for(const child of children)child.kill('SIGTERM');setTimeout(()=>process.exit(0),1000);});
