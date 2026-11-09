import test from 'node:test';
import assert from 'node:assert/strict';
import {OvalityTimeseries} from '../../apps/platform/modules/m04-measurements/timeseries';
import {workload} from '../../apps/platform/composition/workload-gateway';
test('PERF03 workload routes keep reporting off ingestion and online',()=>{
 assert.equal(workload('/api/v1/reporting/reports:generate'),'reports');
 assert.equal(workload('/api/v1/measurements:ingest'),'ingest');
 assert.equal(workload('/api/v1/measurements?task_id=x'),'online');
});
test('PERF03 batch acknowledgement, stable replay and failed-write retry',async()=>{
 Object.assign(process.env,{OVALITY_INFLUX_URL:'http://localhost',OVALITY_INFLUX_ORG:'test',OVALITY_INFLUX_BUCKET:'test',OVALITY_INFLUX_TOKEN:'test'});
 const ts=new OvalityTimeseries(),original=globalThis.fetch;let calls:string[]=[],fail=false;
 globalThis.fetch=async(_url,init)=>{calls.push(String(init?.body));return new Response(null,{status:fail?503:204});};
 try{
 const points=Array.from({length:50},(_,i)=>ts.prepare('f','d',String(i),'hash',{sample_time:'2026-11-09T01:00:00.123456Z'},'1.25'));
 await ts.writePrepared(points);assert.equal(calls.length,1);assert.equal(calls[0].trim().split('\n').length,50);
 const before=calls[0];await ts.writePrepared(points);assert.equal(calls[1],before);
 fail=true;await assert.rejects(ts.writePrepared(points));fail=false;await ts.writePrepared(points);assert.equal(calls.at(-1),before);
 assert.equal(points[0].reference.sample_ns,'1794186000123456000');
 }finally{globalThis.fetch=original;}
});
test('PERF03 rejects unsupported timestamps before a write',()=>{assert.throws(()=>new OvalityTimeseries().prepare('f','d','r','h',{sample_time:'bad'},'1'));});
import {createServer} from 'node:http';
import {once} from 'node:events';
import {startGateway} from '../../apps/platform/composition/workload-gateway';
test('PERF03 report saturation does not block online; upstream outage is retryable',async()=>{
 const held:any[]=[];
 const upstream=createServer((req,res)=>{if(req.url?.includes('reporting'))held.push(res);else res.end('online');});upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const port=(upstream.address() as any).port,gateway=startGateway({online:port,ingest:port,reports:port},0,'127.0.0.1');await once(gateway,'listening');const base='http://127.0.0.1:'+(gateway.address() as any).port;
 try{
 const first=fetch(base+'/api/v1/reporting/preview'),second=fetch(base+'/api/v1/reporting/preview');
 for(let i=0;held.length<2&&i<100;i++)await new Promise(r=>setTimeout(r,10));assert.equal(held.length,2);
 const rejected=await fetch(base+'/api/v1/reporting/preview');assert.equal(rejected.status,503);assert.equal(rejected.headers.get('retry-after'),'2');
 assert.equal(await (await fetch(base+'/api/v1/tasks')).text(),'online');
 held.forEach(r=>r.end('done'));await Promise.all([first,second]);
 upstream.closeAllConnections();await new Promise<void>(r=>upstream.close(()=>r()));assert.equal((await fetch(base+'/api/v1/tasks')).status,503);
 }finally{held.forEach(r=>r.end());gateway.closeAllConnections();gateway.close();upstream.closeAllConnections();upstream.close();}
});
