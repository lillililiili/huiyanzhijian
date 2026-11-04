import {it,expect} from 'vitest';
import {importKinds,headersFor,prepareImport,loadImportRefs,type Refs} from '../live/importRegistry';
import {csvText,importTemplate,parseCsv,readImportCsv} from '../live/importCsv';
import {importRowNumber} from '../live/importValidation';
const order=importKinds.find(k=>k.id==='order')!;
const parse=(rows:unknown[][])=>readImportCsv(csvText(rows),headersFor(order),order);
const refs:Refs={catalog:{product_specification:[{id:'s',code:'S'}],device:[],recipes:[],inspection_process:[]},orders:[],spools:[],profiles:[],users:[],settings:null,edge:[],factories:[]};
const user={id:'u',name:'u',username:'u',factory_id:'f',permissions:['task:write']};
it('IMP02 exposes only eight business types and rejects removed command families',async()=>{
 expect(importKinds.map(k=>k.id)).toEqual(['spec','recipe','recipe-state','order','spool','spool-edit','task','plan']);
 for(const kind of ['device','discovery','edge','users','platform','personal']){
  expect(()=>prepareImport(kind,[],refs,user)).toThrow('不支持业务');
  await expect(loadImportRefs({} as any,kind)).rejects.toThrow('不支持业务');
 }
});
it.each(importKinds.map(k=>[k.id,k] as const))('IMP02 %s template includes instructions and rejects its example',(id,kind)=>{
 const template=importTemplate(kind),rows=parseCsv(template);
 expect(id).toBeTruthy();expect(rows[0][0]).toBe('行类型 *');expect(rows[1][0]).toBe('填写说明（不导入）');expect(rows[2][0]).toContain('示例');
 expect(()=>readImportCsv(template,headersFor(kind),kind)).toThrow('第3行 · 字段「行类型」');
 rows[2][0]='数据';expect(()=>readImportCsv(csvText(rows),headersFor(kind),kind)).toThrow('仅更改示例标记');
});
it('IMP02 retains explanation, accepts header stars and preserves physical rows through empty lines',()=>{
 const rows=parseCsv(importTemplate(order));rows[2]=['数据','新增','NEW','S'];
 const text=csvText([rows[0],rows[1],['','','',''],rows[2]]),values=readImportCsv(text,headersFor(order),order);
 expect(values).toHaveLength(1);expect(importRowNumber(values[0],0)).toBe(4);
 expect(prepareImport('order',values,refs,user)[0].row).toBe(4);
});
it('IMP02 quoted multiline fields retain subsequent physical line numbers',()=>{
 const values=parse([headersFor(order),['数据','新增','工单\n二行','S'],['','','',''],['数据','新增','NEXT','S']]);
 expect(importRowNumber(values[1],1)).toBe(5);
});
it('IMP02 reports required field and several affected rows before any commands',()=>{
 expect(()=>parse([headersFor(order),['数据','新增','','S'],['数据','新增','W','']])).toThrow('第2行 · 字段「工单编号」');
 expect(()=>parse([headersFor(order),['数据','新增','','S'],['数据','新增','W','']])).toThrow('第3行 · 字段「规格编号」');
});
it('IMP02 exact reference failures include preserved row and field',()=>{
 const rows=readImportCsv(csvText([headersFor(order),['','','',''],['数据','新增','NEW','NONE']]),headersFor(order),order);
 expect(()=>prepareImport('order',rows,refs,user)).toThrow('第3行 · 字段「规格编号」');
});
it('IMP02 detects stale instructions, placeholders, duplicate rows and headers',()=>{
 expect(()=>parse([headersFor(order),['填写说明（不导入）','新增','W','S']])).toThrow('行类型');
 expect(()=>parse([headersFor(order),['数据','新增','W','请填写规格']])).toThrow('字段「规格编号」');
 expect(()=>parse([headersFor(order),['数据','新增','W','S'],['数据','新增','W','S']])).toThrow('第3行 · 字段「整行」');
 expect(()=>parse([['行类型','操作','工单编号','工单编号'],['数据','新增','W','S']])).toThrow('第1行 · 字段「工单编号」');
});
it('IMP02 supports original CSV and rejects 201 actual data rows, not the instructions',()=>{
 expect(parse([headersFor(order),['数据','新增','OLD','S']])).toHaveLength(1);
 const head=parseCsv(importTemplate(order)).slice(0,2);
 expect(parse([...head,...Array.from({length:200},(_,i)=>['数据','新增','W'+i,'S'])])).toHaveLength(200);
 expect(()=>parse([...head,...Array.from({length:201},(_,i)=>['数据','新增','W'+i,'S'])])).toThrow('200');
});
it('IMP02 recipe conditional fields and numeric errors name exact fields',()=>{
 const kind=importKinds.find(k=>k.id==='recipe')!,row=Object.fromEntries(headersFor(kind).map(h=>[h,'']));
 Object.assign(row,{'行类型':'数据','操作':'新增','配方编号':'R','配方名称':'R','检测项':'铜丝间隙','判定方式':'上限','上限':'abc','单位':'mm','标准依据':'合同条款','变更原因':'维护'});
 const read=()=>readImportCsv(csvText([headersFor(kind),headersFor(kind).map(h=>row[h])]),headersFor(kind),kind);
 expect(read).toThrow('字段「上限」');row['上限']='3';expect(read()).toHaveLength(1);
 row['检测项']='护套厚度';row['判定方式']='下限';row['上限']='';row['下限']='1.9';expect(read).toThrow('字段「护套标准厚度mm」');
});
