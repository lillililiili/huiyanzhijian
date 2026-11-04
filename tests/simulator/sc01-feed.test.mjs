import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
const require=createRequire(import.meta.url),{WebManager}=require('../../tools/simulator/dist/web-manager.js');

test('SC01R1 feeding uses current edge binding without a barcode or scan command',async()=>{
 const dir=mkdtempSync(tmpdir()+'/sc01-feed-'),m=new WebManager(dir+'/test.sqlite','http://localhost:1','test');
 const savedFetch=globalThis.fetch,priorUrl=process.env.OVALITY_EDGE_URL,priorToken=process.env.OVALITY_EDGE_INBOUND_TOKEN;
 try{
  process.env.OVALITY_EDGE_URL='http://localhost:44798';process.env.OVALITY_EDGE_INBOUND_TOKEN='test';
  const body={binding_id:'binding',metric_code:'OVALITY',spool_id:'spool',task_id:'task'};
  const assignment={...body,snapshot_hash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
  m.client.request=async path=>({data:path==='/ingestion/profile'?{data_environment:'SIMULATED',devices:[{device_id:'HY-BY-01',metric_codes:['OVALITY']}]}:{assignment}});
  m.models.snapshot=()=>({cable:{id:randomUUID(),data:{material_ref:'fixture'}},detector:{data:{device_id:'HY-BY-01',metric:'OVALITY',meter_delay_ms:'100'}},count:8,interval_ms:100});
  let launches=0,requests=[];
  m.launch=(run_id)=>{launches++;return{run_id}};
  const ready={state:'RUNNING',run:{id:'edge-run',taskId:'task',bindingId:'binding',config:{deviceId:'HY-BY-01',sync:{distanceMm:200,revision:'1'}}}};
  let edge=ready;
  globalThis.fetch=async(url,options)=>{requests.push([String(url),options.method]);assert.equal(String(url),'http://localhost:44798/edge/v1/scanner-state');assert.equal(options.method,'GET');return new Response(JSON.stringify(edge),{status:200})};
  const input=()=>({request_id:randomUUID(),cable_id:randomUUID(),cable_version:1,detector_id:randomUUID(),detector_version:1,mode:'BOUND',task_id:'task',spool_id:'spool'});
  const result=await m.createPass(input());assert.equal(launches,1);assert.equal(requests.length,1);
  assert.equal(m.models.pass(result.run_id).snapshot.edge_sync.runId,'edge-run');
  for(const change of [{state:'WAITING_SCAN'},{state:'PAUSED'},{run:{...ready.run,taskId:'other'}},{run:{...ready.run,bindingId:'stale'}},{run:{...ready.run,config:{...ready.run.config,deviceId:'other'}}}]){
   edge={...ready,...change};await assert.rejects(m.createPass(input()));assert.equal(launches,1);
  }
  globalThis.fetch=async()=>{throw Error('offline')};await assert.rejects(m.createPass(input()),/offline/);assert.equal(launches,1);
 }finally{
  globalThis.fetch=savedFetch;if(priorUrl===undefined)delete process.env.OVALITY_EDGE_URL;else process.env.OVALITY_EDGE_URL=priorUrl;if(priorToken===undefined)delete process.env.OVALITY_EDGE_INBOUND_TOKEN;else process.env.OVALITY_EDGE_INBOUND_TOKEN=priorToken;
  m.queue.db.close();rmSync(dir,{recursive:true});
 }
});
