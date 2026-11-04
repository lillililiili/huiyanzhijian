/** Share a control-plane budget, but do not make independent authorized devices
 * compete for the same ingestion/heartbeat budget. Unknown IDs never open a bucket. */
export function deviceRateBucket(credential:string,allowed:string[],path:string,body:any):string{
 const scoped=path.match(/^\/api\/v1\/devices\/([^/]+)(?:\/|$)/)?.[1];
 const ids=Array.isArray(body?.records)?[...new Set(body.records.map((r:any)=>r?.device_id))]:[];
 const candidate=scoped??body?.device_id??(ids.length===1?ids[0]:null);
 return 'device:'+credential+':'+(typeof candidate==='string'&&allowed.includes(candidate)?candidate:'control');
}
