import {expect,test,vi} from 'vitest';
import {ApiClient,type Measurement} from '../live/api';
import {readTaskTrend} from '../live/taskTrend';
const row=(n:number,time=n)=>({id:String(n),ingest_order:String(n),value:'1',unit:'%',raw_payload:{sample_time:new Date(1700000000000+time*1000).toISOString(),data_status:'VALID'}} as Measurement);
function service(input:Measurement[]){
 let records=[...input],broken=false;
 const api=new ApiClient(),calls:string[]=[];
 vi.spyOn(api,'request').mockImplementation(async path=>{
  calls.push(path);const q=new URLSearchParams(path.split('?')[1]),offset=Number(q.get('cursor')||0);
  if(broken&&offset)throw Error('page failure');
  const sorted=[...records].sort((a,b)=>Number(b.ingest_order)-Number(a.ingest_order));
  const items=sorted.slice(offset,offset+100),more=offset+100<sorted.length;
  return {items,total:records.length,has_more:more,next_cursor:more?String(offset+100):null,as_of:'snapshot'};
 });
 return {api,calls,set:(v:Measurement[])=>{records=v;},break:()=>{broken=true;}};
}
test('all snapshot pages are loaded without 25/100/200 record truncation',async()=>{
 const s=service(Array.from({length:350},(_,i)=>row(i+1)));
 const result=await readTaskTrend(s.api,'task',[],new AbortController().signal);
 expect(result.rows).toHaveLength(350);expect(result.rows[0].id).toBe('1');expect(result.rows.at(-1)?.id).toBe('350');expect(s.calls).toHaveLength(4);
});
test('incremental batches over one page and delayed samples retain all old points with no duplicates',async()=>{
 const old=Array.from({length:120},(_,i)=>row(i+1)),s=service(old);
 const first=await readTaskTrend(s.api,'task',[],new AbortController().signal);
 const late=row(121,-20),sameTime=row(122,120),added=Array.from({length:120},(_,i)=>row(i+123));
 s.set([...old,late,sameTime,...added]);s.calls.length=0;
 const next=await readTaskTrend(s.api,'task',first.rows,new AbortController().signal);
 expect(next.rows).toHaveLength(242);expect(next.rows[0].id).toBe('121');expect(next.rows.filter(r=>r.raw_payload.sample_time===old.at(-1)!.raw_payload.sample_time)).toHaveLength(2);
 expect(s.calls).toHaveLength(2);s.calls.length=0;
 const unchanged=await readTaskTrend(s.api,'task',next.rows,new AbortController().signal);expect(unchanged.rows).toEqual(next.rows);expect(s.calls).toHaveLength(1);
});
test('partial failure leaves previous snapshot untouched and retry fetches the missing pages',async()=>{
 const old=[row(1)],s=service([row(1),...Array.from({length:220},(_,i)=>row(i+2))]);s.break();
 await expect(readTaskTrend(s.api,'task',old,new AbortController().signal)).rejects.toThrow('page failure');expect(old).toHaveLength(1);
 const retry=service([row(1),...Array.from({length:220},(_,i)=>row(i+2))]);expect((await readTaskTrend(retry.api,'task',old,new AbortController().signal)).rows).toHaveLength(221);
});
test('missing or cyclic cursor and incomplete totals cannot masquerade as a complete trend',async()=>{
 const api=new ApiClient(),spy=vi.spyOn(api,'request').mockResolvedValue({items:[row(1)],total:2,has_more:false,next_cursor:null});
 await expect(readTaskTrend(api,'task',[],new AbortController().signal)).rejects.toThrow('记录数');
 spy.mockResolvedValue({items:[row(1)],total:2,has_more:true,next_cursor:'repeat'});
 await expect(readTaskTrend(api,'task',[],new AbortController().signal)).rejects.toThrow('游标异常');
});
test('an empty task is a complete empty snapshot',async()=>{
 const s=service([]);expect((await readTaskTrend(s.api,'task',[],new AbortController().signal)).rows).toEqual([]);
});
