import {createRoot,type Root} from 'react-dom/client';
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {LivePages} from '../live/LivePages';
import {ApiClient,Commands,emptyWorkspace,type Task,type Person} from '../live/api';
let root:Root,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();vi.restoreAllMocks()});
for(const state of ['CREATED','RUNNING'] as const)test('SC02 '+state+' uses scan lifecycle only for simulated ovality',async()=>{
 const api=new ApiClient();vi.spyOn(api,'request').mockRejectedValue(new Error('本测试不加载附属面板'));
 const task={id:'t',task_code:'202611020001',state,device_id:'HY-BY-01',metric_code:'OVALITY',data_environment:'SIMULATED',rule_snapshot:{comparison:null},context_snapshot:{spool_code:'盘1',specification:{id:'s',code:'s'}},version:'1'} as Task;
 const props={api,commands:new Commands(api),data:{...emptyWorkspace,tasks:[task]},user:{permissions:['data:read','task:write']} as Person,refresh:async()=>{},params:new URLSearchParams('id=t'),route:'task'};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<LivePages {...props}/>));
 expect(host.textContent).toContain('边缘开机后扫描本任务码');expect([...host.querySelectorAll('button')].map(x=>x.textContent)).not.toContain(state==='CREATED'?'开始检测':'结束检测');
 await act(async()=>root.render(<LivePages {...props} data={{...props.data,tasks:[{...task,metric_code:'WIRE_GAP'}]}}/>));
 expect([...host.querySelectorAll('button')].map(x=>x.textContent)).toContain(state==='CREATED'?'开始检测':'结束检测');
});

