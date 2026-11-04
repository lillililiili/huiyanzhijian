import {describe,it,expect} from 'vitest';
import {parseCsv,readImportCsv,csvText} from '../live/importCsv';
import {importKinds,headersFor,prepareImport,type Refs} from '../live/importRegistry';
const refs:Refs={catalog:{product_specification:[{id:'s',code:'S',enabled:true,version:'1'}],device:[{id:'D',process_id:'p',metric_code:'WIRE_GAP',enabled:true,version:'1'}],recipes:[{id:'R',code:'R',metric_code:'WIRE_GAP',enabled:true,version:'1'}],inspection_process:[{id:'p'}]},orders:[{id:'w',external_code:'W',specification_id:'s',specification_ids:['s']}],spools:[{id:'x',spool_code:'X',work_order_id:'w',specification_id:'s',version:'1'}],profiles:[],users:[],settings:{platform:{version:'0'},personal:{version:'0'}},edge:[],factories:[]};
const user={id:'u',name:'u',username:'u',factory_id:'f',permissions:['data:read']};
const row=(id:string,v:Record<string,string>)=>({...Object.fromEntries(headersFor(importKinds.find(k=>k.id===id)!).map(x=>[x,''])),'行类型':'数据',...v});
describe('IMP01 CSV transport',()=>{
 it.each(importKinds.map(k=>[k.id,k] as const))('%s rejects undeleted template examples',(id,k)=>{expect(id).toBeTruthy();expect(()=>readImportCsv(csvText([headersFor(k),['示例（导入前删除）',...k.fields.map(f=>f.example)]]),headersFor(k))).toThrow(/删除示例/);});
 it('parses quoted commas, doubled quotes, newlines and BOM',()=>expect(parseCsv('\ufeffa,b\r\n"中文,值","a""b\n二行"')).toEqual([['a','b'],['中文,值','a"b\n二行']]));
 it('rejects duplicates, unknown headers, malformed quotes and row sizes',()=>{
  expect(()=>readImportCsv('行类型,a,a\n数据,1,2',['行类型','a'])).toThrow(/重复/);
  expect(()=>readImportCsv('行类型,b\n数据,1',['行类型','a'])).toThrow(/表头/);
  expect(()=>readImportCsv('行类型,a\n数据,1,2',['行类型','a'])).toThrow(/列数/);
  expect(()=>parseCsv('a,b\n"abc,1')).toThrow(/闭合/);
  expect(()=>parseCsv('a,b\n"abc"z,1')).toThrow(/引号/);
  expect(()=>readImportCsv('行类型,a\n数据,1\n数据,1',['行类型','a'])).toThrow(/重复/);
 });
 it('bounds memory and prevents spreadsheet formula execution',()=>{expect(()=>parseCsv('x'.repeat(2*1024*1024+1))).toThrow(/2 MiB/);expect(()=>readImportCsv('a\n'+'x\n'.repeat(205),['a'])).toThrow(/200/);expect(csvText([['=SUM(A1)','+x','@x','-x']])).toContain("'=SUM");});
});
describe('IMP01 command contracts',()=>{
 it('creates orders with exact specification identity and rejects duplicates',()=>{const v=row('order',{'操作':'新增','工单编号':'NEW','规格编号':'S'}),c=prepareImport('order',[v],refs,user)[0];expect(c.path).toBe('/work-orders');expect(c.body).toEqual({external_code:'NEW',specification_ids:['s']});expect(()=>prepareImport('order',[v,v],refs,user)).toThrow(/重复/);});
 it('rejects ambiguous and missing identifiers',()=>{expect(()=>prepareImport('spool',[row('spool',{'工单编号':'W','线缆编号':'New','规格编号':'NONE'})],refs,user)).toThrow(/不存在/);expect(()=>prepareImport('spool',[row('spool',{'工单编号':'W','线缆编号':'New','规格编号':'S'})],{...refs,orders:[...refs.orders,...refs.orders]},user)).toThrow(/不唯一/);});
 it('groups plan rows and creates tasks without starting them',()=>{const v={'工单编号':'W','线缆编号':'X','设备编号':'D','配方版本ID':'R','计划长度m':'100'};const c=prepareImport('task',[row('task',v)],refs,user)[0];expect(c.path).toBe('/tasks');expect(c.body.process_id).toBe('p');const p=prepareImport('plan',[row('plan',{...v,'计划名称':'PLAN'})],refs,user)[0];expect(p.body.items).toEqual([c.body]);expect(p.path).toBe('/plans');});
 it('requires sheath recipe for paired measurement and rejects foreign metric',()=>{const v=row('task',{'工单编号':'W','线缆编号':'X','设备编号':'D','配方版本ID':'R','计划长度m':'100'});const r={...refs,catalog:{...refs.catalog,device:[{...refs.catalog.device[0],metric_code:'OVALITY'}],recipes:[{...refs.catalog.recipes[0],metric_code:'OVALITY'}]}};expect(()=>prepareImport('task',[v],r,user)).toThrow(/护套/);});
 it('requires explicit create/update and does not silently overwrite',()=>{expect(()=>prepareImport('order',[row('order',{'操作':'新增','工单编号':'W','规格编号':'S'})],refs,user)).toThrow(/已存在/);});
});
