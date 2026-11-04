import {test,expect} from 'vitest';
import * as echarts from 'echarts';
import {detectionTrendOption} from '../live/detectionTrend';
import type {Measurement,Rule} from '../live/api';
echarts.setPlatformAPI({measureText:(text)=>({width:String(text).length*7})});
const rows=Array.from({length:2500},(_,i)=>({id:String(i),value:i===1251?'14.583390284':i===612?null:String(i%9/10),unit:'%',quality_result:i===1251?'FAIL':'PASS',raw_payload:{data_status:i===612?'MISSING':'VALID',sample_time:new Date(1700000000000+i*i).toISOString()}} as Measurement));
const rule={comparison:{operator:'LE',upper:'8',lower:null}} as Rule;

test('overview retains a one-sample spike, irregular timestamps and gaps from the complete main series',()=>{
 const o:any=detectionTrendOption(rows,'%',rule);
 expect(o.series[1].data).toEqual(o.series[0].data.map((p:any)=>p.value));
 expect(o.series[1].data[1251][1]).toBe(14.583390284);
 expect(o.series[1].data[612][1]).toBeNull();expect(o.series[1].connectNulls).toBe(false);
 expect(o.dataZoom[1].showDataShadow).toBe(false);
 expect(o.dataZoom.every((z:any)=>JSON.stringify(z.xAxisIndex)==='[0]')).toBe(true);
 expect(o.series[1].sampling).toBeUndefined();
 expect(o.yAxis[0].min).toBe(o.yAxis[1].min);expect(o.yAxis[0].max).toBe(o.yAxis[1].max);
});

test('real chart maps both plots to identical time positions and proportional heights; zoom affects only main',()=>{
 const c=echarts.init(null,undefined,{renderer:'svg',ssr:true,width:1000,height:350});
 try{
 c.setOption(detectionTrendOption(rows,'%',rule));
 const value=[Date.parse(rows[1251].raw_payload.sample_time),14.583390284];
 const main=c.convertToPixel({seriesIndex:0},value) as number[],mini=c.convertToPixel({seriesIndex:1},value) as number[];
 expect(main[0]).toBeCloseTo(mini[0],8);
 expect((256-main[1])/226).toBeCloseTo((343-mini[1])/30,8);
 c.dispatchAction({type:'dataZoom',start:40,end:70});
 expect(c.convertToPixel({seriesIndex:1},value)).toEqual(mini);
 expect((c.convertToPixel({seriesIndex:0},value) as number[])[0]).not.toBe(main[0]);
 c.setOption(detectionTrendOption([...rows,{...rows[2499],id:'new',raw_payload:{...rows[2499].raw_payload,sample_time:new Date(1700007000000).toISOString()}}], '%',rule));
 expect((c.getOption().dataZoom as any[])[0].start).toBe(40);
 c.dispatchAction({type:'dataZoom',start:0,end:100});
 expect((c.convertToPixel({seriesIndex:0},value) as number[])[0]).toBeCloseTo((c.convertToPixel({seriesIndex:1},value) as number[])[0],8);
 c.resize({width:640,height:350});
 expect((c.convertToPixel({seriesIndex:0},value) as number[])[0]).toBeCloseTo((c.convertToPixel({seriesIndex:1},value) as number[])[0],8);
 expect(c.renderToSVGString()).toContain('<svg');
 }finally{c.dispose();}
});

test('empty, single, negative and rule-expanded ranges stay consistent',()=>{
 for(const data of [[],[rows[0]],[{...rows[0],value:'-2'},rows[1]]]){
  const o:any=detectionTrendOption(data,'mm',rule);
  expect(o.xAxis[0].min).toBe(o.xAxis[1].min);expect(o.xAxis[0].max).toBe(o.xAxis[1].max);
  expect(o.yAxis[0].min).toBe(o.yAxis[1].min);expect(o.yAxis[0].max).toBe(o.yAxis[1].max);
  expect(o.series[1].data).toEqual(o.series[0].data.map((p:any)=>p.value));
 }
});

