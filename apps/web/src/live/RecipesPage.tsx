import {useState} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {Button} from '../ui/Button';
import {Field,TextInput} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {Note} from '../ui/Note';
import {useRead} from './ServerLists';
import {names,ruleText,labelTime,type Recipe,type ApiClient,type Commands,type Workspace,type Person} from './api';
import {metricUnits} from './recipeOptions';
import './recipes.css';

type Props={api:ApiClient;commands:Commands;data:Workspace;user:Person;refresh:()=>Promise<void>;params:URLSearchParams};
type History={versions:Recipe[];events:{recipe_version_id:string;enabled:boolean;version:string;actor_id:string;reason:string;recorded_at:string}[]};
const reference='《慧眼智检-宏亮电缆有限公司应用方案》：参考判定目标，非已批准生产标准';
export function RecipesPage({api,commands,data,user,refresh,params}:Props){
 const [tick,setTick]=useState(0),[metric,setMetric]=useState(params.get('metric_code')||''),[query,setQuery]=useState(''),[show,setShow]=useState<'all'|'enabled'|'disabled'>('all');
 const [edit,setEdit]=useState<Recipe|'new'|null>(null),[status,setStatus]=useState<Recipe|null>(null),[history,setHistory]=useState('');
 const {value,error}=useRead<Recipe[]>(api,'/recipes',tick);const historyRead=useRead<History>(api,history?`/recipes/${history}/versions`:'',tick);
 const write=user.permissions.includes('rules:write');
 const reload=async()=>{setTick(t=>t+1);await refresh();};
 const rows=(value||[]).filter(r=>(!metric||r.metric_code===metric)&&(!query||(r.code+' '+r.name).toLowerCase().includes(query.toLowerCase()))&&(show==='all'||r.enabled===(show==='enabled')));
 const scope=(r:Recipe)=>r.specification_ids?.length?r.specification_ids.map(id=>data.catalog.product_specification.find(s=>s.id===id)?.code||id).join('、'):'全部适用规格';
 return <><PageTitle title="配方与判定规则" subtitle="设置三项检测标准；编辑生成新版本，已有任务保留原规则。" actions={<><Button onClick={()=>void reload()}>刷新</Button>{write&&<Button primary disabled={!value} onClick={()=>setEdit('new')}>新增配方</Button>}</>}/>
 <Note>仅供模拟测试，不能用于生产放行。参考资料提供间隙≤3 mm、不圆度≤8%的参考目标；搭盖率限值需手动填写测试依据。设备测量精度不作为产品限值。</Note>
 {!write&&<Note>{user.permissions.includes('task:write')?'当前账号可查看和选用配方':'当前账号仅可查看配方'}；新增、编辑及启停由管理员维护。</Note>}
 <div className="rule-filters"><Field label="检测项"><select value={metric} onChange={e=>setMetric(e.target.value)}><option value="">全部检测项</option>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></Field><Field label="配方搜索"><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="编号或名称"/></Field><Field label="启停状态"><select value={show} onChange={e=>setShow(e.target.value as typeof show)}><option value="all">全部版本</option><option value="enabled">已启用</option><option value="disabled">已停用</option></select></Field></div>
 {error&&<Note>{error} 请刷新后重试。</Note>}
 <Panel core table title="配方与规则版本">{value&&<DataTable headers={['配方 / 版本','检测标准','适用规格','状态','操作']} rows={rows.map(r=>[<><strong>{r.name}</strong><div className="muted small">{r.code} · {r.revision}</div></>,<>{names[r.metric_code]}<div>{ruleText(r.rule_snapshot).replace(/ · [^·]+$/,'')} {r.unit}</div><details><summary>标准依据</summary><div className="rule-reference">{r.standard_reference}</div></details></>,<span className="rule-scope">{scope(r)}</span>,<>{r.enabled?'已启用':'已停用'}<div className="muted small">仅供模拟测试</div></>,<div className="rule-actions"><Button onClick={()=>setHistory(r.id)}>版本履历</Button>{write&&r.approval_state==='TEST_ONLY'&&<><Button onClick={()=>setEdit(r)}>编辑</Button><Button onClick={()=>setStatus(r)}>{r.enabled?'停用':'启用'}</Button></>}</div>])}/>} {!value&&!error&&<Note>正在读取配方…</Note>}{value&&!rows.length&&<Note>暂无符合条件的配方。{write?'可新增配方或调整筛选。':'请联系管理员维护。'}</Note>}</Panel>
 {edit&&<RecipeEditor recipe={edit==='new'?undefined:edit} initialMetric={metric} data={data} api={api} commands={commands} close={()=>setEdit(null)} saved={reload}/>}
 {status&&<Modal title={`${status.enabled?'停用':'启用'}配方 · ${status.name} ${status.revision}`} open onClose={()=>setStatus(null)} onSubmit={async v=>{await commands.run(`/recipes/${status.id}/status`,{enabled:!status.enabled,reason:String(v.get('reason')).trim()},String(status.version));await reload();}}><Note>{status.enabled?'停用后不能用于新任务或自动发现新任务。已经创建的任务继续使用原快照；请检查已绑定此版本的自动发现配置。':'启用后，此版本可再次用于适用规格的新任务。其他版本的状态不会改变。'}</Note><Field label="启停原因"><TextInput name="reason" required maxLength={500}/></Field></Modal>}
 {history&&<Modal title="配方版本履历" open submitLabel="关闭" onClose={()=>setHistory('')} onSubmit={()=>{setHistory('');}}>{historyRead.error&&<Note>{historyRead.error}</Note>}{!historyRead.value&&!historyRead.error&&<Note>正在读取履历…</Note>}{historyRead.value&&<div className="rule-history"><DataTable headers={['版本 / 状态','冻结标准','依据 / 修改原因','创建时间']} rows={historyRead.value.versions.map(r=>[`${r.revision} · ${r.enabled?'启用':'停用'}`,<>{ruleText(r.rule_snapshot).replace(/ · [^·]+$/,'')} {r.unit}<div>适用：{scope(r)}</div></>,<><div className="rule-reference">{r.standard_reference}</div><div className="rule-reference">{r.reason}</div><small>记录人：{r.actor_id||'历史版本未知'}</small></>,labelTime(r.created_at)])}/><h3>启停记录</h3><DataTable headers={['版本','状态','原因 / 操作者','时间']} rows={historyRead.value.events.map(e=>[historyRead.value!.versions.find(r=>r.id===e.recipe_version_id)?.revision||e.recipe_version_id,e.enabled?'启用':'停用',<>{e.reason}<div>{e.actor_id}</div></>,labelTime(e.recorded_at)])}/><Note>历史规则内容不可覆盖；需要恢复旧标准时，可回到列表明确启用对应版本。</Note></div>}</Modal>}
 </>;
}
type RecipeSpec=Workspace['catalog']['product_specification'][number]&{version:string;cable_model?:string|null;customer_code?:string|null;product_type?:string|null;description?:string|null;applicability:{process_id:string;metric_code:string}[]};
function RecipeEditor({recipe,initialMetric,data,api,commands,close,saved}:{recipe?:Recipe;initialMetric:string;data:Workspace;api:ApiClient;commands:Commands;close:()=>void;saved:()=>Promise<void>}){
 const [metric,setMetric]=useState(recipe?.metric_code||initialMetric||'SHIELD_OVERLAP_RATE'),[operator,setOperator]=useState(recipe?.rule_snapshot.comparison?.operator||((recipe?.metric_code||initialMetric||'SHIELD_OVERLAP_RATE')==='SHIELD_OVERLAP_RATE'?'GE':'LE'));
 const [lower,setLower]=useState(recipe?.rule_snapshot.comparison?.lower||''),[upper,setUpper]=useState(recipe?.rule_snapshot.comparison?.upper||'');
 const [standard,setStandard]=useState(recipe?.standard_reference||''),[scope,setScope]=useState<string[]>(recipe?.specification_ids||[]),[allSpecs,setAllSpecs]=useState(!(recipe?.specification_ids?.length));
 const specs=data.catalog.product_specification;
 const applicableIds=new Set(data.catalog.specification_applicability.filter(a=>a.metric_code===metric).map(a=>a.specification_id));
 const processIds=[...new Set(data.catalog.device.filter(d=>d.metric_code===metric).map(d=>d.process_id))];
 const persist=async(v:FormData)=>{
  const reason=String(v.get('reason')).trim(),selected=allSpecs?(specs.length?specs.filter(s=>s.enabled).map(s=>s.id):scope):scope;
  if(specs.length&&!selected.length)throw new Error('至少选择一个启用的产品规格。');
  const unavailable=specs.length?selected.filter(id=>!specs.some(s=>s.id===id&&s.enabled)):[];
  if(unavailable.length)throw new Error('所选规格中包含已停用或已删除的档案，请移除后再保存。');
  const missing=specs.length?selected.filter(id=>!applicableIds.has(id)):[];
  if(missing.length&&!processIds.length)throw new Error(`当前没有关联${names[metric]}的检测工序，无法同步产品规格；请先维护设备档案。`);
  let synced=0;
  try{
   for(const id of missing){
    const spec=await api.request<RecipeSpec>(`/catalog/specifications/${encodeURIComponent(id)}`);
    const current=spec.applicability||[];
    const next=[...current,...processIds.filter(process_id=>!current.some(a=>a.process_id===process_id&&a.metric_code===metric)).map(process_id=>({process_id,metric_code:metric}))];
    await commands.run(`/catalog/specifications/${encodeURIComponent(id)}`,{
     code:spec.code,name:spec.name,voltage_kv:spec.voltage_kv,conductor_area_mm2:spec.conductor_area_mm2,core_count:spec.core_count,
     shield_structure:spec.shield_structure,enabled:spec.enabled,cable_model:spec.cable_model||'',customer_code:spec.customer_code||'',product_type:spec.product_type||'',description:spec.description||'',
     applicability:next,reason
    },String(spec.version));
    synced++;
   }
  }catch(error){
   await saved().catch(()=>{});
   throw new Error(`${synced?`已同步 ${synced}/${missing.length} 个规格；`:''}规格适用关系同步失败，配方尚未保存。${error instanceof Error?error.message:''}`);
  }
  try{
   await commands.run(recipe?`/recipes/${recipe.id}/versions`:'/recipes',{code:String(v.get('code')).trim(),name:String(v.get('name')).trim(),metric_code:metric,unit:metricUnits[metric],comparison:{operator,lower:operator==='LE'?null:lower,upper:operator==='GE'?null:upper},specification_ids:allSpecs?[]:scope,standard_reference:standard.trim(),reason},recipe?String(recipe.version):undefined);
  }catch(error){
   if(synced)await saved().catch(()=>{});
   throw new Error(`${synced?`已同步 ${synced} 个规格的指标适用关系；`:''}配方版本保存失败。${error instanceof Error?error.message:''}`);
  }
  await saved();
 };
 return <Modal title={recipe?`编辑配方 · ${recipe.name}`:'新增模拟配方'} open submitLabel={recipe?'保存为新版本':'创建并启用'} onClose={close} onSubmit={persist}>
 <div className="rule-editor-grid"><Field label="配方编号"><TextInput name="code" value={recipe?.code} required maxLength={64} readOnly={!!recipe}/></Field><Field label="配方名称"><TextInput name="name" value={recipe?.name} required maxLength={128}/></Field></div>
 <Field label="检测项"><select value={metric} disabled={!!recipe} onChange={e=>{setMetric(e.target.value);setOperator(e.target.value==='SHIELD_OVERLAP_RATE'?'GE':'LE');setLower('');setUpper('');setScope([]);setAllSpecs(true);setStandard('');}}>{Object.entries(names).map(([k,v])=><option key={k} value={k}>{v}（{metricUnits[k]}）</option>)}</select></Field>
 {metric!=='SHIELD_OVERLAP_RATE'?<div className="rule-preset"><Button onClick={()=>{setOperator('LE');setLower('');setUpper(metric==='WIRE_GAP'?'3':'8');setStandard(reference+'；'+(metric==='WIRE_GAP'?'铜丝间隙≤3 mm':'不圆度≤8%'));}}>套用参考目标：≤ {metric==='WIRE_GAP'?'3 mm':'8%'}</Button><span className="muted small">来自宏亮应用方案，仅作模拟参考。</span></div>:<Note>参考资料未提供产品搭盖率合格限值。请填写测试阈值和依据；旧10%只是历史演示值。</Note>}
 <div className="rule-editor-grid"><Field label="判定方式"><select value={operator} onChange={e=>setOperator(e.target.value)}><option value="GE">不小于（≥，含边界）</option><option value="LE">不大于（≤，含边界）</option><option value="BETWEEN">区间（上下限均包含）</option></select></Field><Field label="单位"><input value={metricUnits[metric]} readOnly/></Field>
 {operator!=='LE'&&<Field label={`下限 / ${metricUnits[metric]}`}><input name="lower" type="number" required min="0" max={metricUnits[metric]==='%'?100:undefined} step="any" value={lower} onChange={e=>setLower(e.target.value)}/></Field>}{operator!=='GE'&&<Field label={`上限 / ${metricUnits[metric]}`}><input name="upper" type="number" required min="0" max={metricUnits[metric]==='%'?100:undefined} step="any" value={upper} onChange={e=>setUpper(e.target.value)}/></Field>}</div>
 <fieldset className="b2-group"><legend>适用规格</legend>
  <label><input type="radio" name="recipe-scope" checked={allSpecs} onChange={()=>setAllSpecs(true)}/> 全部启用规格（{specs.filter(s=>s.enabled).length} 个；保存时补齐该指标的适用关系）</label>
  <label><input type="radio" name="recipe-scope" checked={!allSpecs} onChange={()=>setAllSpecs(false)}/> 仅选择指定规格（已选 {scope.length} 个）</label>
  <div className="b2-choices">{specs.map(s=>{
   const applicable=applicableIds.has(s.id),checked=allSpecs?s.enabled:scope.includes(s.id);
   return <label key={s.id}><input type="checkbox" disabled={!s.enabled||allSpecs} checked={checked} onChange={e=>setScope(e.target.checked?[...scope,s.id]:scope.filter(x=>x!==s.id))}/>{s.code||s.id} · {s.name||'未命名规格'} · {s.voltage_kv} kV {s.enabled?(applicable?'（已关联检测项）':'（保存时同步到规格档案）'):'（已停用）'}</label>;
  })}</div>
  {scope.filter(id=>!specs.some(s=>s.id===id&&s.enabled)).map(id=>{const spec=specs.find(s=>s.id===id);return <div key={id}>{spec?`${spec.code||id}（规格已停用）`:`${id}（规格档案已不存在）`}<Button onClick={()=>setScope(scope.filter(s=>s!==id))}>移除</Button></div>;})}
 </fieldset>
 <Field label="标准名称 / 版本 / 依据"><textarea value={standard} onChange={e=>setStandard(e.target.value)} required maxLength={1000} rows={3} placeholder="填写参考文件、条款或明确的模拟测试依据"/></Field>
 <Field label={recipe?'修改原因':'创建原因'}><TextInput name="reason" required maxLength={500}/></Field>
 <Note>{recipe?'保存会新增版本并停用当前编辑版本，已有任务快照不变；自动发现需重新选用版本。':'创建后启用，可在新建任务和自动发现中选择。'} 所选规格会先同步写入规格档案，之后指标页与规格编辑页会显示相同的指标适用关系；缩小单个配方范围不会删除档案关系。仅供测试，配方快照仍按版本保留。不圆度当前按%标量模拟，不能将双向测径的直径差mm直接作为此阈值。</Note>
 </Modal>;
}
