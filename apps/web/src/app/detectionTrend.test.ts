import { expect, test } from 'vitest';
import { compactDecimal, detectionLimit } from '../live/detectionDisplay';
import { detectionTrendOption } from '../live/detectionTrend';
import type { Measurement, Rule } from '../live/api';

const rule:Rule={approval_state:'TEST_ONLY',method_id:'test',method_version:'1',comparison:{operator:'LE',lower:null,upper:'3.000'}};
const point=(value:string|null,status='VALID',result='PASS')=>({value,unit:'mm',quality_result:result,raw_payload:{data_status:status,sample_time:'2026-10-27T08:14:06.123456Z',position_m:'12.000000'}} as Measurement);

test('display removes only trailing zeros and preserves every nonzero digit',()=>{
 expect(compactDecimal('1.2500000000')).toBe('1.25');
 expect(compactDecimal('40.000000')).toBe('40');
 expect(compactDecimal('0.0000000001')).toBe('0.0000000001');
 expect(compactDecimal('12345678901234567890.12345000')).toBe('12345678901234567890.12345');
 expect(compactDecimal(null)).toBe('—');
});
test('limits retain frozen boundaries and absent rules stay collection-only',()=>{
 expect(detectionLimit(rule,'mm')).toBe('≤ 3 mm');
 expect(detectionLimit({...rule,comparison:{operator:'GE',lower:'10.00',upper:null}},'%')).toBe('≥ 10 %');
 expect(detectionLimit({...rule,comparison:null},'%')).toBe('仅采集');
});
test('area chart retains global zoom, gaps and server FAIL markers without rejudging values',()=>{
 const option:any=detectionTrendOption([point('4','VALID','NOT_EVALUATED'),point(null,'MISSING'),point('4','VALID','FAIL')],'mm',rule);
 expect(option.dataZoom.map((z:any)=>z.type)).toEqual(['inside','slider']);
 expect(option.dataZoom[1].start).toBeUndefined(); // Refresh must not reset the user's zoom.
 expect(option.series[0].connectNulls).toBe(false);
 expect(option.series[0].data[1].value[1]).toBeNull();
 expect(option.series[0].data[0].itemStyle).toBeUndefined();
 expect(option.series[0].data[2].itemStyle.color).toBe('#df5966');
 expect(option.series[0].areaStyle.color.colorStops).toHaveLength(2);
 expect(option.series[0].markLine.data).toEqual([{name:'规则上限 3 mm',yAxis:3}]);
});
test('unknown positions and raw precision remain visible and tooltip content is escaped',()=>{
 const record=point('1.2500000000');record.raw_payload.position_m=null;record.unit='<img>';
 const option:any=detectionTrendOption([record],'mm');
 expect(option.xAxis[0].type).toBe('time');
 const tooltip=option.tooltip.formatter([{dataIndex:0}]);
 expect(tooltip).toContain('1.2500000000');
 expect(tooltip).not.toContain('位置');
 expect(tooltip).toContain('.123456');
 expect(tooltip).toContain('&lt;img&gt;');
 expect(option.series[0].markLine.data).toEqual([]);
});


test('time sorting handles delayed samples, timezone offsets, microseconds and duplicate timestamps', async()=>{
 const {sortBySampleTime}=await import('../live/sampleTime');
 const make=(id:string,time:string)=>({...point('1'),id,ingest_order:id,raw_payload:{...point('1').raw_payload,sample_time:time}} as Measurement);
 const rows=[make('3','2026-10-29T08:00:01Z'),make('2','2026-10-29T16:00:00.123456+08:00'),make('1','2026-10-29T08:00:00.123455Z'),make('4','2026-10-29T08:00:00.123456Z')];
 const sorted=sortBySampleTime(rows);
 expect(sorted.map(r=>r.id)).toEqual(['1','2','4','3']);
 expect(rows[0].id).toBe('3');
 const option:any=detectionTrendOption(sorted,'mm');
 expect(option.series[0].data).toHaveLength(4);
 expect(option.series[0].data[3].value[0]-option.series[0].data[1].value[0]).toBeCloseTo(876.544,2);
 expect(option.xAxis[0].min).toBe(option.series[0].data[0].value[0]);expect(option.xAxis[0].max).toBe(option.series[0].data[3].value[0]);
});

test('first sample is at the left edge and new data expands the range without dropping old points',()=>{
 const first=point('1'),second={...point('2'),raw_payload:{...point('2').raw_payload,sample_time:'2026-10-27T08:20:00Z'}};
 const one:any=detectionTrendOption([first],'mm'),two:any=detectionTrendOption([first,second],'mm');
 expect(one.xAxis[0].min).toBe(one.series[0].data[0].value[0]);expect(one.xAxis[0].max-one.xAxis[0].min).toBe(1);
 expect(two.xAxis[0].min).toBe(one.xAxis[0].min);expect(two.xAxis[0].max).toBeGreaterThan(one.xAxis[0].max);
 expect(two.series[0].data).toHaveLength(2);expect(two.dataZoom[1].start).toBeUndefined();
});

test('dense trends retain every data point without white marker borders hiding the line',()=>{
 const rows=Array.from({length:400},(_,i)=>point('1','VALID',i===200?'FAIL':'PASS'));
 const option:any=detectionTrendOption(rows,'%');expect(option.series[0].data).toHaveLength(400);
 expect(option.series[0].symbolSize).toBe(2);expect(option.series[0].data[200].symbolSize).toBe(7);
});
