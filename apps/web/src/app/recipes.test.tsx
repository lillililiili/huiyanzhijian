import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {RecipesPage} from '../live/RecipesPage';
import {DiscoveryRecipeForm} from '../live/DiscoveryRecipeForm';
import {availableRecipes} from '../live/recipeOptions';
import {ApiClient,Commands,emptyWorkspace,type Recipe} from '../live/api';
let root:Root,container:HTMLDivElement;
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();});
const recipe:Recipe={id:'r',code:'R',name:'模拟规则',revision:'V1.0',version:'1',enabled:true,metric_code:'OVALITY',approval_state:'TEST_ONLY',unit:'%',specification_ids:['s'],standard_reference:'参考依据',rule_snapshot:{approval_state:'TEST_ONLY',method_id:'test-by',method_version:'1',comparison:{operator:'LE',lower:null,upper:'8'}}};
const device={id:'d',name:'d',model:'m',metric_code:'OVALITY',process_id:'p',line_id:'l',enabled:true,data_environment:'SIMULATED'};
const props=()=>{const api=new ApiClient();return {api,commands:new Commands(api),user:{id:'a',username:'a',name:'a',factory_id:'f',permissions:['data:read','rules:write']},data:structuredClone(emptyWorkspace),refresh:vi.fn(async()=>{}),params:new URLSearchParams()};};
test('selector excludes disabled, wrong metric, wrong specification and TEST_ONLY real devices',()=>{
 const rows=[recipe,{...recipe,id:'disabled',enabled:false},{...recipe,id:'other',metric_code:'WIRE_GAP'},{...recipe,id:'scope',specification_ids:['other']},{...recipe,id:'unapproved',approval_state:'UNAPPROVED'}];
 expect(availableRecipes(rows,device,'s').map(r=>r.id)).toEqual(['r']);expect(availableRecipes(rows,{...device,data_environment:'REAL'},'s')).toEqual([]);
});
test('read failure stays visible; viewer has no rule mutations',async()=>{const p=props();p.user.permissions=['data:read'];vi.spyOn(p.api,'request').mockRejectedValue(Error('网络中断'));await render(<RecipesPage {...p}/>);expect(container.textContent).toContain('网络中断');expect(container.textContent).not.toContain('新增配方');expect(container.textContent).not.toContain('暂无符合条件');expect(container.textContent).not.toContain('未找到符合条件');});
test('editing sends immutable new version command; conflict retains form',async()=>{
 const p=props();vi.spyOn(p.api,'request').mockResolvedValue([recipe]);const save=vi.spyOn(p.commands,'run').mockRejectedValue(Error('配方已变更'));
 await render(<RecipesPage {...p}/>);await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='编辑')!.click());
 const form=document.querySelector<HTMLFormElement>('#active-modal-form')!;(form.elements.namedItem('reason') as HTMLInputElement).value='修订原因';
 await act(async()=>form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(save).toHaveBeenCalledWith('/recipes/r/versions',expect.objectContaining({reason:'修订原因',unit:'%',comparison:{operator:'LE',lower:null,upper:'8'}}),'1');
 expect(document.querySelector('.form-error')!.textContent).toContain('配方已变更');expect((form.elements.namedItem('reason') as HTMLInputElement).value).toBe('修订原因');expect(p.refresh).not.toHaveBeenCalled();
});
test('discovery never silently falls back from a disabled pinned rule to collection only',async()=>{
 const p=props();const catalog={...emptyWorkspace.catalog,device:[device],recipes:[{...recipe,enabled:false}],product_specification:[{id:'s',name:'spec',voltage_kv:'35',conductor_area_mm2:'300',core_count:1,shield_structure:'tape',enabled:true}],specification_applicability:[{specification_id:'s',process_id:'p',metric_code:'OVALITY'}]};vi.spyOn(p.api,'request').mockResolvedValue(catalog);
 await render(<DiscoveryRecipeForm api={p.api} commands={p.commands} device={device} current={{enabled:true,specification_id:'s',recipe_version_id:'r',version:'1'}} close={()=>{}} saved={()=>{}}/>);
 expect(document.querySelector('button[type=submit]')).toHaveProperty('disabled',true);expect(document.body.textContent).toContain('当前版本已停用或不适用');
 expect([...document.querySelectorAll('select')].at(-1)!.value).toBe('r');
});
