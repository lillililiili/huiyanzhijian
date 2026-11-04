import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';

const roots=[process.env.INSPUR_ADAPTER_ROOT,resolve('../../adapters/inspur/http'),resolve('adapters/inspur/http')].filter(Boolean) as string[];
const root=roots.find(p=>existsSync(resolve(p,'contract.cjs')));
if(!root)throw Error('ODM01 adapter files missing');
export const vendorContract=require(resolve(root,'contract.cjs'));
const {queryAll}=require(resolve(root,'client.cjs'));
const {OVERLAP,GAP,schemas,paths,testConfig,mapRecord,dateText,validateQuery,dateMillis}=vendorContract;

export function initVendorStore(db:DatabaseSync){db.exec(`CREATE TABLE IF NOT EXISTS vendor_http_sample(
 record_id TEXT PRIMARY KEY,device_id TEXT NOT NULL,line_id TEXT NOT NULL,metric TEXT NOT NULL,
 sample_ms INTEGER NOT NULL,wire_json TEXT NOT NULL,context_json TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS vendor_http_query ON vendor_http_sample(device_id,metric,line_id,sample_ms,record_id);`);}

export function prepareVendorSample(db:DatabaseSync,record:any){
 const metric=record.values?.[0]?.metric_code;if(![OVERLAP,GAP].includes(metric))return record;
 if(Object.values(schemas).includes(record.raw?.schema_version))return record;
 const binding=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='odm_scan_binding'").get()?db.prepare('SELECT line_id FROM odm_scan_binding WHERE binding_id=? AND device_id=? AND task_id=?').get(record.binding_id,record.device_id,record.task_id) as any:null;
 const observed=record.raw?.data?.observation||{},ms=Date.parse(record.sample_time),time=dateText(ms,480);
 const number=(v:any)=>v===null||v===undefined||v===''?null:Number(v);
 const wire:any={id:record.record_id,workTableTeam:'SIMULATED',customerNames:'模拟测试',lineId:binding?.line_id||record.capture_session_id,
 voltageLevel:null,processStandard:null,dataDate:time.slice(0,10),dataTime:time.slice(11),seat:number(record.position_m),
 buildWidth:metric===GAP?number(record.values[0].value):number(observed.overlap_width_mm??(record.values[0].value===null?null:Number(record.values[0].value)*0.2)),createTime:time,buildPicPath:'',
 x1:null,y1:null,x2:null,y2:null,x0:null,y0:null,horspace:null,toleranceTop:null,toleranceBottom:null,
 dataCreateTime:String(ms),coreSpeed:0};
 if(metric===OVERLAP)Object.assign(wire,{copperStripSpecs:null,processCappingWidth:null,stripWidth:number(observed.tape_width_mm??20),buildPercent:number(record.values[0].value),angle:0,coreDiameter:0,controlStatus:0});
 else Object.assign(wire,{dataType:'GAP',processWidth:null});
 // Scalar diagnostic fixtures use an explicit TEST_ONLY 20 mm virtual tape; faults remain null.
 const context={lineId:wire.lineId,metric,record_id:record.record_id,device_id:record.device_id,capture_session_id:record.capture_session_id,capture_sequence:record.capture_sequence,task_id:record.task_id,binding_id:record.binding_id,binding_version:record.binding_version,recipe_version_id:record.recipe_version_id,position_segment_id:record.position_segment_id,method_id:record.values[0].method_id,window:record.values[0].window};
 const normalized=mapRecord(wire,context,testConfig(metric));
 Object.assign(context,{simulation_result:record.values[0].source_quality_result});
 db.prepare('INSERT INTO vendor_http_sample VALUES(?,?,?,?,?,?,?)').run(record.record_id,record.device_id,wire.lineId,metric,ms,JSON.stringify(wire),JSON.stringify(context));
 return normalized;
}

export function vendorQuery(db:DatabaseSync,metric:string,device:string,input:any){
 validateQuery(input,metric,480);
 // End is inclusive to the last millisecond of the protocol's second-resolution query.
 const params=[device,metric,input.lineId,dateMillis(input.startTime,480),dateMillis(input.endTime,480)+999];
 const where='device_id=? AND metric=? AND line_id=? AND sample_ms BETWEEN ? AND ?';
 const count=input.dataType==='PITCH'?0:Number(db.prepare('SELECT count(*) AS n FROM vendor_http_sample WHERE '+where).get(...params)?.n||0);
 const rows=count?db.prepare('SELECT wire_json FROM vendor_http_sample WHERE '+where+' ORDER BY sample_ms,record_id LIMIT ? OFFSET ?').all(...params,input.limit,(input.page-1)*input.limit):[];
 return {code:200,msg:'操作成功',data:rows.map((r:any)=>JSON.parse(r.wire_json)),success:true,timestamp:String(Date.now()),count};
}
export function vendorMetric(path:string):string|undefined{return Object.keys(paths).find(k=>paths[k]===path);}

// CLI-only runs also use a real loopback HTTP source. Web runs query the same public simulator endpoints.
export async function readVendorMeasurements(db:DatabaseSync,records:any[]):Promise<any[]> {
 const selected=records.filter(r=>Object.values(schemas).includes(r.raw?.schema_version));if(!selected.length)return records;
 let endpoint=process.env.SIM_VENDOR_BASE_URL,token=process.env.SIM_VENDOR_TOKEN,server:ReturnType<typeof createServer>|undefined;
 if(!endpoint){
  token=randomBytes(24).toString('hex');
  server=createServer(async(req,res)=>{try{
   if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);res.end();return;}
   const metric=vendorMetric(new URL(req.url||'/','http://localhost').pathname);if(!metric||req.method!=='POST'){res.writeHead(404);res.end();return;}
   let body='';for await(const part of req){body+=part;if(body.length>32768)throw Error('BODY_LIMIT');}
   const result=vendorQuery(db,metric,String(req.headers['x-sim-device-id']||''),JSON.parse(body));res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch{res.writeHead(400);res.end(JSON.stringify({code:400,msg:'查询参数不正确',data:[],success:false,timestamp:String(Date.now()),count:0}));}});
  await new Promise<void>(r=>server!.listen(0,'127.0.0.1',r));endpoint='http://127.0.0.1:'+(server.address() as any).port;
 }
 if(!token)throw Error('SIM_VENDOR_TOKEN required');
 try{
  const groups=new Map<string,any[]>();for(const r of selected){const key=JSON.stringify([r.device_id,r.capture_session_id,r.values[0].metric_code]);groups.set(key,[...(groups.get(key)||[]),r]);}
  const result=new Map<string,any>();
  for(const group of groups.values()){
   const first=group[0],metric=first.values[0].metric_code,c={...testConfig(metric),baseUrl:endpoint,headers:{Authorization:'Bearer '+token,'X-Sim-Device-Id':first.device_id}};
   const storedFirst=db.prepare('SELECT line_id FROM vendor_http_sample WHERE record_id=?').get(first.record_id) as any;if(!storedFirst)throw Error('VENDOR_SOURCE_RECORD_MISSING');
   const times=group.map(r=>Date.parse(r.sample_time)),query={lineId:storedFirst.line_id,startTime:dateText(Math.min(...times),480),endTime:dateText(Math.max(...times),480),limit:500,...(metric===GAP?{dataType:'GAP'}:{})};
   const expected=new Set(group.map(r=>r.record_id));
   await queryAll(c,query,(rows:any[])=>{for(const row of rows){if(!expected.has(row.id))continue;
    const stored=db.prepare('SELECT context_json,wire_json FROM vendor_http_sample WHERE record_id=? AND device_id=?').get(row.id,first.device_id) as any;
    if(!stored||stored.wire_json!==JSON.stringify(row))throw Error('VENDOR_SOURCE_CONTENT_CONFLICT');
    result.set(row.id,mapRecord(row,JSON.parse(stored.context_json),c));
   }});
   if(group.some(r=>!result.has(r.record_id)))throw Error('VENDOR_SOURCE_RECORD_MISSING');
  }
  return records.map(r=>result.get(r.record_id)||r);
 }finally{if(server)await new Promise<void>(r=>server!.close(()=>r()));}
}
