import {expect,test,vi} from 'vitest';
import {ApiClient,type Task} from '../live/api';
import {loadAnalyticsTasks,summarizeTasks} from '../live/analyticsData';
import {trendTasks,comparisonOption} from '../live/AnalyticsCharts';
const task=(id:string,mean:string='2')=>({id,canonical_spool_id:'same',metric_code:'WIRE_GAP',measurements:{total:10,valid:10,invalid:0,passed:6,failed:1,unevaluated:3,quarantined:0,minimum:'1',maximum:'3',mean,latest_sample_at:'2026-10-30T01:00:00Z'}} as Task);
test('summary excludes unevaluated from denominator and deduplicates canonical spools',()=>{
 const s=summarizeTasks([task('1'),task('2')]);expect(s.total).toBe(20);expect(s.pending).toBe(6);expect(s.rate).toBe('85.7 %');expect(s.spools).toBe(1);
});
test('all pages are loaded and missing measurement summaries are an error',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockResolvedValueOnce({items:[task('1')],total:2,as_of:'now'}).mockResolvedValueOnce({items:[task('2')],total:2});
 expect((await loadAnalyticsTasks(api,new AbortController().signal)).tasks).toHaveLength(2);expect(request.mock.calls[1][0]).toContain('page=2');
 request.mockResolvedValue({items:[{id:'missing'}],total:1});await expect(loadAnalyticsTasks(api,new AbortController().signal)).rejects.toThrow('未返回测量摘要');
});
test('changing pagination never produces a partial total',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValueOnce({items:[task('1')],total:2}).mockResolvedValueOnce({items:[task('1')],total:2});
 await expect(loadAnalyticsTasks(api,new AbortController().signal)).rejects.toThrow('分页范围已变化');
});
test('task trends keep metric units separate and bars use real counts',()=>{
 const a=task('a'),b={...task('b'),metric_code:'OVALITY'};expect(trendTasks([a,b],'WIRE_GAP')).toEqual([a]);
 const option=comparisonOption([a,b]) as any;expect(option.series[0].data).toEqual([0,6,6]);expect(option.series[1].data).toEqual([0,1,1]);expect(option.series[2].data).toEqual([0,3,3]);
});
