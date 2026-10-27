import {createRoot,type Root} from 'react-dom/client';
import {act,type ReactNode} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {labelTime,timeTick} from '../live/displayTime';
import {usePlanDraft,planDraftKey} from '../live/usePlanDraft';
import {ApiClient,ApiError,Commands,emptyWorkspace,type Person,type Workspace} from '../live/api';
import {TaskForm} from '../live/TaskForms';
import {LivePages} from '../live/LivePages';
vi.mock('echarts',()=>({init:()=>({setOption:()=>{},on:()=>{},resize:()=>{},dispose:()=>{}}),format:{encodeHTML:(s:string)=>s}}));
let root:Root,container:HTMLDivElement;
const user:Person={id:'ux03',factory_id:'f',username:'ux03',name:'ux03',permissions:['data:read','task:write']};
async function render(node:ReactNode){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(node));}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();sessionStorage.removeItem(planDraftKey(user));vi.restoreAllMocks();});
test('business time converts offset and day without losing microseconds; invalid times stay explicit',()=>{
 expect(labelTime('2026-10-26T20:59:59.123456789Z')).toBe('2026-10-27 04:59:59.123456789 北京时间');
 expect(labelTime('2026-10-26T12:17:40.123456+08:00')).toBe('2026-10-26 12:17:40.123456 北京时间');
 expect(labelTime('2026-10-26T12:17:40')).toContain('时区未明确');
 expect(labelTime(null)).toBe('—');
 expect(timeTick('2026-10-26T04:17:40.123456Z',true)).toBe('12:17:40.123456');
});
test('task creation blocks zero selection and explains the next step',async()=>{
 const api=new ApiClient(),commands=new Commands(api),run=vi.spyOn(commands,'run');
 await render(<TaskForm commands={commands} data={emptyWorkspace} close={()=>{}} refresh={async()=>{}}/>);
 expect(document.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
 await act(async()=>document.querySelector('form')!.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 expect(run).not.toHaveBeenCalled();expect(document.body.textContent).toContain('请先选择工单');
});
test('detection task detail keeps complete originating scope and page',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockResolvedValue({items:[],has_more:false});
 const data={...emptyWorkspace,tasks:[{id:'t',task_code:'T',spool_id:'s',device_id:'d',state:'ENDED',metric_code:'SHIELD_OVERLAP_RATE',context_snapshot:{},rule_snapshot:{}}]} as Workspace;
 const params=new URLSearchParams('metric=dg&task=t&back='+encodeURIComponent('detection?metric=dg&device_id=d&page=2'));
 await render(<LivePages route="detection" {...{params,api,data,user}} commands={new Commands(api)} refresh={async()=>{}}/>);
 const href=[...container.querySelectorAll('a')].find(a=>a.textContent==='任务详情')!.getAttribute('href')!;
 expect(new URLSearchParams(href.slice(href.indexOf('?')+1)).get('back')).toBe('detection?'+params);
});
let hook:ReturnType<typeof usePlanDraft>;
function Harness({person=user}:{person?:Person}){hook=usePlanDraft(person);return <p>{hook.draft.name}</p>;}
test('draft restoration isolates factory and user; no request is sent on mount',async()=>{
 sessionStorage.setItem(planDraftKey(user),JSON.stringify({name:'未提交',items:[{spool_id:'s',device_id:'d'}],labels:{s:'盘01'}}));
 await render(<Harness/>);expect(hook.draft.name).toBe('未提交');expect(hook.draft.labels.s).toBe('盘01');
 await act(async()=>root.render(<Harness key="other" person={{...user,id:'other'}}/>));expect(hook.draft.name).toBe('');
 await act(async()=>root.render(<Harness key="viewer" person={{...user,permissions:['data:read']}}/>));expect(hook.draft.items).toHaveLength(0);
});
test('lost save response survives remount and reuses exact body/key; successful confirmation clears only this draft',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request').mockRejectedValueOnce(new ApiError('timeout',0,'NETWORK_ERROR')).mockResolvedValueOnce({id:'p'});
 await render(<Harness/>);
 await act(async()=>hook.update({name:'计划',items:[{spool_id:'s',device_id:'d'}],labels:{s:'盘'}}));
 await act(async()=>{await expect(hook.save(api)).rejects.toThrow('timeout');});
 const key=hook.draft.pendingKey;expect(key).toBeTruthy();
 await act(async()=>root.render(<Harness key="remount"/>));expect(hook.draft.pendingKey).toBe(key);
 await act(async()=>{await expect(hook.save(api)).resolves.toEqual({id:'p'});});
 expect(request.mock.calls[0]).toEqual(request.mock.calls[1]);expect(sessionStorage.getItem(planDraftKey(user))).toBeNull();
});
test('storage failure prevents sending an unremembered plan creation request',async()=>{
 const api=new ApiClient(),request=vi.spyOn(api,'request');await render(<Harness/>);
 await act(async()=>hook.update({name:'计划',items:[{spool_id:'s',device_id:'d'}],labels:{}}));
 vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw Error('quota');});
 await act(async()=>{await expect(hook.save(api)).rejects.toThrow('无法保存草稿');});expect(request).not.toHaveBeenCalled();
});
