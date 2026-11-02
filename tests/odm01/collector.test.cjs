const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),p=require('node:path'),{createServer}=require('node:http');
const {Collector}=require('../../adapters/inspur/http/collector.cjs');
const {testConfig,OVERLAP}=require('../../adapters/inspur/http/contract.cjs');
test('durable source worker: lost receipt, restart, duplicate, conflicting raw and frozen task mapping',async()=>{
 const dir=fs.mkdtempSync(p.join(os.tmpdir(),'hy-odm01-')),queueFile=p.join(dir,'queue.sqlite');let sourceId='source-1',scalar=15,sends=0,lost=true,wrong=false;const stored=new Set();
 const row=()=>({id:sourceId,lineId:'external-order',workTableTeam:'A',customerNames:'TEST',dataDate:'2026-11-02',dataTime:'10:00:00',seat:1,buildWidth:3,createTime:'2026-11-02 10:00:00',buildPicPath:'',angle:0,coreDiameter:20,coreSpeed:1,controlStatus:0,dataCreateTime:'1793584800000',buildPercent:scalar});
 const server=createServer(async(req,res)=>{let text='';for await(const part of req)text+=part;const b=text?JSON.parse(text):null;let data;
  if(req.url.includes('/sys/')){res.end(JSON.stringify({code:200,success:true,msg:'ok',timestamp:'123',count:1,data:[row()]}));return;}
  if(req.url.endsWith('/ingestion/profile'))data={data_environment:'SIMULATED',devices:[{device_id:'dev-1',raw_schema_versions:['inspur-overlap-http.v1']}]};
  else if(req.url.endsWith('/assignment'))data={assignment:{task_id:'task-1',metric_code:OVERLAP,binding_id:'binding-1',binding_version:'1',recipe_version_id:'recipe-1',snapshot_hash:'hash',rule_snapshot:{method_id:'test-dg'}}};
  else if(req.url.endsWith('/device-sessions'))data={connection_id:'connection-1'};
  else if(req.url.endsWith('/assignment-acks'))data={accepted:true};
  else if(req.url.endsWith('/measurements:ingest')){
   sends++;const r=b.records[0],duplicate=stored.has(r.record_id);stored.add(r.record_id);
   if(lost){res.destroy();return;}
   data={counts:{total:1,stored:duplicate?0:1,duplicate:duplicate?1:0,quarantined:0,rejected:0},items:[{input_index:0,source_id:wrong?'wrong-id':r.record_id,receipt_status:duplicate?'DUPLICATE':'STORED',initial_status:'STORED'}]};
  }
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'OK',data}));
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 process.env.ODM01_TEST_TOKEN='isolated';const config={...testConfig(OVERLAP),baseUrl:base,platformUrl:base,platformTokenEnv:'ODM01_TEST_TOKEN',deviceId:'dev-1',lineId:'external-order',expectedTaskId:'task-1',queueFile,startTime:'2026-11-02 00:00:00',endTime:'2026-11-02 23:59:59'};
 let c=new Collector(config);
 try{
  await assert.rejects(()=>c.collect());assert.equal(c.db.prepare('SELECT state FROM outbox').get().state,'PENDING');const payload=c.db.prepare('SELECT payload FROM outbox').get().payload;c.close();
  lost=false;c=new Collector(config);const result=await c.collect();assert.equal(result[0].state,'STORED');assert.equal(stored.size,1);assert.equal(sends,2);assert.equal(c.db.prepare('SELECT payload FROM outbox').get().payload,payload);
  scalar=20;await assert.rejects(()=>c.collect(),/CONTENT_CONFLICT/);assert.equal(c.db.prepare('SELECT payload FROM outbox').get().payload,payload);
  scalar=15;sourceId='source-2';wrong=true;await assert.rejects(()=>c.collect(),/IDENTITY_INVALID/);assert.equal(c.db.prepare("SELECT count(*) AS n FROM outbox WHERE state='PENDING'").get().n,1);
  c.close();c=new Collector({...config,expectedTaskId:'other-task'});await assert.rejects(()=>c.bind(),/CONFIG_CONFLICT/);
 }finally{c.close();await new Promise(r=>server.close(r));}
});
