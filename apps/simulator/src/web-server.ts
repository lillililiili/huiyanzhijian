import {createServer, type IncomingMessage, type ServerResponse} from 'node:http';
import {randomBytes, scryptSync, timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {WebManager,WebError,requireWeb,validId} from './web-manager';
import {ModelError} from './cable-model';

const password=process.env.SIM_WEB_PASSWORD||'',token=process.env.DEVICE_TOKEN||'';
if(password.length<(process.env.SIM_LOCAL_SIMPLE_PASSWORD==='true'?6:16)||!token)throw Error('SIM_WEB_PASSWORD (16+ characters) and DEVICE_TOKEN are required');
const salt=randomBytes(16),passwordHash=scryptSync(password,salt,32);
const apiUrl=process.env.API_URL||'http://127.0.0.1:4192',port=Number(process.env.SIM_WEB_PORT||4196);
const manager=new WebManager(resolve(process.env.SIM_DB||'../../runtime/simulator/simulator.sqlite'),apiUrl,token);
const webRoot=resolve(process.env.SIM_WEB_ROOT||'web');
const allowedHosts=new Set((process.env.SIM_ALLOWED_HOSTS||'127.0.0.1,localhost').split(','));
const sessions=new Map<string,{csrf:string;expires:number}>(),attempts=new Map<string,{count:number;expires:number}>();
const assets:Record<string,[string,string]>={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/models.js':['models.js','text/javascript; charset=utf-8'],'/device-status.js':['device-status.js','application/javascript; charset=utf-8'],'/catalog.js':['catalog.js','text/javascript; charset=utf-8'],'/live.js':['live.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/logo.png':['logo.png','image/png']};

function json(res:ServerResponse,status:number,data:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
async function body(req:IncomingMessage){
  requireWeb(req.headers['content-type']?.split(';')[0]==='application/json',415,'JSON_REQUIRED','请使用JSON请求');
  let size=0;const chunks:Buffer[]=[];
  for await(const part of req){size+=part.length;requireWeb(size<=32768,413,'BODY_TOO_LARGE','请求体超过限制');chunks.push(Buffer.from(part));}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new WebError(400,'INVALID_JSON','JSON格式错误');}
}
function cookie(req:IncomingMessage){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('sim_session='))?.slice(12)||'';}
function session(req:IncomingMessage){const value=sessions.get(cookie(req));requireWeb(value&&value.expires>Date.now(),401,'LOGIN_REQUIRED','请登录模拟器');return value!;}
function loginRate(req:IncomingMessage){
  const key=req.socket.remoteAddress||'unknown',now=Date.now();
  for(const [k,v] of attempts)if(v.expires<now)attempts.delete(k);
  const value=attempts.get(key)||{count:0,expires:now+60000};value.count++;attempts.set(key,value);
  requireWeb(value.count<=10,429,'LOGIN_RATE_LIMIT','登录尝试过多，请一分钟后重试');
}

const server=createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try {
    const host=req.headers.host||'',url=new URL(req.url||'/','http://'+host);
    requireWeb(allowedHosts.has(url.hostname),403,'HOST_DENIED','不允许的访问主机');
    if(req.method==='GET'&&url.pathname==='/health'){json(res,200,{ready:true,service:'huiyan-simulator',auto_capture:false});return;}
    if(req.method==='GET'&&assets[url.pathname]){const [file,type]=assets[url.pathname];res.writeHead(200,{'Content-Type':type});res.end(readFileSync(resolve(webRoot,file)));return;}
    requireWeb(url.pathname.startsWith('/api/'),404,'NOT_FOUND','页面不存在');
    if(req.method==='POST')requireWeb(!req.headers.origin||req.headers.origin==='http://'+host||req.headers.origin==='https://'+host,403,'ORIGIN_DENIED','跨站操作被拒绝');
    if(req.method==='POST'&&url.pathname==='/api/login'){
      loginRate(req);const input=await body(req);
      requireWeb(input&&input.username==='admin'&&typeof input.password==='string'&&input.password.length<=256,401,'BAD_CREDENTIALS','账号或密码不正确');
      requireWeb(timingSafeEqual(passwordHash,scryptSync(input.password,salt,32)),401,'BAD_CREDENTIALS','账号或密码不正确');
      for(const [id,s] of sessions)if(s.expires<Date.now())sessions.delete(id);
      requireWeb(sessions.size<100,429,'SESSION_LIMIT','活动会话过多');
      const id=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');sessions.set(id,{csrf,expires:Date.now()+8*3600000});
      res.setHeader('Set-Cookie',`sim_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${process.env.SIM_COOKIE_SECURE==='true'?'; Secure':''}`);
      json(res,200,{csrf,username:'admin'});return;
    }
    const current=session(req);
    if(req.method==='GET'&&url.pathname==='/api/session'){json(res,200,{csrf:current.csrf,username:'admin',api_url:apiUrl,platform_url:process.env.SIM_PLATFORM_URL||''});return;}
    if(req.method==='GET'&&url.pathname==='/api/production-events'){json(res,200,manager.productionHistory());return;}
    if(req.method==='GET'&&url.pathname==='/api/state'){json(res,200,manager.state());return;}
    if(req.method==='GET'&&url.pathname==='/api/devices'){json(res,200,await manager.devices());return;}
    if(req.method==='GET'&&url.pathname==='/api/ui-config'){json(res,200,{platform_url:process.env.SIM_PLATFORM_URL||''});return;}
    if(req.method==='GET'&&url.pathname==='/api/catalog'){json(res,200,await manager.catalog(Object.fromEntries(url.searchParams)));return;}
    const historyMatch=url.pathname.match(/^\/api\/models\/(cables|detectors)\/([a-f0-9-]{36})\/history$/);
    if(req.method==='GET'&&historyMatch){json(res,200,manager.models.history(historyMatch[1],historyMatch[2],Number(url.searchParams.get('page')||1)));return;}
    const modelMatch=url.pathname.match(/^\/api\/models\/(cables|detectors)$/);
    if(req.method==='GET'&&modelMatch){json(res,200,manager.models.list(modelMatch[1]));return;}
    const passMatch=url.pathname.match(/^\/api\/passes\/([A-Za-z0-9._:-]+)(?:\/(finish|speed))?$/);
    if(req.method==='GET'&&passMatch&&!passMatch[2]){const result=manager.models.comparison(passMatch[1]);requireWeb(result,404,'PASS_NOT_FOUND','过料不存在');json(res,200,result);return;}
    const match=url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/(control))?$/);
    if(match)requireWeb(validId(match[1]),400,'INVALID_ID','运行ID格式错误');
    if(req.method==='GET'&&match&&!match[2]){
      const before=Number(url.searchParams.get('before')||0);requireWeb(Number.isSafeInteger(before)&&before>=0,400,'INVALID_CURSOR','分页位置无效');json(res,200,manager.detail(match[1],before));return;
    }
    if(req.method==='POST'){
      requireWeb(req.headers['x-sim-csrf']===current.csrf,403,'CSRF_DENIED','操作校验失败，请刷新页面重新登录');
      const input=await body(req);
      if(url.pathname==='/api/logout'){sessions.delete(cookie(req));res.setHeader('Set-Cookie','sim_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');json(res,200,{logged_out:true});return;}
      if(url.pathname==='/api/production-events'){json(res,200,await manager.production(input));return;}
      const catalogMatch=url.pathname.match(/^\/api\/catalog\/(cables|detectors)$/);if(catalogMatch){json(res,200,await manager.saveCatalog(catalogMatch[1],input));return;}
      if(modelMatch){json(res,200,manager.models.save(modelMatch[1],input));return;}
      if(url.pathname==='/api/passes'){json(res,202,await manager.createPass(input));return;}
      if(passMatch?.[2]==='speed'){json(res,200,manager.changeSpeed(passMatch[1],input));return;}
      if(passMatch?.[2]==='finish'){json(res,200,await manager.finishPass(passMatch[1]));return;}
      if(url.pathname==='/api/runs'){json(res,202,await manager.create(input));return;}
      if(match?.[2]){requireWeb(input&&Object.keys(input).length===1&&typeof input.action==='string',400,'INVALID_ACTION','请指定控制操作');json(res,200,manager.control(match[1],input.action));return;}
    }
    throw new WebError(404,'NOT_FOUND','接口不存在');
  }catch(e){
    const known=e instanceof WebError||e instanceof ModelError;
    json(res,known?e.status:500,{code:known?e.code:'INTERNAL_ERROR',message:known?e.message:'操作未完成，请查看运行日志；已有队列保留'});
    if(!known)console.error(JSON.stringify({event:'SIM_WEB_REQUEST_ERROR',time:new Date().toISOString()}));
  }
});
server.requestTimeout=15000;server.headersTimeout=10000;
server.listen(port,process.env.SIM_WEB_BIND||'127.0.0.1',()=>console.log(JSON.stringify({event:'SIM_WEB_READY',port,auto_capture:false})));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,async()=>{
  if(stopping)return;stopping=true;server.close();await manager.close();server.closeAllConnections();
});
