import {createServer,request} from 'node:http';
export type Workload='online'|'ingest'|'reports';
export function workload(url:string):Workload{
 const path=url.split('?')[0].replace(/\/$/,'');
 if(/^\/api\/v1\/tasks\/[^/:]+:end$/.test(path))return 'reports';
 if(/^\/api\/v1\/(reporting|reports|quality-reports)(\/|:|$)/.test(path))return 'reports';
 if(/^\/api\/v1\/(measurements:ingest|ingestion\/|device-sessions|device-status:heartbeat|production-events|receipts:query)/.test(path))return 'ingest';
 return 'online';
}
export function startGateway(ports:Record<Workload,number>,port:number,host:string){
 const active:Record<Workload,number>={online:0,ingest:0,reports:0};
 const limits:Record<Workload,number>={online:40,ingest:12,reports:2};
 const server=createServer((req,res)=>{
  const role=workload(req.url||'/');
  const fail=()=>{if(!res.headersSent){res.writeHead(503,{'Content-Type':'application/json','Retry-After':'2'});res.end(JSON.stringify({code:'DEPENDENCY_UNAVAILABLE',message:'服务繁忙或正在恢复，请保留原请求标识重试'}));}else res.destroy();};
  if(active[role]>=limits[role]){fail();req.resume();return;}
  active[role]++;let done=false;
  const release=()=>{if(!done){done=true;active[role]--;}};
  const upstream=request({host:'127.0.0.1',port:ports[role],method:req.method,path:req.url,headers:req.headers},reply=>{res.writeHead(reply.statusCode||502,reply.headers);reply.on('error',()=>res.destroy());reply.pipe(res);});
  upstream.setTimeout(role==='reports'?120000:30000,()=>upstream.destroy(new Error('timeout')));
  upstream.on('error',fail);req.on('aborted',()=>upstream.destroy());
  res.on('close',()=>{release();upstream.destroy();});req.pipe(upstream);
 });
 server.headersTimeout=15000;server.requestTimeout=120000;
 server.listen(port,host);return server;
}
