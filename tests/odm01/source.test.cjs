const test=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),{createServer}=require('node:http');
process.env.INSPUR_ADAPTER_ROOT=require('node:path').resolve(__dirname,'../../adapters/inspur/http');
const {initVendorStore,prepareVendorSample,vendorQuery,readVendorMeasurements}=require('../../tools/simulator/dist/vendor-http');
const {testConfig,OVERLAP,mapRecord}=require('../../adapters/inspur/http/contract.cjs');
const {record}=require('../../tools/simulator/dist/scenarios');
test('same-metric devices, separate captures and tasks never cross the source query',async()=>{
 const db=new DatabaseSync(':memory:');initVendorStore(db);const make=(device,capture,task,n)=>record({id:device+'-'+capture,device_id:device,capture_session:capture,scenario:'normal',seed:0,assignment:JSON.stringify({metric_code:OVERLAP,task_id:task,binding_id:'b-'+task,binding_version:'1',recipe_version_id:'recipe'})},n,'2026-11-02T10:00:00.000Z');
 try{const a=prepareVendorSample(db,make('DG-1','a','task-a',1)),b=prepareVendorSample(db,make('DG-2','a','task-b',1)),c=prepareVendorSample(db,make('DG-1','c','task-c',1));const q={lineId:'a',startTime:'2026-11-02 18:00:00',endTime:'2026-11-02 18:00:00',limit:1,page:1};
  assert.equal(vendorQuery(db,OVERLAP,'DG-1',q).data[0].id,a.record_id);assert.equal(vendorQuery(db,OVERLAP,'DG-2',q).data[0].id,b.record_id);assert.equal(vendorQuery(db,OVERLAP,'DG-1',{...q,lineId:'c'}).data[0].id,c.record_id);
  assert.deepEqual(await readVendorMeasurements(db,[a,b,c]),[a,b,c]);assert.equal(vendorQuery(db,OVERLAP,'unknown',q).count,0);
 }finally{db.close();}
});
test('nullable overlap percentage stays missing without a zero replacement',()=>{
 const db=new DatabaseSync(':memory:');initVendorStore(db);try{const sample=record({id:'r',device_id:'DG',capture_session:'s',scenario:'normal',seed:0,assignment:JSON.stringify({metric_code:OVERLAP})},1);prepareVendorSample(db,sample);const saved=db.prepare('SELECT wire_json,context_json FROM vendor_http_sample').get();const row=JSON.parse(saved.wire_json);row.buildPercent=null;const mapped=mapRecord(row,JSON.parse(saved.context_json),testConfig(OVERLAP));assert.equal(mapped.data_status,'MISSING');assert.equal(mapped.values[0].value,null);}finally{db.close();}
});
