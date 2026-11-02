import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskLabels,taskBarcode,parseTaskBarcode} from '../../apps/platform/modules/m02-tasks/task-labels';
const id='ab123456-1234-4321-8111-abcdefabcdef',code=taskBarcode(id,'1');
const actor:any={kind:'DEVICE',factory:'factory-local',devices:['HY-BY-01'],environment:'SIMULATED',permissions:['device:ingest']};
function fixture(overrides:any={}){
 const t={id,device_id:'HY-BY-01',association_version:'1',state:'RUNNING',metric_code:'OVALITY',data_environment:'SIMULATED',planned_length_m:'100',context_snapshot:{specification:{code:'SP035-300'}},...overrides};
 return new TaskLabels({get:async()=>t,assignment:async()=>({assignment:{task_id:id,binding_id:'binding-1',snapshot_hash:'hash-1'}}),businessContexts:async()=>[{association_version:'1',external_code:'current-order',spool_code:'current-spool'}]} as any,{getDevice:async()=>({enabled:true})} as any);
}
test('task code roundtrip, UUID uniqueness and association revision',()=>{assert.deepEqual(parseTaskBarcode(code),{id,revision:'1'});assert.notEqual(code,taskBarcode(id,'2'));assert.throws(()=>parseTaskBarcode('HYT1junk'));assert.throws(()=>taskBarcode(id,'0'));});
test('device resolves current business context and existing binding without starting',async()=>{const l=await fixture().resolve(actor,'HY-BY-01',code);assert.match(l.barcode,/^HYOV1[0-9A-F]{20}$/);assert.equal(l.task_id,id);assert.equal(l.order.spool,'current-spool');assert.equal(l.order.code,'current-order');assert.equal(l.order.length,100);});
test('old revision, wrong device, ended/created/cancelled, other metrics and real source reject',async()=>{
 for(const overrides of [{association_version:'2'},{state:'CREATED'},{state:'ENDED'},{state:'CANCELLED'},{device_id:'OTHER'},{metric_code:'WIRE_GAP'},{data_environment:'REAL'}])await assert.rejects(fixture(overrides).resolve(actor,'HY-BY-01',code));
 await assert.rejects(fixture().resolve({...actor,devices:[]},'HY-BY-01',code));
 await assert.rejects(fixture().resolve({...actor,kind:'USER'},'HY-BY-01',code));
});
test('changed assignment is not silently switched to another task',async()=>{const f=fixture();(f as any).tasks.assignment=async()=>({assignment:{task_id:'other'}});await assert.rejects(f.resolve(actor,'HY-BY-01',code));});
test('printed identity resolves only inside credential device scope',async()=>{assert.equal((await fixture().resolveForCredential(actor,code)).device_id,'HY-BY-01');await assert.rejects(fixture().resolveForCredential({...actor,devices:['OTHER']},code));await assert.rejects(fixture().resolveForCredential({...actor,kind:'USER'},code));});
test('missing feed length is not silently replaced with a default',async()=>{for(const planned_length_m of [null,0,-1,'NaN',1e9])await assert.rejects(fixture({planned_length_m}).resolve(actor,'HY-BY-01',code));});
