import {createRoot,type Root} from 'react-dom/client';
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {WorkOrders} from '../live/WorkOrders';
import {ApiClient,Commands,emptyWorkspace} from '../live/api';
let root:Root,container:HTMLDivElement;
const order={id:'order-delete',external_code:'WO01测试工单',source_system:'PLATFORM',state:'NO_TASK',can_delete:true,registered_spools:0,physical_spools:0,task_count:0};
function props(query='',write=true){const api=new ApiClient();return {api,commands:new Commands(api),data:emptyWorkspace,user:{id:'u',username:'u',name:'u',factory_id:'f',permissions:['data:read',...(write?['task:write']:[])]},refresh:vi.fn(async()=>{}),params:new URLSearchParams(query)};}
async function render(p:ReturnType<typeof props>,w:any=order){
 vi.spyOn(p.api,'request').mockImplementation(async path=>path.startsWith('/work-order-summaries')?w:{items:path.startsWith('/production/work-orders')?[w]:[],total:1,page:Number(p.params.get('page')||1),limit:20});
 container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<WorkOrders {...p}/>));
}
async function open(){await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="删除工单 WO01测试工单"]')!.click());}
async function submit(reason='重复录入'){const input=document.querySelector<HTMLInputElement>('[name=reason]')!;input.value=reason;await act(async()=>document.querySelector('form#active-modal-form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();vi.restoreAllMocks();window.location.hash='';});
test('eligible list deletion requires a reason and calls real command then refresh',async()=>{
 const p=props(),run=vi.spyOn(p.commands,'run').mockResolvedValue({deleted:true});await render(p);await open();
 expect(document.querySelector('[role=dialog]')!.textContent).toContain(order.external_code);await submit('   ');expect(run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('请填写删除原因');
 await submit();expect(run).toHaveBeenCalledWith('/work-orders/order-delete:delete',{reason:'重复录入'});expect(p.refresh).toHaveBeenCalled();expect(document.querySelector('[role=dialog]')).toBeNull();expect(container.textContent).toContain('后台操作审计已记录');
});
test('protected order cannot open delete; reason appears on hover or focus only',async()=>{
 const p=props();await render(p,{...order,can_delete:false,delete_block_reason:'已有当前或历史检测任务，不可删除'});
 expect(document.querySelector<HTMLButtonElement>('[aria-label^="删除工单"]')!.disabled).toBe(true);
 expect(container.textContent).not.toContain('已有当前或历史检测任务');expect(document.querySelector('[role=tooltip]')).toBeNull();
 const target=document.querySelector<HTMLElement>('.work-order-delete')!;
 await act(async()=>target.dispatchEvent(new MouseEvent('mouseover',{bubbles:true})));
 expect(document.querySelector('[role=tooltip]')?.textContent).toContain('已有当前或历史检测任务');
 await act(async()=>target.dispatchEvent(new MouseEvent('mouseout',{bubbles:true,relatedTarget:document.body})));
 expect(document.querySelector('[role=tooltip]')).toBeNull();
 await act(async()=>target.focus());expect(document.querySelector('[role=tooltip]')?.textContent).toContain('已有当前或历史检测任务');
 await act(async()=>target.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));expect(document.querySelector('[role=tooltip]')).toBeNull();
 await open();expect(document.querySelector('[role=dialog]')).toBeNull();
});
test('read-only user has no deletion control',async()=>{await render(props('',false));expect(document.querySelector('[aria-label^="删除工单"]')).toBeNull();});
test('missing server eligibility never assumes an empty work order is deletable',async()=>{
 await render(props(),{...order,can_delete:undefined});expect(document.querySelector<HTMLButtonElement>('[aria-label^="删除工单"]')!.disabled).toBe(true);expect(document.querySelector('.work-order-delete')!.getAttribute('aria-label')).toContain('删除条件尚未确认');
});
test('server state conflict keeps dialog and reason without success',async()=>{
 const p=props();vi.spyOn(p.commands,'run').mockRejectedValue(new Error('已登记线缆，不可删除'));await render(p);await open();await submit();
 expect(document.querySelector('[role=dialog]')!.textContent).toContain('已登记线缆，不可删除');expect(document.querySelector<HTMLInputElement>('[name=reason]')!.value).toBe('重复录入');expect(p.refresh).not.toHaveBeenCalled();
});
test('unknown network outcome preserves retry and prevents success notice',async()=>{
 const p=props();vi.spyOn(p.commands,'run').mockRejectedValue(new Error('网络中断，请重试核对'));await render(p);await open();await submit();
 expect(document.body.textContent).toContain('网络中断');expect(container.textContent).not.toContain('工单已删除');
});
test('detail deletion returns to previous filter; last list row goes to previous page',async()=>{
 const p=props('id=order-delete&back=workorders%3Fq%3DWO01');vi.spyOn(p.commands,'run').mockResolvedValue({deleted:true});await render(p);await open();await submit();expect(decodeURIComponent(location.hash)).toBe('#workorders?q=WO01');
});
test('last row on page two returns to page one without dropping filters',async()=>{
 const p=props('q=WO01&page=2');vi.spyOn(p.commands,'run').mockResolvedValue({deleted:true});await render(p);await open();await submit();expect(location.hash).toBe('#workorders?q=WO01&page=1');
});
test('save succeeded but workspace refresh failed is not reported as deletion failed',async()=>{
 const p=props();p.refresh.mockRejectedValue(new Error('offline'));vi.spyOn(p.commands,'run').mockResolvedValue({deleted:true});await render(p);await open();await submit();expect(container.textContent).toContain('工单已删除，但关联列表刷新失败');
});
