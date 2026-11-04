const fs=require('node:fs'),p=require('node:path'),{spawn}=require('node:child_process');
const work=p.resolve(__dirname,'../..'),root=fs.existsSync(p.join(work,'runtime/b1/local.env'))?work:p.resolve(work,'../..');
const dir=p.join(root,'runtime/jdg01'),state=JSON.parse(fs.readFileSync(p.join(dir,'state.json'))),pids=JSON.parse(fs.readFileSync(p.join(dir,'pids.json')));
try{process.kill(pids.api)}catch{}
const log=fs.openSync(p.join(dir,'api.log'),'a'),child=spawn(process.execPath,['dist/composition/main.js'],{cwd:p.join(state.work,'apps/platform'),env:state.env,windowsHide:true,detached:true,stdio:['ignore',log,log]});child.unref();pids.api=child.pid;fs.writeFileSync(p.join(dir,'pids.json'),JSON.stringify(pids));console.log('Restarted isolated JDG01 API');
