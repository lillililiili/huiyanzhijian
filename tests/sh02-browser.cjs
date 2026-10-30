const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),web=path.join(root,'tools/simulator/web'),out=path.join(root,'runtime/sh02-browser');fs.mkdirSync(out,{recursive:true});
const id='11111111-1111-4111-8111-111111111111';let saved=null;
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');res.setHeader('Cache-Control','no-store');
 if(url.pathname.startsWith('/api/')){res.setHeader('Content-Type','application/json');let data={};
 if(url.pathname==='/api/session')data={csrf:'fixture',username:'admin'};
 else if(url.pathname==='/api/catalog')data={page:1,total:1,items:[{id,spool_code:'SH02 浏览器隔离线缆',tasks:[],model:saved?{version:1,data:saved}:null,inspection:{},task_count:0,running_count:0,waiting_count:0}],devices:[]};
 else if(url.pathname==='/api/devices')data={connected:true,devices:[]};
 else if(url.pathname==='/api/state')data={as_of:new Date().toISOString(),totals:{generated:0,pending:0,stored:0,quarantined:0,rejected:0},runs:[],starting:[],preparations:[]};
 else if(url.pathname==='/api/runs')data={items:[],next_before:null};
 else if(url.pathname==='/api/catalog/cables'){let b='';req.on('data',x=>b+=x);req.on('end',()=>{saved=JSON.parse(b).data;require('../tools/simulator/dist/cable-model').validateCable(saved);res.end(JSON.stringify({id,version:1,data:saved}));});return;}
 res.end(JSON.stringify(data));return;}
 const target=path.join(web,url.pathname==='/'?'index.html':url.pathname);if(!target.startsWith(web)||!fs.existsSync(target)){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type',target.endsWith('.js')?'text/javascript':target.endsWith('.css')?'text/css':target.endsWith('.png')?'image/png':'text/html; charset=utf-8');res.end(fs.readFileSync(target));
});
const sleep=n=>new Promise(r=>setTimeout(r,n));
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const profile=fs.mkdtempSync(path.join(out,'chrome-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--window-size=1280,1000','about:blank'],{stdio:'ignore'});
let ws;
try{for(let i=0;i<50&&!fs.existsSync(path.join(profile,'DevToolsActivePort'));i++)await sleep(100);const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0].trim();const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);let n=1;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}};const send=(method,params={})=>new Promise((resolve,reject)=>{const id=n++;pending.set(id,m=>m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result));ws.send(JSON.stringify({id,method,params}));});const js=async expression=>{const x=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(x.exceptionDetails)throw Error(JSON.stringify(x.exceptionDetails));return x.result.value;};
await send('Page.enable');await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/#cable'});await sleep(1200);
await js('refreshModels()');
fs.writeFileSync(path.join(out,'before.txt'),await js('document.body.innerText'));
// Exercise the actual editor and click handlers with a stubbed platform catalog.
await js(`document.querySelector('#cable-list [data-model-action=edit]').click(); cableForm.elements.length_m.value='100'; document.getElementById('random-count').value='6'; document.getElementById('random-generate').click();`);
assert.equal(await js("document.getElementById('cable-dialog').open"),true);assert.match(await js("document.getElementById('random-result').textContent"),/已追加 6/);assert.equal(await js('defects.length'),6);
await js(`document.querySelector('#random-generate').closest('details').open=true; document.getElementById('random-count').value='20';document.getElementById('random-generate').click();`);
assert.match(await js("document.getElementById('random-result').textContent"),/最多20段/);assert.equal(await js('defects.length'),6);
await js(`cableForm.elements.reason.value='SH02 浏览器隔离测试';cableForm.requestSubmit();`);await sleep(400);assert.equal(saved?.defects.length,6);
await js(`document.querySelector('#cable-list [data-model-action=edit]').click(); document.querySelector('#random-generate').closest('details').open=true;`);
for(const width of [1280,1920]){await send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});await sleep(150);const shot=await send('Page.captureScreenshot',{format:'png'});fs.writeFileSync(path.join(out,'random-'+width+'.png'),Buffer.from(shot.data,'base64'));}
fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({browser:'Chrome headless',mode:'actual simulator UI with isolated mock platform API',generated:saved.defects.length,savedAndReadBack:true,widths:[1280,1920]},null,2));console.log('browser: generated 6, rejected overflow, saved/read back; 1280/1920 screenshots');
}finally{ws?.close();chrome.kill();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
