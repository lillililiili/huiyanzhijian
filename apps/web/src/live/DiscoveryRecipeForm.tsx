import {useState} from 'react';
import {Modal} from '../ui/Modal';
import {Field} from '../ui/Field';
import {Note} from '../ui/Note';
import {useRead} from './ServerLists';
import {specificationLabel,type ApiClient,type Catalog,type Device,type Commands} from './api';
import {availableRecipes,recipeLabel} from './recipeOptions';
type Profile={enabled:boolean;specification_id:string;recipe_version_id:string|null;sheath_recipe_version_id?:string|null;version:string};
export function DiscoveryRecipeForm({device,current,api,commands,close,saved}:{device:Device;current?:Profile;api:ApiClient;commands:Commands;close:()=>void;saved:()=>void}){
 const {value,error}=useRead<Catalog>(api,'/catalog',device.id);
 const [spec,setSpec]=useState(current?.specification_id||''),[recipe,setRecipe]=useState(current?.recipe_version_id||''),[sheath,setSheath]=useState(current?.sheath_recipe_version_id||'');
 const specs=value?.product_specification.filter(s=>s.enabled&&value.specification_applicability.some(a=>a.specification_id===s.id&&a.process_id===device.process_id&&a.metric_code===device.metric_code))||[];
 const recipes=value?availableRecipes(value.recipes,device,spec):[];
 const sheathRecipes=value?availableRecipes(value.recipes,{...device,metric_code:'SHEATH_THICKNESS'},spec):[];
 const invalidSheath=device.metric_code==='OVALITY'&&!!sheath&&!sheathRecipes.some(r=>r.id===sheath);
 const invalidRecipe=!!recipe&&!recipes.some(r=>r.id===recipe),invalidSpec=!spec||!specs.some(s=>s.id===spec);
 return <Modal title={`自动发现配置 · ${device.id}`} open onClose={close} submitDisabled={!value||invalidRecipe||invalidSpec||invalidSheath} onSubmit={async v=>{await commands.run('/discovery-profiles/'+device.id,{enabled:v.get('enabled')==='yes',specification_id:spec,recipe_version_id:recipe||null,...(device.metric_code==='OVALITY'?{sheath_recipe_version_id:sheath||null}:{})},String(current?.version||0));saved();}}>
 {error&&<Note>{error} 请关闭后重新打开。</Note>}
 <Field label="任务模式"><select name="enabled" defaultValue={current?.enabled?'yes':'no'}><option value="no">手动模式</option><option value="yes">启用自动发现</option></select></Field>
 <Field label="当前生产规格"><select value={spec} required onChange={e=>setSpec(e.target.value)}><option value="">请选择规格</option>{spec&&!specs.some(s=>s.id===spec)&&<option value={spec} disabled>{spec}（不可用）</option>}{specs.map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field>
 <Field label="配方"><select required value={recipe} onChange={e=>setRecipe(e.target.value)}><option value="">请选择判定配方</option>{invalidRecipe&&<option value={recipe} disabled>当前版本已停用或不适用，请重新选择</option>}{recipes.map(r=><option key={r.id} value={r.id}>{recipeLabel(r)}</option>)}</select></Field>
 {device.metric_code==='OVALITY'&&<Field label="护套厚度配方（当前规格）"><select required value={sheath} onChange={e=>setSheath(e.target.value)}><option value="">请选择护套配方</option>{sheath&&!sheathRecipes.some(r=>r.id===sheath)&&<option disabled value={sheath}>原护套配方已不可用，请重新选择</option>}{sheathRecipes.map(r=><option key={r.id} value={r.id}>{recipeLabel(r)}</option>)}</select></Field>}
 {invalidRecipe&&<Note>当前配置的配方不可用于新任务，请明确选择启用版本，并重新保存。</Note>}
 <Note>只影响后续新任务，已有任务沿用原快照。配方按具体版本绑定，不自动升级；出料结束检测任务，不控制产线。</Note>
 </Modal>;
}
