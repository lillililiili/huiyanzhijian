import {type ApiClient,type Person,names} from './api';
import {importKinds as legacyKinds,prepareImport,loadImportRefs,verifyImported,type ImportKind,type ImportCommand,type Refs} from './importRegistry';
import {fieldError,importRowNumber,markImportRow,rowError,validateImportRow} from './importValidation';
import {availableRecipes,sheathMinimum} from './recipeOptions';
const f=(label:string,hint:string,example='',required='必填')=>({label,hint,example,required});
const rules=[f('检测标准编号','选用配方与判定规则页面的配方编号','JX-001'),f('标准版本','填写页面版本，如V1.0；不自动选择最新版本','V1.0'),f('护套标准编号','双测径设备需同时选择本规格护套配方','','双测径设备必填'),f('护套标准版本','护套配方的明确版本，如V1.0','','双测径设备必填')];
const execution=[f('工单编号','所属订单 / 工单编号','WO-001'),f('线缆编号','该工单下的线缆盘号','P-001'),f('规格编号','该盘线缆的规格，须属于所属工单','SP035-300'),f('设备编号','执行设备；工序和检测项由已配置设备确定','HY-JX-01'),...rules,f('计划长度m','此线缆本次检测的计划量，大于0；不作为采样位置','100')];
export const businessImportKinds:ImportKind[]=legacyKinds.map(k=>{
 let fields=k.fields.map(x=>({...x})),description=k.description;
 if(k.id==='spec')fields=fields.map(x=>x.label==='适用工序及检测项'?f(x.label,'按手动页面填写“工序名称:检测项”，多项分号分隔；检测项：搭盖率/铜丝间隙/不圆度/护套厚度','铜丝屏蔽:铜丝间隙'):x);
 if(k.id==='recipe')fields=fields.filter(x=>x.label!=='原版本ID').map(x=>x.label==='下限'?f(x.label,'下限/区间填写；护套留空，按标准值×95%自动计算','','下限或区间必填；护套自动计算'):x.label==='单位'?f(x.label,'按检测项自动确定，可留空；手填时须一致','mm','选填'):x).concat([f('原版本','更新时填写原配方版本，如V1.0；新增留空','','更新时必填')]);
 if(k.id==='recipe-state')fields=[f('配方编号','配方与判定规则页面的编号','JX-001'),f('标准版本','明确指定启停的版本','V1.0'),...k.fields.filter(x=>x.label!=='配方版本ID')];
 if(k.id==='spool-edit')description='按工单编号和盘号修改线缆编号或归组；归并目标须为同规格独立主盘，有运行任务时不能调整归组。';
 if(k.id==='spool-edit')fields=[f('工单编号','要修改线缆所属工单','WO-001'),f('原线缆编号','修改前的盘号','P-001'),f('线缆编号','修改后的盘号','P-002'),f('主盘所属工单','归并目标主盘的工单；解除归并时与主盘编号一起留空','','归并时必填'),f('主盘编号','相同规格的独立主盘；解除归并时留空','','归并时必填'),...k.fields.filter(x=>x.label==='变更原因')];
 if(k.id==='task'||k.id==='plan')fields=k.id==='task'?execution:[k.fields[0],...execution];
 if(k.id==='order'){
 fields=[f('操作','新增：新工单；补充：向已有工单追加规格/线缆/任务，不移除原内容','新增'),f('工单编号','一个订单对应一个工单；相同编号多行自动归为同一工单','WO-001'),f('规格编号','已有规格编号；仅建工单可用分号；有线缆时一行一个规格','SP035-300'),f('线缆编号','填写则登记此盘；同工单同盘多行仅登记一次','P-001','选填'),...execution.filter(x=>!['工单编号','线缆编号','规格编号'].includes(x.label)).map(x=>({...x,required:x.label.startsWith('护套')?'双测径设备必填':'分配任务时必填'}))];
 description='按订单组织导入：一行对应一盘线缆的一台检测设备及所用标准。同工单可多规格、多盘、多设备；先建工单和线缆，再分配任务。规格和标准须先维护。';
 }
 if(k.id==='recipe')description='按手动配方页面同步规格适用检测项，再创建或追加标准版本。护套下限按标准厚度×95%计算，历史任务保持原快照。';
 return {...k,fields,description,business:true} as ImportKind;
});
export type BusinessCommand=ImportCommand&{kind:string;depends:string[];expected?:any;display:Record<string,string>;destination?:string;resolved?:{path:string;body:any;version?:string};reuse?:boolean};
const split=(x:string)=>x?x.split(';').map(x=>x.trim()).filter(Boolean):[];
const unique=(items:any[],value:string,key:string,field:string)=>{const hits=items.filter(x=>String(x[key])===value);if(hits.length!==1)fieldError(field,`${value}不存在或不唯一`);return hits[0];};
const mapMetric:Record<string,string>={'搭盖率':'SHIELD_OVERLAP_RATE','铜丝间隙':'WIRE_GAP','不圆度':'OVALITY','护套厚度':'SHEATH_THICKNESS'};
const token=(key:string)=>`@imp:${key}`;
const deps=(v:any):string[]=>[...new Set((JSON.stringify(v).match(/@imp:[a-f0-9-]+/g)||[]).map(s=>s.slice(5)))];
export async function loadBusinessRefs(api:ApiClient,kind:string){
 const r=await loadImportRefs(api,kind);
 if(kind==='order')r.spools=await api.all('/spools');
 if(kind==='recipe')for(const s of r.catalog.product_specification){s.applicability=(r.catalog.specification_applicability||[]).filter((a:any)=>a.specification_id===s.id).map(({process_id,metric_code}:any)=>({process_id,metric_code}));}
 return r;
}
export async function prepareBusinessImport(api:ApiClient,kind:string,rows:Record<string,string>[],refs:Refs,user:Person):Promise<BusinessCommand[]>{
 const schema=businessImportKinds.find(k=>k.id===kind);if(!schema)throw Error('不支持的业务导入');
 if(!user.permissions.includes(schema.permission))throw Error('没有此项维护权限');
 const r:Refs=structuredClone(refs),out:BusinessCommand[]=[];
 const rule=(code:string,revision:string,field:string)=>{const hits=r.catalog.recipes.filter((x:any)=>x.code===code&&x.revision===revision);if(hits.length!==1)fieldError(field,`${code} ${revision}不存在或不唯一，请填写确切编号与版本`);return hits[0];};
 const rowAt=(v:Record<string,string>,n:number,fn:()=>any)=>{try{return fn();}catch(e){throw Error(rowError(importRowNumber(v,n),(e as any).field||'业务关联',(e as Error).message));}};
 const normalize=(v:Record<string,string>,n:number)=>rowAt(v,n,()=>{
  validateImportRow(schema,v);const x={...v};
  if(kind==='spec')x['适用工序及检测项']=split(v['适用工序及检测项']).map(pair=>{const i=pair.lastIndexOf(':');const name=pair.slice(0,i),metric=pair.slice(i+1);if(i<1||!mapMetric[metric])fieldError('适用工序及检测项','格式为工序名称:检测项，多项以分号隔开');const hits=r.catalog.inspection_process.filter((p:any)=>p.name===name||p.code===name);if(hits.length!==1)fieldError('适用工序及检测项',`工序“${name}”不存在或重名，请使用引用资料中的唯一工序编号`);return hits[0].id+':'+metric;}).join(';');
  if(kind==='recipe'){
   x['原版本ID']=v['操作']==='更新'?rule(v['配方编号'],v['原版本'],'原版本').id:'';
   x['单位']=v['单位']||(['铜丝间隙','护套厚度'].includes(v['检测项'])?'mm':'%');
   if(v['检测项']==='护套厚度'){const lower=sheathMinimum(v['护套标准厚度mm']);if(!lower)fieldError('护套标准厚度mm','须为最多8位小数的正数');if(v['下限']&&Number(v['下限'])!==Number(lower))fieldError('下限','与标准厚度×95%不一致');x['下限']=lower;}
   if(v['检测项']==='不圆度'&&v['判定方式']!=='上限')fieldError('判定方式','与手动页面一致，不圆度使用上限');
   if(x['单位']==='%'&&[x['下限'],x['上限']].some(s=>s&&Number(s)>100))fieldError('判定方式','百分比限值不能超过100');
   if(v['操作']==='更新'&&rule(v['配方编号'],v['原版本'],'原版本').metric_code!==mapMetric[v['检测项']])fieldError('检测项','已有配方不能改变检测项');
  }
  if(kind==='recipe-state')x['配方版本ID']=rule(v['配方编号'],v['标准版本'],'标准版本').id;
  if(kind==='spool-edit'){
   const w=unique(r.orders,v['工单编号'],'external_code','工单编号');const s=unique(r.spools.filter(s=>s.work_order_id===w.id),v['原线缆编号'],'spool_code','原线缆编号');x['线缆ID']=s.id;x['主盘ID']='';
   if(v['主盘编号']||v['主盘所属工单']){if(!v['主盘编号']||!v['主盘所属工单'])fieldError('主盘编号','归并须同时填写主盘工单和盘号');const mw=unique(r.orders,v['主盘所属工单'],'external_code','主盘所属工单'),m=unique(r.spools.filter(s=>s.work_order_id===mw.id),v['主盘编号'],'spool_code','主盘编号');if(m.id===s.id||m.canonical_spool_id||m.specification_id!==s.specification_id)fieldError('主盘编号','须为另一条相同规格的独立主盘');x['主盘ID']=m.id;}
  }
  return markImportRow(x,importRowNumber(v,n));
 });
 const normalized=rows.map(normalize);
 const add=(c:ImportCommand,k:string,v:Record<string,string>,extra:string[]=[])=>{const b={...c,kind:k,depends:[...new Set([...deps([c.body,c.path]),...extra])],display:v} as BusinessCommand;out.push(b);return b;};
 const legacy=(k:string,v:Record<string,string>,n:number)=>{const fields=legacyKinds.find(x=>x.id===k)!.fields;const input=Object.fromEntries(['行类型',...fields.map(f=>f.label)].map(key=>[key,v[key]||'']));try{return prepareImport(k,[markImportRow(input,importRowNumber(rows[n],n))],r,user)[0];}catch(e){throw Error((e as Error).message.replace(/护套配方版本ID/g,'护套标准编号 / 护套标准版本').replace(/配方版本ID/g,'检测标准编号 / 标准版本').replace(/原版本ID/g,'原版本').replace(/线缆ID/g,'原线缆编号').replace(/主盘ID/g,'主盘编号'));}};
 const taskRow=(v:Record<string,string>,n:number)=>rowAt(rows[n],n,()=>{
  const w=unique(r.orders,v['工单编号'],'external_code','工单编号'),s=unique(r.spools.filter(s=>s.work_order_id===w.id),v['线缆编号'],'spool_code','线缆编号'),spec=unique(r.catalog.product_specification,v['规格编号'],'code','规格编号'),d=unique(r.catalog.device,v['设备编号'],'code','设备编号');
  if(s.specification_id!==spec.id)fieldError('规格编号','与这盘线缆实际规格不一致');
  if(!(w.specification_ids||[w.specification_id]).includes(spec.id))fieldError('规格编号','不属于所选工单');
  if(!spec.enabled||!d.enabled||!(r.catalog.specification_applicability||[]).some((a:any)=>a.specification_id===spec.id&&a.process_id===d.process_id&&a.metric_code===d.metric_code))fieldError('设备编号','当前规格没有该启用设备的适用工序/检测项，请先维护规格或检测标准');
  const rec=rule(v['检测标准编号'],v['标准版本'],'检测标准编号');if(!availableRecipes([rec],d,spec.id).length)fieldError('检测标准编号','配方已停用、检测项/规格不符或未获设备环境允许');
  const x={...v,'设备编号':d.id,'配方版本ID':rec.id,'护套配方版本ID':''};
  if(d.metric_code==='OVALITY'){const sh=rule(v['护套标准编号'],v['护套标准版本'],'护套标准编号');if(!availableRecipes([sh],{...d,metric_code:'SHEATH_THICKNESS'},spec.id).length)fieldError('护套标准编号','不适用于当前规格及设备');x['护套配方版本ID']=sh.id;}
  else if(v['护套标准编号']||v['护套标准版本'])fieldError('护套标准编号','非双测径设备不填写护套标准');
  return markImportRow(x,importRowNumber(rows[n],n));
 });
 if(kind==='order'){
  const grouped=new Map<string,{rows:number[];specs:string[];mode:string}>();
  normalized.forEach((v,n)=>rowAt(rows[n],n,()=>{const ids=split(v['规格编号']).map(code=>{const s=unique(r.catalog.product_specification,code,'code','规格编号');if(!s.enabled)fieldError('规格编号','规格已停用');return s.id;});if(!ids.length)fieldError('规格编号','至少填写一个规格');if(v['线缆编号']&&ids.length!==1)fieldError('规格编号','有线缆时一行只能填写一个规格');const g=grouped.get(v['工单编号'])||{rows:[] as number[],specs:[] as string[],mode:v['操作']};if(g.mode!==v['操作'])fieldError('操作','同工单不能混用新增和补充');g.rows.push(n);g.specs=[...new Set([...g.specs,...ids])];grouped.set(v['工单编号'],g);}));
  for(const [code,g] of grouped){const n=g.rows[0];rowAt(rows[n],n,()=>{const old=r.orders.find(w=>w.external_code===code);if(g.mode==='新增'&&old)fieldError('操作','工单已存在，请使用补充');if(g.mode==='补充'&&!old)fieldError('工单编号','补充的工单不存在');const ids=[...new Set([...(old?.specification_ids|| (old?[old.specification_id]:[])),...g.specs])];
   const c=add({row:importRowNumber(rows[n],n),label:'工单 '+code,path:old?`/work-orders/${old.id}/specifications`:'/work-orders',body:old?{specification_ids:ids}:{external_code:code,specification_ids:ids},key:crypto.randomUUID(),readback:{path:'/work-order-summaries/$id',id:old?.id},status:'ready'},'order',{'工单编号':code,'规格编号':g.rows.map(i=>normalized[i]['规格编号']).join(';')});
   const obj={...old,id:old?.id||token(c.key),external_code:code,specification_ids:ids,specification_id:ids[0]};if(old)Object.assign(old,obj);else r.orders.push(obj);
  });}
  const spoolSteps=new Map<string,BusinessCommand>();
  normalized.forEach((v,n)=>rowAt(rows[n],n,()=>{if(!v['线缆编号']){if(execution.filter(x=>!['工单编号','线缆编号','规格编号'].includes(x.label)).some(x=>v[x.label]))fieldError('线缆编号','填写任务信息时必须指定线缆');return;}
   const w=unique(r.orders,v['工单编号'],'external_code','工单编号'),spec=unique(r.catalog.product_specification,v['规格编号'],'code','规格编号'),key=w.id+'|'+v['线缆编号'],existing=r.spools.find(s=>s.work_order_id===w.id&&s.spool_code===v['线缆编号']);
   if(existing){if(existing.specification_id!==spec.id)fieldError('规格编号','同一工单盘号的规格冲突');return;}
   const orderStep=out.find(c=>c.kind==='order'&&c.display['工单编号']===v['工单编号'])!;const c=add(legacy('spool',v,n),'spool',v,[orderStep.key]);c.label='线缆 '+v['工单编号']+' / '+v['线缆编号'];spoolSteps.set(key,c);r.spools.push({id:token(c.key),work_order_id:w.id,spool_code:v['线缆编号'],specification_id:spec.id});
  }));
  const signatures=new Map<string,number>();
  for(const [n,v] of normalized.entries()){
   if(!v['设备编号']){rowAt(rows[n],n,()=>{if(['检测标准编号','标准版本','护套标准编号','护套标准版本','计划长度m'].some(f=>v[f]))fieldError('设备编号','填写检测标准或长度时必须选择执行设备');});continue;}
   const x=taskRow(v,n),c=legacy('task',x,n);const sig=c.body.spool_id+'|'+c.body.device_id;if(signatures.has(sig))throw Error(rowError(importRowNumber(rows[n],n),'设备编号',`与第${signatures.get(sig)}行重复分配同盘同设备`));signatures.set(sig,importRowNumber(rows[n],n));
   // Existing orders may already contain tasks. Never silently add another execution via a repeated order import.
   if(!String(c.body.spool_id).startsWith('@imp:')){const page=await api.request<any>('/production/tasks?spool_id='+encodeURIComponent(c.body.spool_id)+'&device_id='+encodeURIComponent(c.body.device_id)+'&limit=1');if(page.total>0)throw Error(rowError(c.row,'设备编号','此盘已有该设备任务；请到检测任务页面查看或明确创建复检任务'));}
   const orderStep=out.find(c=>c.kind==='order'&&c.display['工单编号']===v['工单编号'])!;add(c,'task',v,[orderStep.key]);
  }
 }else if(kind==='recipe'){
  const recipeCommands=normalized.map((v,n)=>legacy('recipe',v,n));const sync=new Map<string,{spec:any;next:any[];n:number}>();
  recipeCommands.forEach((c,n)=>rowAt(rows[n],n,()=>{const selected=c.body.specification_ids.length?c.body.specification_ids:r.catalog.product_specification.filter((s:any)=>s.enabled).map((s:any)=>s.id);if(!selected.length)fieldError('规格编号','至少一个启用规格');for(const id of selected){const s=unique(r.catalog.product_specification,id,'id','规格编号');if(!s.enabled)fieldError('规格编号','规格已停用');const metric=c.body.metric_code,current=sync.get(id)||{spec:s,next:[...(s.applicability||[])],n};if(!current.next.some(a=>a.metric_code===metric)){const processes=[...new Set(r.catalog.device.filter((d:any)=>d.metric_code===(metric==='SHEATH_THICKNESS'?'OVALITY':metric)).map((d:any)=>d.process_id))];if(!processes.length)fieldError('检测项','当前没有对应设备工序，不能同步规格');processes.forEach(process_id=>current.next.push({process_id,metric_code:metric}));sync.set(id,current);}}}));
  const syncKeys:string[]=[];for(const {spec:s,next,n} of sync.values()){if(!user.permissions.includes('catalog:write'))throw Error(rowError(importRowNumber(rows[n],n),'规格编号','规格需要同步适用检测项，当前账号无规格维护权限'));const body=Object.fromEntries(['code','name','voltage_kv','conductor_area_mm2','core_count','shield_structure','enabled','cable_model','customer_code','product_type','description'].map(k=>[k,s[k]??'']));const c=add({row:importRowNumber(rows[n],n),label:'同步规格 '+s.code,path:'/catalog/specifications/'+s.id,body:{...body,applicability:next,reason:normalized[n]['变更原因']},version:String(s.version),key:crypto.randomUUID(),readback:{path:'/catalog/specifications/$id',id:s.id},status:'ready'},'spec',{'规格编号':s.code,'适用检测项':next.map(a=>names[a.metric_code]).join('、')});syncKeys.push(c.key);}
  recipeCommands.forEach((c,n)=>add(c,'recipe',rows[n],syncKeys));
 }else if(kind==='task'||kind==='plan'){
  const v=normalized.map(taskRow);const prepared=prepareImport(kind,v,r,user);prepared.forEach(c=>add(c,kind,rows.find((v,n)=>importRowNumber(v,n)===c.row)||rows[0]));
 }else normalized.forEach((v,n)=>{
  rowAt(rows[n],n,()=>{if(kind==='spool'){const w=unique(r.orders,v['工单编号'],'external_code','工单编号'),s=unique(r.catalog.product_specification,v['规格编号'],'code','规格编号');if(!(w.specification_ids||[w.specification_id]).includes(s.id))fieldError('规格编号','不属于所选工单');}});
  add(legacy(kind,v,n),kind,rows[n]);
 });
 // Reject duplicate writes even when distinct rows have different descriptions.
 const seen=new Set<string>();for(const c of out){const key=c.kind+'|'+c.path+'|'+(c.kind==='recipe'?c.body.code:c.kind==='spool'?c.body.work_order_id+'|'+c.body.spool_code:c.kind==='spec'?c.body.code:c.label);if(seen.has(key))throw Error(rowError(c.row,'业务对象','文件中重复修改同一对象'));seen.add(key);}
 return out;
}
export function resolveBusinessCommand(c:BusinessCommand,commands:BusinessCommand[]){
 if(c.resolved)return c.resolved;
 for(const key of c.depends)if(commands.find(x=>x.key===key)?.status!=='saved')throw Error('前置业务尚未保存并核对，不能继续当前步骤');
 const resolve=(v:any):any=>{if(Array.isArray(v))return v.map(resolve);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]));if(typeof v==='string')return v.replace(/@imp:([a-f0-9-]+)/g,(_,key)=>{const dep=commands.find(x=>x.key===key);if(!dep?.result?.id||dep.status!=='saved')throw Error('前置对象尚未保存');return dep.result.id;});return v;};
 c.resolved={path:resolve(c.path),body:resolve(c.body),version:c.version};return c.resolved;
}
function same(a:any,b:any,numeric=false):boolean{if(a===b)return true;if(a===null||a===undefined||b===null||b===undefined)return false;if(Array.isArray(b))return Array.isArray(a)&&a.length===b.length&&b.every(x=>a.some(y=>same(y,x)));if(typeof b==='object')return Object.entries(b).every(([k,v])=>same(a[k],v,['lower','upper','nominal_thickness_mm'].includes(k)));if(typeof a==='number'||typeof b==='number'||numeric&&typeof a==='string'&&typeof b==='string'&&/^\d+(\.\d+)?$/.test(a)&&/^\d+(\.\d+)?$/.test(b))return Number(a)===Number(b);return false;}
export async function verifyBusinessImport(api:ApiClient,c:BusinessCommand){
 const data=await verifyImported(api,c),b=c.resolved?.body||c.body;
 const expect=(actual:any,expected:any,label:string)=>{if(!same(actual,expected,['voltage_kv','conductor_area_mm2','core_count','护套标准值','任务 planned_length_m'].includes(label)))throw Error(`已写入，但${label}回读不一致，请到对应页面核对；不会重复提交已确认写入`);};
 if(c.kind==='spec')for(const k of ['code','name','voltage_kv','conductor_area_mm2','core_count','shield_structure','enabled','cable_model','customer_code','product_type','description','applicability'])expect(data[k],b[k],k);
 if(c.kind==='recipe'){for(const k of ['code','name','metric_code','unit','specification_ids','standard_reference'])expect(data[k],b[k],k);expect(data.rule_snapshot?.comparison,b.comparison,'判定上下限');if(b.nominal_thickness_mm)expect(data.rule_snapshot?.parameters?.nominal_thickness_mm,b.nominal_thickness_mm,'护套标准值');}
 if(c.kind==='recipe-state')expect(data.enabled,b.enabled,'配方启停');
 if(c.kind==='order'){if(b.external_code)expect(data.external_code,b.external_code,'工单编号');expect(data.specification_ids,b.specification_ids,'订单规格集合');}
 if(c.kind==='spool')for(const k of ['work_order_id','spool_code','specification_id'])expect(data[k],b[k],'线缆 '+k);
 if(c.kind==='spool-edit')for(const k of ['spool_code','canonical_spool_id'])expect(data[k],b[k],'线缆身份 '+k);
 const checkTask=(t:any,body:any)=>{for(const k of ['work_order_id','spool_id','specification_id','device_id','process_id','metric_code','planned_length_m'])expect(t[k],body[k],'任务 '+k);expect(t.recipe_version_id,body.recipe_version_id,'任务冻结配方');};
 if(c.kind==='task'){checkTask(data,b);if(b.sheath_recipe_version_id){const paired=c.result?.simultaneous_tasks?.find((x:any)=>x.metric_code==='SHEATH_THICKNESS');if(!paired)throw Error('未返回同步护套任务');const ht=await api.request<any>('/tasks/'+paired.id);checkTask(ht,{...b,metric_code:'SHEATH_THICKNESS',recipe_version_id:b.sheath_recipe_version_id});} }
 if(c.kind==='plan'){expect(data.name,b.name,'计划名称');expect(data.items?.length,b.items.length,'计划执行项数量');for(const item of b.items){const found=data.items.map((x:any)=>x.request).find((x:any)=>x.spool_id===item.spool_id&&x.device_id===item.device_id);if(!found)throw Error('计划缺少执行项');checkTask(found,item);if(item.sheath_recipe_version_id)expect(found.sheath_recipe_version_id,item.sheath_recipe_version_id,'计划护套配方');}}
 const id=c.readback.id||c.result.id;c.destination=c.kind==='spec'?`specs?id=${id}`:c.kind.startsWith('recipe')?`recipes`:c.kind==='order'?`workorders?id=${id}`:c.kind.startsWith('spool')?`trace?spool=${id}`:c.kind==='plan'?`tasks?view=plans&plan=${id}`:`task?id=${id}`;
 return data;
}
