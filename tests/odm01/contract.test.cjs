const test=require('node:test'),assert=require('node:assert/strict'),{createServer}=require('node:http');
const {OVERLAP,GAP,testConfig,mapRecord,validateQuery,validateConfig,decimal}=require('../../adapters/inspur/http/contract.cjs');
const {queryAll,parseVendorJson}=require('../../adapters/inspur/http/client.cjs');
const fixture=(extra={})=>({id:'vendor-1',workTableTeam:'A',customerNames:'客户',lineId:'contract-1',voltageLevel:null,processStandard:null,dataDate:'2026-11-02',dataTime:'10:00:00',seat:1.25,buildWidth:2.5,createTime:'2026-11-02 09:00:00',buildPicPath:'http://device.example/image/one.jpg',dataCreateTime:'1793584800123',coreSpeed:10.1,copperStripSpecs:null,processCappingWidth:null,stripWidth:20,buildPercent:12.5,angle:7.66,coreDiameter:7,controlStatus:0,x1:12,y1:13,x2:null,y2:null,x0:null,y0:null,horspace:null,toleranceTop:null,toleranceBottom:null,...extra});
const context=(metric=OVERLAP)=>({lineId:'contract-1',metric,device_id:'HY-DG-01',capture_session_id:'capture-1',capture_sequence:'1',task_id:'task-1',binding_id:'bind-1',binding_version:'1',recipe_version_id:'DG-V1.0',method_id:'test-dg'});
test('vendor raw decimal fields survive, scalar and image retain same identity',()=>{const r=fixture(),m=mapRecord(r,context(),testConfig(OVERLAP));assert.equal(m.values[0].value,'12.5');assert.deepEqual(JSON.parse(m.raw.data.vendor_record_json),r);assert.equal(m.position_m,'1.25');assert.equal(m.values[0].source_quality_result,'NOT_EVALUATED');assert.equal(m.source_record_id,r.id);assert.deepEqual(m.evidence_refs,[]);});
test('null rate is missing and never derived from width',()=>{const m=mapRecord(fixture({buildPercent:null}),context(),testConfig(OVERLAP));assert.equal(m.values[0].value,null);assert.equal(m.data_status,'MISSING');});
test('real zero preserved',()=>assert.equal(mapRecord(fixture({buildPercent:0}),context(),testConfig(OVERLAP)).values[0].value,'0'));
test('fraction explicitly scaled without binary multiplication',()=>assert.equal(mapRecord(fixture({buildPercent:0.12345678901}),context(),{...testConfig(OVERLAP),percentScale:'FRACTION'}).values[0].value,'12.345678901'));
test('unknown scale has no usable value',()=>{const m=mapRecord(fixture(),context(),{...testConfig(OVERLAP),percentScale:'UNKNOWN'});assert.equal(m.values[0].value,null);assert.equal(m.data_status,'INVALID');});
test('gap selects buildWidth and explicit unit',()=>{const m=mapRecord(fixture({dataType:'GAP',buildWidth:0.3}),context(GAP),{...testConfig(GAP),gapUnit:'cm'});assert.equal(m.values[0].value,'3');assert.equal(m.values[0].unit,'mm');});
test('PITCH never enters WIRE_GAP',()=>assert.throws(()=>mapRecord(fixture({dataType:'PITCH'}),context(GAP),testConfig(GAP)),/PITCH/));
test('line mapping cannot silently switch task',()=>assert.throws(()=>mapRecord(fixture({lineId:'other'}),context(),testConfig(OVERLAP)),/CONTEXT/));
test('unknown real transport cannot be enabled',()=>assert.throws(()=>validateConfig({...testConfig(OVERLAP),environment:'REAL'}),/UNCONFIRMED/));
test('different source IDs with same values produce different stable keys',()=>{assert.notEqual(mapRecord(fixture(),context(),testConfig(OVERLAP)).record_id,mapRecord(fixture({id:'vendor-2'}),context(),testConfig(OVERLAP)).record_id);});
test('capture timestamp explicit; createTime not used',()=>{const m=mapRecord(fixture(),context(),testConfig(OVERLAP));assert.equal(Date.parse(m.sample_time),1793584800123);});
test('date field may explicitly use UTC+08, impossible date rejected',()=>{const c={...testConfig(OVERLAP),sampleTimeField:'dataDate+dataTime'};assert.equal(mapRecord(fixture(),context(),c).sample_time,'2026-11-02T02:00:00.000Z');assert.throws(()=>mapRecord(fixture({dataDate:'2026-02-30'}),context(),c),/DATE/);});
test('null required gap scalar is retained but invalid',()=>{const m=mapRecord(fixture({dataType:'GAP',buildWidth:null}),context(GAP),testConfig(GAP));assert.equal(m.values[0].value,null);assert.equal(m.data_status,'INVALID');});
test('unrepresentable precision is invalid instead of rounded into pass',()=>{const m=mapRecord(fixture({buildPercent:1.23456789012}),context(),testConfig(OVERLAP));assert.equal(m.data_status,'INVALID');assert.equal(m.values[0].value,null);});
test('decimal handles exponents and zero without invented precision',()=>{assert.equal(decimal(1e-7),'0.0000001');assert.equal(decimal(0.29,2),'29');assert.equal(decimal(-0),'0');});
test('query rejects missing discriminator, extra fields and bad paging',()=>{const q={lineId:'x',startTime:'2026-11-02 00:00:00',endTime:'2026-11-02 01:00:00',page:1,limit:10};assert.throws(()=>validateQuery(q,GAP));assert.throws(()=>validateQuery({...q,page:0},OVERLAP));assert.throws(()=>validateQuery({...q,taskId:'x'},OVERLAP));});
test('HTTP pagination uses total count, preserves page identity and detects business errors',async()=>{
 let mode='normal',requests=[];const server=createServer(async(req,res)=>{let input='';for await(const p of req)input+=p;const q=JSON.parse(input);requests.push(q);const rows=q.page===1?[fixture()]:[fixture({id:'vendor-2'})];res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:mode==='error'?500:200,success:mode!=='error',msg:'ok',timestamp:'123',count:2,data:mode==='duplicate'?[fixture()]:rows}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const c={...testConfig(OVERLAP),baseUrl:'http://127.0.0.1:'+server.address().port},q={lineId:'contract-1',startTime:'2026-11-02 00:00:00',endTime:'2026-11-02 23:00:00',limit:1};
 try{const got=[];assert.equal(await queryAll(c,q,r=>got.push(...r)),2);assert.deepEqual(requests.map(q=>q.page),[1,2]);assert.deepEqual(got.map(r=>r.id),['vendor-1','vendor-2']);mode='error';await assert.rejects(()=>queryAll(c,q,()=>{}),/BUSINESS/);mode='duplicate';await assert.rejects(()=>queryAll(c,q,()=>{}),/DUPLICATE/);}finally{await new Promise(r=>server.close(r));}
});
module.exports={fixture,context};
test('unsafe wire decimals and integers cannot silently round into a passing value',()=>{
 assert.throws(()=>parseVendorJson('{"value":0.10000000000000001}'),/UNSAFE/);
 assert.throws(()=>parseVendorJson('{"value":9007199254740993}'),/UNSAFE/);
 assert.throws(()=>parseVendorJson('{"value":1e999}'),/UNSAFE/);
 assert.deepEqual(parseVendorJson('{"value":3.0000000001,"id":"9007199254740993"}'),{value:3.0000000001,id:'9007199254740993'});
});
