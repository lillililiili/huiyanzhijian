import test from 'node:test';
import assert from 'node:assert/strict';
import {hydrateMeasurementRows} from '../../apps/platform/modules/m04-measurements/storage-api';
import {ovalityTimeseries} from '../../apps/platform/modules/m04-measurements/timeseries';
import {pool} from '../../apps/platform/infrastructure/db';

test('PERF02 hydration uses the caller transaction, never borrows a second connection',async()=>{
 const oldQuery=pool.query,oldRead=ovalityTimeseries.read;let queries=0;
 (pool as any).query=async()=>{throw Error('Second connection borrowed while caller transaction owns one');};
 ovalityTimeseries.read=async()=>new Map([['point',{raw_payload:{sample_time:'2026-11-02T00:00:00.123456Z'},value:'999'}]]);
 const db:any={query:async(sql:string,values:any[])=>{queries++;assert.equal(values[0],'F1');assert.deepEqual(values[1],['record']);return {rows:[{record_id:'record',numeric_value:'1.2500000000',sheath_result:{status:'VALID'}}]};}};
 try{
  const rows:any[]=[{id:'record',raw_payload:{storage:'INFLUXDB',version:'ts01.1',point_id:'point'}}];
  await (hydrateMeasurementRows as any)('F1',rows,db);
  assert.equal(queries,1);assert.equal(rows[0].value,'1.2500000000');assert.equal(rows[0].sample_storage,'INFLUXDB');
  assert.equal(rows[0].raw_payload.sample_time,'2026-11-02T00:00:00.123456Z');assert.equal(rows[0].sheath_result.status,'VALID');
 }finally{pool.query=oldQuery;ovalityTimeseries.read=oldRead;}
});

test('PERF02 missing projection and time-series errors remain visible',async()=>{
 const oldRead=ovalityTimeseries.read;
 try{
  ovalityTimeseries.read=async()=>new Map();
  await assert.rejects(()=>(hydrateMeasurementRows as any)('F1',[{id:'missing',raw_payload:{}}],{query:async()=>({rows:[]})}),/计算结果/);
  ovalityTimeseries.read=async()=>{throw Error('TIMESERIES_UNAVAILABLE');};
  await assert.rejects(()=>(hydrateMeasurementRows as any)('F1',[{id:'missing',raw_payload:{}}],{query:async()=>({rows:[]})}),/TIMESERIES_UNAVAILABLE/);
 }finally{ovalityTimeseries.read=oldRead;}
});
