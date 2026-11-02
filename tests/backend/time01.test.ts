import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validate} from '../../apps/platform/infrastructure/schema';
const samples=JSON.parse(readFileSync('../../contracts/devices/v1/examples/01-measurements.json','utf8')).records;
test('TIME01 all three metrics accept time-only samples and retain legacy position validation',()=>{
 for(const metric of ['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY']){
  const original=structuredClone(samples[0]);
  original.values[0].metric_code=metric;original.values[0].unit=metric==='WIRE_GAP'?'mm':'%';
  assert.doesNotThrow(()=>validate('Measurement',original));
  const record=structuredClone(original);
  delete record.position_m;delete record.position_quality;delete record.position_segment_id;
  assert.doesNotThrow(()=>validate('Measurement',record));
  for(const time of [undefined,'2026-10-29 12:00:00','not-a-time'])assert.throws(()=>validate('Measurement',{...record,sample_time:time}));
  assert.throws(()=>validate('Measurement',{...record,position_m:'1.0'}));
  assert.throws(()=>validate('Measurement',{...record,position_m:'1.0',position_quality:'UNKNOWN',position_segment_id:null}));
 }
});
