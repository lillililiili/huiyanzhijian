'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('node:http'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {queryAll}=require('../../adapters/inspur/http/client.cjs');
const {Collector}=require('../../adapters/inspur/http/collector.cjs');
const {testConfig,OVERLAP}=require('../../adapters/inspur/http/contract.cjs');
const MAX=1048576;
async function server(t,handler){const s=createServer(handler);await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{s.close(resolve);s.closeAllConnections();}));return 'http://127.0.0.1:'+s.address().port;}
async function read(req){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}
const q={lineId:'line',startTime:'2026-11-02 00:00:00',endTime:'2026-11-02 01:00:00',limit:2};
const row=id=>({id,lineId:'line'});

test('over-count final page never reaches the persistence callback',async t=>{
 const baseUrl=await server(t,async(req,res)=>{const input=JSON.parse(await read(req));res.end(JSON.stringify({code:200,success:true,msg:'',timestamp:'1',count:3,data:input.page===1?[row('1'),row('2')]:[row('3'),row('4')]}));});
 const saved=[];await assert.rejects(()=>queryAll({...testConfig(OVERLAP),baseUrl},q,rows=>saved.push(rows.map(r=>r.id))));assert.deepEqual(saved,[['1','2']]);
});
test('short intermediate page is refused before persistence or requesting the next offset',async t=>{
 let calls=0;const baseUrl=await server(t,async(req,res)=>{calls++;await read(req);res.end(JSON.stringify({code:200,success:true,msg:'',timestamp:'1',count:3,data:[row(String(calls))]}));});
 const saved=[];await assert.rejects(()=>queryAll({...testConfig(OVERLAP),baseUrl},q,rows=>saved.push(rows)));
 assert.equal(calls,1);assert.deepEqual(saved,[]);
});
test('correct full and short last page, and zero-record query, remain supported',async t=>{
 let empty=false;const baseUrl=await server(t,async(req,res)=>{const input=JSON.parse(await read(req));res.end(JSON.stringify({code:200,success:true,msg:'',timestamp:'1',count:empty?0:3,data:empty?[]:input.page===1?[row('1'),row('2')]:[row('3')]}));});
 const c={...testConfig(OVERLAP),baseUrl},saved=[];assert.equal(await queryAll(c,q,rows=>saved.push(...rows)),3);assert.deepEqual(saved.map(r=>r.id),['1','2','3']);empty=true;assert.equal(await queryAll(c,q,()=>{}),0);
});
async function collector(t,{size=8000,count=50,loseFirst=false}={}){
 const received=[],stored=new Map();let lost=false;
 const base=await server(t,async(req,res)=>{
  const bytes=await read(req);received.push(bytes.length);
  if(bytes.length>MAX){res.writeHead(413);res.end();return;}
  const payload=JSON.parse(bytes),items=payload.records.map((r,i)=>{
   const old=stored.get(r.record_id);if(old)assert.equal(old,JSON.stringify(r));else stored.set(r.record_id,JSON.stringify(r));
   return {input_index:i,source_id:r.record_id,receipt_status:old?'DUPLICATE':'STORED',initial_status:'STORED'};
  });
  if(loseFirst&&!lost){lost=true;res.destroy();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:'OK',data:{counts:{total:items.length},items}}));
 });
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hy-odm02-')),config={...testConfig(OVERLAP),baseUrl:base,platformUrl:base,platformTokenEnv:'ODM02_TEST_TOKEN',lineId:'line',deviceId:'device',expectedTaskId:'task',queueFile:path.join(directory,'outbox.sqlite')};
 const previous=process.env.ODM02_TEST_TOKEN;process.env.ODM02_TEST_TOKEN='isolated-test-token';t.after(()=>{if(previous===undefined)delete process.env.ODM02_TEST_TOKEN;else process.env.ODM02_TEST_TOKEN=previous;});
 let c=new Collector(config);const originals=[];
 for(let i=0;i<count;i++){const record={record_id:'record-'+i,capture_sequence:String(i+1),task_id:'task',raw:{data:{vendor_record_json:JSON.stringify({id:'source-'+i,customerNames:'线'.repeat(size),buildPercent:12})}}};const text=JSON.stringify(record);originals.push(text);c.db.prepare('INSERT INTO outbox(id,source_json,payload) VALUES(?,?,?)').run('source-'+i,'{}',text);}
 t.after(()=>c.close());return {get c(){return c;},restart(){c.close();c=new Collector(config);},received,stored,originals};
}
test('UTF-8 large raw records split below the real 1MiB HTTP limit; values and IDs unchanged',async t=>{
 const f=await collector(t);await f.c.drain();assert(f.received.length>1);assert(f.received.every(n=>n<=MAX));assert.equal(f.stored.size,50);
 assert.deepEqual(f.c.db.prepare('SELECT payload FROM outbox ORDER BY rowid').all().map(r=>r.payload),f.originals);
 assert.equal(f.c.db.prepare("SELECT count(*) n FROM outbox WHERE state='STORED'").get().n,50);
});
test('single oversized record remains pending and no impossible request is sent',async t=>{
 const f=await collector(t,{size:400000,count:1});await assert.rejects(()=>f.c.drain(),/PLATFORM_RECORD_TOO_LARGE/);
 assert.deepEqual(f.received,[]);const row=f.c.db.prepare('SELECT state,payload FROM outbox').get();assert.equal(row.state,'PENDING');assert.equal(row.payload,f.originals[0]);
});
test('split batch lost receipt and restart replay the same identities without losing the tail',async t=>{
 const f=await collector(t,{loseFirst:true});await assert.rejects(()=>f.c.drain());assert.equal(f.c.db.prepare("SELECT count(*) n FROM outbox WHERE state='PENDING'").get().n,50);
 f.restart();await f.c.drain();assert.equal(f.stored.size,50);assert(f.received.every(n=>n<=MAX));assert.equal(f.c.db.prepare("SELECT count(*) n FROM outbox WHERE state='STORED'").get().n,50);
});
test('small batches still use one request',async t=>{const f=await collector(t,{size:2,count:3});await f.c.drain();assert.equal(f.received.length,1);assert.equal(f.stored.size,3);});
