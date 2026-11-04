import {type ApiClient,type Person} from './api';
import {ImportFieldError,fieldError,importRowNumber,rowError,validateImportRow} from './importValidation';
export type ImportField={label:string;hint:string;example:string;required?:string};
export type ImportKind={id:string;title:string;group:string;permission:string;description:string;fields:ImportField[];destination:string;business?:boolean};
const f=(label:string,hint:string,example=''):ImportField=>({label,hint,example});
const action=f('操作','新增或更新；不自动覆盖同编号记录','新增');
const reason=f('变更原因','必填，最多500字','批量登记');
const specs=f('规格编号','多个用英文分号隔开；须先登记规格','SP035-300');
const metric=f('检测项','搭盖率 / 铜丝间隙 / 不圆度 / 护套厚度','铜丝间隙');
const taskFields=[f('工单编号','已有工单编号','WO-001'),f('线缆编号','此工单下已有线缆编号','P-001'),f('设备编号','已有设备编号；工序由设备确定','HY-JX-01'),f('配方版本ID','从引用资料下载中复制启用版本ID','请填写配方版本ID'),f('护套配方版本ID','双测径设备必填；一次生成不圆度和护套两个任务'),f('计划长度m','大于0的十进制数；订单计划量，不是采样位置','100')];
export const importKinds:ImportKind[]=[
 {id:'spec',title:'线缆规格',group:'基础档案',permission:'catalog:write',destination:'specs',description:'新增或更新规格及适用工序。更新按完整一行替换；已有任务快照不变。',fields:[action,f('规格编号','唯一编号，最多64字','SP035-300'),f('规格名称','必填，最多128字','35kV 300平方线缆'),f('电压kV','35～220，最多3位小数','35'),f('截面积mm2','正数，最多4位小数','300'),f('芯数','1～1000整数','1'),f('屏蔽结构','铜带/铜丝/组合/无','铜丝'),f('启用','是或否','是'),f('线缆型号','可空'),f('客户编码','可空'),f('产品类型','可空'),f('说明','可空，最多2000字'),f('适用工序及检测项','工序ID:检测项，多组用分号；工序ID见引用资料','请填写工序ID:铜丝间隙'),reason]},
 {id:'recipe',title:'检测标准与配方',group:'质量配置',permission:'rules:write',destination:'recipes',description:'新增配方或为已有版本追加版本。更新会停用旧版本；生产批准和历史快照不随导入改变。',fields:[action,f('原版本ID','新增留空；更新须填当前配方版本ID'),f('配方编号','唯一编号；更新不能改编号','JX-001'),f('配方名称','必填','铜丝间隙标准'),metric,f('判定方式','上限/下限/区间','上限'),f('下限','下限或区间必填；上限判定留空'),f('上限','上限或区间必填；下限判定留空','3'),f('单位','搭盖率/不圆度用%；间隙/护套用mm','mm'),f('规格编号','分号分隔；空表示全部适用规格；护套必须一个'),f('护套标准厚度mm','仅护套填写，正数；下限必须等于此值×95%'),f('标准依据','标准编号、条款或已确认协议；必填','请填写依据条款'),reason]},
 {id:'recipe-state',title:'配方启停',group:'质量配置',permission:'rules:write',destination:'recipes',description:'逐版本启用或停用，不删除历史规则。',fields:[f('配方版本ID','从引用资料复制','请填写版本ID'),f('启用','是或否','是'),reason]},
 {id:'order',title:'工单与订单规格',group:'生产组织',permission:'task:write',destination:'workorders',description:'一个工单可关联多个规格。更新只调整规格集合，不改工单编号。',fields:[action,f('工单编号','唯一编号','WO-001'),specs]},
 {id:'spool',title:'线缆登记',group:'生产组织',permission:'task:write',destination:'trace',description:'向已有工单登记线缆，每条线缆明确一个规格。',fields:[f('工单编号','已有工单编号','WO-001'),f('线缆编号','同工单内不得重复','P-001'),f('规格编号','须属于此工单','SP035-300')]},
 {id:'spool-edit',title:'线缆编号与归组',group:'生产组织',permission:'task:write',destination:'trace',description:'按内部ID修改编号或主盘归组；有运行任务时不能调整归组。',fields:[f('线缆ID','从引用资料复制','请填写线缆ID'),f('线缆编号','新编号','P-002'),f('主盘ID','留空表示独立主盘；不能填自身'),reason]},
 {id:'task',title:'检测任务',group:'生产组织',permission:'task:write',destination:'tasks',description:'为已登记线缆分配设备与规则。双测径一行生成两个同步任务，不在导入时启动检测。',fields:taskFields},
 {id:'plan',title:'批量检测计划',group:'生产组织',permission:'task:write',destination:'tasks?view=plans',description:'相同计划名称的行合为一份草稿，最多50项；保存后到计划页生成任务。',fields:[f('计划名称','文件内同名归为一份计划','本周检测计划'),...taskFields]},
];
export const headersFor=(k:ImportKind)=>['行类型',...k.fields.map(f=>f.label)];
const metricMap:Record<string,string>={'搭盖率':'SHIELD_OVERLAP_RATE','铜丝间隙':'WIRE_GAP','不圆度':'OVALITY','护套厚度':'SHEATH_THICKNESS'};
export type Refs={catalog:any;orders:any[];spools:any[];profiles:any[];users:any[];settings:any;edge:any[];factories:any[]};
export async function loadImportRefs(api:ApiClient,kind:string):Promise<Refs>{
 if(!importKinds.some(k=>k.id===kind))throw Error('此类别不支持业务数据导入');
 const r:Refs={catalog:await api.request('/catalog'),orders:[],spools:[],profiles:[],users:[],settings:null,edge:[],factories:[]};
 if(['order','spool','spool-edit','task','plan'].includes(kind))r.orders=await api.all('/work-orders');
 if(['spool','spool-edit','task','plan'].includes(kind))r.spools=await api.all('/spools');
 return r;
}
export type ImportCommand={row:number;label:string;path:string;body:any;version?:string;key:string;readback:{path:string;id?:string;field?:string};result?:any;status:'ready'|'saved'|'error'|'unknown';error?:string};
const required=(v:string,label:string)=>{if(!v)fieldError(label,'不能为空');return v;};
const bool=(v:string)=>{if(!['是','否'].includes(v))throw Error('启用请填写是或否');return v==='是';};
const list=(v:string)=>v?v.split(';').map(s=>s.trim()).filter(Boolean):[];
const one=(rows:any[],value:string,field='id',label='引用')=>{const hits=rows.filter(x=>String(x[field])===value);if(hits.length!==1)fieldError(label,label+'不存在或不唯一：'+value);return hits[0];};
const positive=(v:string)=>{if(!/^\d+(\.\d+)?$/.test(v)||Number(v)<=0)throw Error('请输入大于0的十进制数');return v;};
export function prepareImport(kind:string,rows:Record<string,string>[],r:Refs,_user:Person):ImportCommand[]{
 if(!importKinds.some(k=>k.id===kind))throw Error('此类别不支持业务数据导入');
 const spec=(code:string)=>one(r.catalog.product_specification,code,'code','规格');
 const recipe=(id:string)=>{const x=one(r.catalog.recipes,id,'id','配方版本');if(!x.enabled)throw Error('配方版本已停用：'+id);return x;};
 const device=(id:string)=>one(r.catalog.device,id,'id','设备');
 const command=(n:number,label:string,path:string,body:any,version:any,readback:ImportCommand['readback']):ImportCommand=>({row:importRowNumber(rows[n],n),label,path,body,version:version===undefined?undefined:String(version),key:crypto.randomUUID(),readback,status:'ready'});
 const task=(v:Record<string,string>)=>{
  const w=one(r.orders,v['工单编号'],'external_code','工单'),s=one(r.spools.filter(s=>s.work_order_id===w.id),v['线缆编号'],'spool_code','线缆'),d=device(v['设备编号']),rec=recipe(v['配方版本ID']);
  if(!d.enabled||rec.metric_code!==d.metric_code)throw Error('设备不可用或配方指标不匹配');
  if(d.metric_code==='SHEATH_THICKNESS')throw Error('请通过双测径主设备一次创建不圆度及护套任务');
  const b:any={work_order_id:w.id,spool_id:s.id,specification_id:s.specification_id||w.specification_id,process_id:d.process_id,device_id:d.id,metric_code:d.metric_code,recipe_version_id:rec.id,planned_length_m:positive(v['计划长度m'])};
  if(d.metric_code==='OVALITY'){const sh=recipe(required(v['护套配方版本ID'],'护套配方版本ID'));if(sh.metric_code!=='SHEATH_THICKNESS')throw Error('护套配方指标不匹配');b.sheath_recipe_version_id=sh.id;}
  else if(v['护套配方版本ID'])throw Error('该设备不能配置护套配方');return b;
 };
 const plans=new Map<string,{n:number;items:any[]}>(),targets=new Set<string>();
 const commands:ImportCommand[]=[];
 rows.forEach((v,n)=>{
 try{
  validateImportRow(importKinds.find(k=>k.id===kind)!,v);
  if('变更原因' in v)required(v['变更原因'],'变更原因');
  const mode=v['操作'];if('操作' in v&&!['新增','更新'].includes(mode))throw Error('操作只能为新增或更新');
  let c:ImportCommand;
  if(kind==='spec'){
   const existing=r.catalog.product_specification.find((s:any)=>s.code===v['规格编号']);if(mode==='新增'&&existing)throw Error('规格已存在，请使用更新');if(mode==='更新'&&!existing)throw Error('要更新的规格不存在');
   const structures:Record<string,string>={'铜带':'tape','铜丝':'wire','组合':'combined','无':'none'};if(!structures[v['屏蔽结构']])throw Error('屏蔽结构填写错误');
   const a=list(v['适用工序及检测项']).map(x=>{const [id,m,...extra]=x.split(':');one(r.catalog.inspection_process,id,'id','工序');if(extra.length||!metricMap[m])throw Error('适用工序格式错误');return {process_id:id,metric_code:metricMap[m]};});if(!a.length)throw Error('至少填写一个适用工序及检测项');
   const b={code:required(v['规格编号'],'规格编号'),name:required(v['规格名称'],'规格名称'),voltage_kv:v['电压kV'],conductor_area_mm2:positive(v['截面积mm2']),core_count:Number(v['芯数']),shield_structure:structures[v['屏蔽结构']],enabled:bool(v['启用']),cable_model:v['线缆型号'],customer_code:v['客户编码'],product_type:v['产品类型'],description:v['说明'],applicability:a,reason:v['变更原因']};
   if(!/^\d{1,3}(\.\d{1,3})?$/.test(b.voltage_kv)||Number(b.voltage_kv)<35||Number(b.voltage_kv)>220||!Number.isInteger(b.core_count)||b.core_count<1||b.core_count>1000)throw Error('电压或芯数超出允许范围');
   c=command(n,b.code,'/catalog/specifications'+(mode==='更新'?'/'+existing.id:''),b,mode==='更新'?existing.version:undefined,{path:'/catalog/specifications/$id'});
  }else if(kind==='recipe'){
   const m=metricMap[v['检测项']],op=({'上限':'LE','下限':'GE','区间':'BETWEEN'} as Record<string,string>)[v['判定方式']];if(!m||!op)throw Error('检测项或判定方式填写错误');
   if(!v['单位']||v['单位']!==(['WIRE_GAP','SHEATH_THICKNESS'].includes(m)?'mm':'%'))throw Error('单位与指标不匹配');
   const old=mode==='更新'?one(r.catalog.recipes,v['原版本ID'],'id','原配方版本'):null;
   if(mode==='新增'&&v['原版本ID'])throw Error('新增时原版本ID须留空');
   if(mode==='新增'&&r.catalog.recipes.some((x:any)=>x.code.toLowerCase()===v['配方编号'].toLowerCase()))throw Error('配方编号已存在');
   const b:any={code:required(v['配方编号'],'配方编号'),name:required(v['配方名称'],'配方名称'),metric_code:m,unit:v['单位'],comparison:{operator:op,lower:v['下限']||null,upper:v['上限']||null},specification_ids:list(v['规格编号']).map(x=>spec(x).id),standard_reference:required(v['标准依据'],'标准依据'),reason:v['变更原因']};
   for(const [key,needed] of [['lower',op!=='LE'],['upper',op!=='GE']] as const){const x=b.comparison[key];if(needed?!x||!/^\d+(\.\d+)?$/.test(x):x!==null)throw Error('上下限与判定方式不一致');}
   if(m==='SHEATH_THICKNESS')b.nominal_thickness_mm=positive(v['护套标准厚度mm']);else if(v['护套标准厚度mm'])throw Error('非护套配方不填写护套厚度');
   c=command(n,b.code,old?`/recipes/${old.id}/versions`:'/recipes',b,old?.version,{path:'/recipes'});
  }else if(kind==='recipe-state'){
   const x=one(r.catalog.recipes,v['配方版本ID'],'id','配方');c=command(n,x.code,`/recipes/${x.id}/status`,{enabled:bool(v['启用']),reason:v['变更原因']},x.version,{path:'/recipes',id:x.id});
  }else if(kind==='order'){
   const ids=list(v['规格编号']).map(x=>spec(x).id);if(!ids.length)throw Error('至少一个规格');const old=r.orders.find(w=>w.external_code===v['工单编号']);if(mode==='新增'&&old)throw Error('工单已存在');if(mode==='更新'&&!old)throw Error('工单不存在');
   c=command(n,required(v['工单编号'],'工单编号'),old?`/work-orders/${old.id}/specifications`:'/work-orders',old?{specification_ids:ids}:{external_code:v['工单编号'],specification_ids:ids},undefined,{path:'/work-order-summaries/$id',id:old?.id});
  }else if(kind==='spool'){
   const w=one(r.orders,v['工单编号'],'external_code','工单'),s=spec(v['规格编号']);if(r.spools.some(x=>x.work_order_id===w.id&&x.spool_code===v['线缆编号']))throw Error('此工单已存在同编号线缆');
   c=command(n,required(v['线缆编号'],'线缆编号'),'/spools',{work_order_id:w.id,spool_code:v['线缆编号'],specification_id:s.id},undefined,{path:'/production/spools',field:'spool'});
  }else if(kind==='spool-edit'){
   const s=one(r.spools,v['线缆ID'],'id','线缆');if(v['主盘ID'])one(r.spools,v['主盘ID'],'id','主盘');c=command(n,required(v['线缆编号'],'线缆编号'),`/spools/${s.id}:edit`,{spool_code:v['线缆编号'],canonical_spool_id:v['主盘ID']||null,reason:v['变更原因']},s.version,{path:'/production/spools',id:s.id,field:'spool'});
  }else if(kind==='task'||kind==='plan'){
   const b=task(v);if(kind==='plan'){const name=required(v['计划名称'],'计划名称'),p=plans.get(name)||{n,items:[]};if(p.items.some(x=>x.spool_id===b.spool_id&&x.device_id===b.device_id))throw Error('同一计划同盘同设备重复');p.items.push(b);if(p.items.length>50)throw Error('每份计划最多50项');plans.set(name,p);return;}
   c=command(n,v['线缆编号']+' / '+v['设备编号'],'/tasks',b,undefined,{path:'/tasks/$id'});
  }else throw Error('不支持的导入类型');
  const target=kind+':'+(kind==='task'?c.body.spool_id+':'+c.body.device_id:c.label);if(targets.has(target))throw Error('文件中重复操作同一对象');targets.add(target);commands.push(c);
 }catch(e){
  const message=(e as Error).message;
  const aliases:Record<string,string>={'规格':'规格编号','配方版本':'配方版本ID','原配方版本':'原版本ID','配方':'配方版本ID','设备':'设备编号','边缘设备':'设备编号','工单':'工单编号','线缆':kind==='spool-edit'?'线缆ID':'线缆编号','主盘':'主盘ID','工序':'适用工序及检测项','工厂':'工厂及角色'};
  const exact=e instanceof ImportFieldError?e.field:importKinds.find(k=>k.id===kind)!.fields.map(f=>f.label).sort((a,b)=>b.length-a.length).find(f=>message.includes(f));
  const inferred=exact||Object.keys(aliases).sort((a,b)=>b.length-a.length).find(f=>message.includes(f))||(/账号/.test(message)?'登录账号':/角色/.test(message)?'工厂及角色':/计划/.test(message)?'计划名称':/密度/.test(message)?'显示密度':/重复/.test(message)?'整行':'关联字段');
  throw Error(rowError(importRowNumber(v,n),aliases[inferred]||inferred,message));
 }
 });
 for(const [name,p] of plans)commands.push(command(p.n,name,'/plans',{name,items:p.items},undefined,{path:'/plans/$id'}));
 return commands;
}
export async function verifyImported(api:ApiClient,c:ImportCommand){
 const id=c.readback.id||c.result?.id;if(!id&&!['platform','personal'].includes(c.readback.field||''))throw Error('服务端未返回可回读的对象ID');
 const path=c.readback.path.replace('$id',encodeURIComponent(id||''));let data:any;
 if(['spool','user'].includes(c.readback.field||'')){
  for(let page=1;;page++){const p=await api.request<any>(path+`?limit=100&page=${page}`);const found=p.items.find((x:any)=>x.id===id);if(found){data=found;break;}if(page*100>=p.total)break;}
 }else data=await api.request<any>(path);
 if(c.readback.field==='device')data=data.device.find((x:any)=>x.id===id);
 else if(c.readback.field==='device_id')data=(Array.isArray(data)?data:data.items).find((x:any)=>x.device_id===id);
 else if(c.readback.field==='platform'||c.readback.field==='personal')data=data[c.readback.field];
 else if(Array.isArray(data))data=data.find(x=>x.id===id);
 if(!data)throw Error('写入已确认，但未找到回读对象；请到所属页面核对');return data;
}
