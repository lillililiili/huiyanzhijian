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
 const option:any=detectionTrendOption([point('4','VALID','NOT_EVALUATED'),point(null,'MISSING'),point('4','VALID','FAIL')],'mm','time',rule);
 expect(option.dataZoom.map((z:any)=>z.type)).toEqual(['inside','slider']);
 expect(option.dataZoom[1].start).toBeUndefined(); // Refresh must not reset the user's zoom.
 expect(option.series[0].connectNulls).toBe(false);
 expect(option.series[0].data[1].value).toBeNull();
 expect(option.series[0].data[0].itemStyle).toBeUndefined();
 expect(option.series[0].data[2].itemStyle.color).toBe('#df5966');
 expect(option.series[0].areaStyle.color.colorStops).toHaveLength(2);
 expect(option.series[0].markLine.data).toEqual([{name:'规则上限 3 mm',yAxis:3}]);
});
test('unknown positions and raw precision remain visible and tooltip content is escaped',()=>{
 const record=point('1.2500000000');record.raw_payload.position_m=null;record.unit='<img>';
 const option:any=detectionTrendOption([record],'mm','meter');
 expect(option.xAxis.data).toEqual(['位置未知']);
 const tooltip=option.tooltip.formatter([{dataIndex:0}]);
 expect(tooltip).toContain('1.2500000000');
 expect(tooltip).toContain('位置未知');
 expect(tooltip).toContain('&lt;img&gt;');
 expect(option.series[0].markLine.data).toEqual([]);
});
