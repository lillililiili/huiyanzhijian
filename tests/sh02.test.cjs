const {test}=require('node:test');const assert=require('node:assert/strict');
const {generateRandomDefects}=require('../tools/simulator/web/random-defects');
const {detect}=require('../tools/simulator/dist/device-model');
const {validateCable,observeCable,fixed}=require('../tools/simulator/dist/cable-model');
const {validateOvalityObservation}=require('../apps/platform/dist/modules/m04-measurements/api');
const {RuleApi}=require('../apps/platform/dist/modules/m03-rules/api');
const {validate}=require('../apps/platform/dist/infrastructure/schema');
const base={tape_width_mm:'20',overlap_width_mm:'2.5',wire_gap_mm:'1.25',diameter_x_mm:'40',diameter_y_mm:'40'};
const d={metric:'OVALITY',lower:'0.95',upper:''};
test('roundness equality, axes symmetry, zero invalid and precision',()=>{
 assert.equal(detect(d,base,'roundness-min-max.v1').value,'1');
 for(const [x,y] of [['40','50'],['50','40']])assert.equal(detect(d,{...base,diameter_x_mm:x,diameter_y_mm:y},'roundness-min-max.v1').value,'0.8');
 assert.throws(()=>detect(d,{...base,diameter_x_mm:'0'},'roundness-min-max.v1'));
 assert.equal(detect(d,{...base,diameter_y_mm:'50'},'legacy-percent').unit,'%');
});
test('M04 consistency and M03 threshold include equality, reject wrong ratio',()=>{
 const rule={approval_state:'TEST_ONLY',method_id:'roundness-min-max.v1',comparison:{operator:'GE',lower:'0.95',upper:null},parameters:{unit:'1'}};
 for(const [value,result] of [['0.95','PASS'],['0.9499999999','FAIL']])assert.equal(new RuleApi().evaluate({value,unit:'1',data_status:'VALID',method_id:rule.method_id},rule,'SIMULATED').quality_result,result);
 const r={data_status:'VALID',values:[{metric_code:'OVALITY',method_id:rule.method_id,value:'0.8',unit:'1'}],raw:{data:{observation:{diameter_x_mm:'40',diameter_y_mm:'50'}}}};
 validateOvalityObservation(r);r.values[0].value='0.81';assert.throws(()=>validateOvalityObservation(r));r.raw.data.observation={};assert.throws(()=>validateOvalityObservation(r));
});
test('100 seeds: bounded non-overlap, deterministic smooth sampling and legacy constant',()=>{
 for(let seed=0;seed<100;seed++){
 const opts={length:100,count:20,seed,metric:'ALL',baseline:base,minLength:0.2,maxLength:2,strength:20};
 const defects=generateRandomDefects(opts);assert.deepEqual(defects,generateRandomDefects(opts));
 const cable={name:'SH02 test',material_ref:'SH02',length_m:'100',baseline:base,defects};validateCable(cable);
 for(const item of defects){const pos=fixed(item.start_m)+fixed(item.length_m)/2n;assert.deepEqual(observeCable(cable,pos),observeCable(cable,pos));assert.notDeepEqual(observeCable(cable,pos),base);}
 }
 assert.throws(()=>generateRandomDefects({length:1,count:21,seed:1,metric:'ALL',baseline:base,minLength:1,maxLength:1,strength:20}));
 const cable={name:'old',material_ref:'old',length_m:'10',baseline:base,defects:[{name:'old',metric:'OVALITY',start_m:'0',length_m:'2',value_mm:'50'}]};assert.equal(observeCable(cable,fixed('1')).diameter_y_mm,'50');
});
test('contract permits roundness but not a ratio for wire gap',()=>{
 const v={metric_code:'OVALITY',value:'0.95',unit:'1',data_status:'VALID',source_quality_result:'PASS',method_id:'roundness-min-max.v1',window:{kind:'INSTANT',definition_id:null,start:null,end:null,position_from_m:null,position_to_m:null},reason_code:null};
 validate('Value',v);
 v.metric_code='WIRE_GAP';assert.throws(()=>validate('Value',v));
});

test('frozen method drives simulator values; curve stored as a new SQLite version',()=>{
 const {Queue}=require('../tools/simulator/dist/queue');const {ModelStore,modelRecord}=require('../tools/simulator/dist/model-store');
 const {mkdtempSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');
 const q=new Queue(join(mkdtempSync(join(tmpdir(),'sh02-')),'test.sqlite'));const store=new ModelStore(q);
 try{
 const cable={name:'SH02 isolated',material_ref:'isolated',length_m:'10',baseline:{...base,diameter_y_mm:'50'},defects:[]};
 const id='11111111-1111-4111-8111-111111111111';store.save('cables',{id,version:0,data:cable,reason:'SH02 isolation'});
 const saved=store.get('cables',id);assert.deepEqual(saved.data,cable);
 const snapshot={cable:{id,version:1,data:cable},detector:{id,version:1,data:{...d,device_id:'HY-BY-01',name:'isolated',step_m:'1',speed_m_min:'60'}},count:10,interval_ms:1000};
 const assignment={metric_code:'OVALITY',task_id:'task-sh02',binding_id:'bind-sh02',binding_version:'1',recipe_version_id:null,rule_snapshot:{method_id:'roundness-min-max.v1',comparison:{operator:'GE',lower:'0.85',upper:null}}};
 const rec=modelRecord({id:'sh02',assignment:JSON.stringify(assignment),device_id:'HY-BY-01',capture_session:'capture-sh02'},1,snapshot);
 assert.equal(rec.values[0].value,'0.8');assert.equal(rec.values[0].unit,'1');assert.equal(rec.values[0].source_quality_result,'FAIL');validate('Measurement',rec);validateOvalityObservation(rec);
 assignment.rule_snapshot.method_id='test-by';const old=modelRecord({id:'old',assignment:JSON.stringify(assignment),device_id:'HY-BY-01',capture_session:'capture-sh02'},1,snapshot);assert.equal(old.values[0].unit,'%');validateOvalityObservation(old);
 }finally{q.db.close();}
});
