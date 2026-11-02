import type { ApiClient, Measurement, Page } from './api';
import {sortBySampleTime} from './sampleTime';

// M04 cursors fix the snapshot and sort by ingest_order, including late samples.
// Only publish after the whole new range succeeds; a failed page must not advance the watermark.
export async function readTaskTrend(api:ApiClient, taskId:string, previous:Measurement[], signal:AbortSignal){
 const base='/measurements?'+new URLSearchParams({limit:'100',order:'desc',task_id:taskId});
 const known=new Set(previous.map(r=>r.id)), added=new Map<string,Measurement>(), cursors=new Set<string>();
 let page=await api.request<Page<Measurement>>(base,undefined,{},signal);
 const total=page.total,asOf=page.as_of;
 for(;;){
  let reachedKnown=false;
  for(const row of page.items){if(known.has(row.id))reachedKnown=true;else added.set(row.id,row);}
  if(reachedKnown||!page.has_more)break;
  if(!page.next_cursor||cursors.has(page.next_cursor))throw new Error('完整趋势游标异常，请刷新重试');
  cursors.add(page.next_cursor);
  page=await api.request<Page<Measurement>>(base+'&cursor='+encodeURIComponent(page.next_cursor),undefined,{},signal);
 }
 const rows=sortBySampleTime([...previous,...added.values()]);
 if(total!==undefined&&rows.length!==total)throw new Error('完整趋势记录数与服务端快照不一致，请刷新重试');
 return {rows,total:total??rows.length,asOf};
}
