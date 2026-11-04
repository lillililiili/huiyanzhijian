import type {ImportKind} from './importRegistry';

const rowNumbers=new WeakMap<Record<string,string>,number>();
export function markImportRow(row:Record<string,string>,number:number){rowNumbers.set(row,number);return row;}
export const importRowNumber=(row:Record<string,string>,index:number)=>rowNumbers.get(row)??index+2;
export class ImportFieldError extends Error {
 constructor(public field:string,message:string){super(message);}
}
export const fieldError=(field:string,message:string):never=>{throw new ImportFieldError(field,message);};
const optional:Record<string,string[]>={spec:['线缆型号','客户编码','产品类型','说明'],recipe:['规格编号'], 'spool-edit':['主盘ID']};
const conditional:Record<string,string>={'原版本ID':'更新时必填；新增留空','下限':'下限或区间判定必填','上限':'上限或区间判定必填','护套标准厚度mm':'护套厚度配方必填','护套配方版本ID':'双测径设备必填'};
export function requirement(kind:ImportKind,label:string){
 if(kind.business&&kind.fields.find(f=>f.label===label)?.required)return kind.fields.find(f=>f.label===label)!.required!;
 if(kind.id==='recipe'&&label==='规格编号')return '护套厚度配方必填；其他可选';
 return conditional[label]??(optional[kind.id]?.includes(label)?'选填':'必填');
}
export const templateHeader=(kind:ImportKind,label:string)=>label+(requirement(kind,label)==='必填'?' *':requirement(kind,label)==='选填'?'':' †');
export const normalizeHeader=(s:string)=>s.trim().replace(/\s*[*†]$/,'').trim();
export const rowError=(row:number,field:string,message:string)=>`第${row}行 · 字段「${field}」：${message}`;
export function validateImportRow(kind:ImportKind,v:Record<string,string>){
 if(v['行类型']!=='数据')fieldError('行类型','仍有示例或行类型错误。请删除示例整行，正式行填写“数据”');
 if(kind.fields.every(f=>(v[f.label]||'')===f.example))fieldError('行类型','仅更改示例标记不能导入，请删除示例整行并填写实际数据');
 for(const f of kind.fields){
  const value=v[f.label]||'';
  if(value.includes('请填写')||value.includes('示例（导入前删除）'))fieldError(f.label,'仍有示例占位内容，请填写实际数据');
  if(requirement(kind,f.label)==='必填'&&!value)fieldError(f.label,'必填项不能为空');
  const limit=f.label==='变更原因'?500:['说明','备注'].includes(f.label)?2000:['规格编号','登录账号'].includes(f.label)?64:['规格名称','平台名称'].includes(f.label)?128:undefined;
  if(limit&&value.length>limit&&(kind.id==='spec'||f.label!=='规格编号'))fieldError(f.label,`最多${limit}个字符`);
 }
 const enumValue=(key:string,values:string[])=>{if(key in v&&!values.includes(v[key]))fieldError(key,'只能填写：'+values.join('、'));};
 enumValue('操作',kind.business&&kind.id==='order'?['新增','补充']:['新增','更新']);enumValue('启用',['是','否']);enumValue('显示密度',['舒适','紧凑']);enumValue('状态',['启用','停用']);
 const decimal=(key:string,positive=false,precision?:number)=>{const s=v[key];if(!/^\d+(\.\d+)?$/.test(s)||!Number.isFinite(Number(s))||(positive&&Number(s)<=0)||(precision!==undefined&&(s.split('.')[1]?.length||0)>precision))fieldError(key,`请填写${positive?'大于0的':'非负'}十进制数${precision===undefined?'':`，最多${precision}位小数`}（不含单位）`);};
 if(kind.id==='spec'){
  decimal('电压kV',true,3);if(Number(v['电压kV'])<35||Number(v['电压kV'])>220)fieldError('电压kV','允许范围35～220');
  decimal('截面积mm2',true,4);if(!/^\d+$/.test(v['芯数'])||Number(v['芯数'])<1||Number(v['芯数'])>1000)fieldError('芯数','须为1～1000整数');
  enumValue('屏蔽结构',['铜带','铜丝','组合','无']);
 }
 if(kind.id==='recipe'){
  enumValue('检测项',['搭盖率','铜丝间隙','不圆度','护套厚度']);enumValue('判定方式',['上限','下限','区间']);
  const versionField=kind.business?'原版本':'原版本ID';
  if(v['操作']==='更新'&&!v[versionField])fieldError(versionField,'更新时必填');
  if(v['操作']==='新增'&&v[versionField])fieldError(versionField,'新增时须留空');
  for(const key of ['下限','上限']){
   const needed=v['判定方式']==='区间'||v['判定方式']===key;
   if(needed){if(!(kind.business&&v['检测项']==='护套厚度'&&key==='下限'&&!v[key]))decimal(key);}else if(v[key])fieldError(key,'当前判定方式须留空');
  }
  if(v['判定方式']==='区间'&&Number(v['下限'])>Number(v['上限']))fieldError('下限','不能大于上限');
  const unit=['铜丝间隙','护套厚度'].includes(v['检测项'])?'mm':'%';if(v['单位']!==unit&&!(kind.business&&!v['单位']))fieldError('单位',`当前检测项须填写${unit}`);
  if(v['检测项']==='护套厚度'){
   decimal('护套标准厚度mm',true);if(!v['规格编号']||v['规格编号'].includes(';'))fieldError('规格编号','护套厚度配方须填写一个规格');
   if(v['判定方式']!=='下限')fieldError('判定方式','护套厚度使用下限判定');
   if(!(kind.business&&!v['下限'])&&Math.abs(Number(v['下限'])-Number(v['护套标准厚度mm'])*.95)>1e-9)fieldError('下限','须等于护套标准厚度×95%');
  }else if(v['护套标准厚度mm'])fieldError('护套标准厚度mm','非护套配方须留空');
 }
 if(kind.id==='task'||kind.id==='plan')decimal('计划长度m',true);
 if(kind.business){
  const limits:Record<string,number>={'工单编号':128,'线缆编号':128,'原线缆编号':128,'主盘编号':128,'主盘所属工单':128,'配方编号':64,'配方名称':128,'标准依据':1000,'计划名称':128,'线缆型号':128,'客户编码':128,'产品类型':128};
  for(const [key,limit] of Object.entries(limits))if((v[key]||'').length>limit)fieldError(key,`最多${limit}个字符`);
  if(kind.id==='order'&&v['设备编号']){
   for(const key of ['线缆编号','检测标准编号','标准版本','计划长度m'])if(!v[key])fieldError(key,'分配检测任务时必填');
   decimal('计划长度m',true);
  }
 }
}
