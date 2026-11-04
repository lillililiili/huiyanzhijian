'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {OVERLAP,GAP,testConfig,validateQuery,mapRecord}=require('../../adapters/inspur/http/contract.cjs');
const folder=path.resolve(__dirname,'../../临时文件夹/开发规划新');
function examples(name,language){const text=fs.readFileSync(path.join(folder,name),'utf8');return [...text.matchAll(new RegExp('```'+language+'\\s*\\n([\\s\\S]*?)```','g'))].map(m=>JSON.parse(m[1].split('\n').map(line=>line.replace(/\s+\/\/.*$/,'')).join('\n')));}
function context(metric){return {lineId:'1',metric,device_id:'test-device',capture_session_id:'test-capture',capture_sequence:'1',task_id:'test-task'};}
test('actual supplied overlap example retains null percentage, URL, timestamp and complete vendor row',()=>{
 const name='金属屏蔽搭盖率数据接口文档.md',response=examples(name,'jsonc')[0],request=examples(name,'json')[0];
 validateQuery(request,OVERLAP);assert.equal(response.count,508740);
 const mapped=mapRecord(response.data[0],context(OVERLAP),testConfig(OVERLAP));
 assert.equal(mapped.values[0].value,null);assert.equal(mapped.data_status,'MISSING');assert.equal(Date.parse(mapped.sample_time),1715303857000);assert.equal(mapped.position_m,'1');assert.deepEqual(JSON.parse(mapped.raw.data.vendor_record_json),response.data[0]);
});
test('actual supplied gap zero is valid under explicit mm test config; PITCH is never imported as gap',()=>{
 const name='铜丝屏蔽间隙测量数据接口文档.md',responses=examples(name,'jsonc'),requests=examples(name,'json');
 for(const q of requests)validateQuery(q,GAP);
 const mapped=mapRecord(responses[0].data[0],context(GAP),testConfig(GAP));assert.equal(mapped.values[0].value,'0');assert.equal(mapped.data_status,'VALID');assert.deepEqual(JSON.parse(mapped.raw.data.vendor_record_json),responses[0].data[0]);
 assert.throws(()=>mapRecord(responses[1].data[0],context(GAP),testConfig(GAP)),/PITCH_NOT_WIRE_GAP/);
 const unknown=mapRecord(responses[0].data[0],context(GAP),{...testConfig(GAP),gapUnit:'UNKNOWN'});assert.equal(unknown.values[0].value,null);assert.equal(unknown.data_status,'INVALID');
});
