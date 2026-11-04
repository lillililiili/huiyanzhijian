import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {afterEach,expect,test,vi} from 'vitest';
import {ReportsLivePage,ReportLiveView} from '../live/ReportsLivePage';
import {ApiClient,emptyWorkspace} from '../live/api';
let root:ReturnType<typeof createRoot>,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();localStorage.clear();vi.restoreAllMocks();});
for(const detail of [false,true])test(`API failure never displays cached example report (${detail?'detail':'list'})`,async()=>{
 localStorage.setItem('huiyan_quality_reports_v2',JSON.stringify([{id:'fake',report_code:'DO-NOT-DISPLAY',state:'PUBLISHED'}]));
 const api=new ApiClient();vi.spyOn(api,'request').mockRejectedValue(Error('连接中断'));
 const props={api,data:structuredClone(emptyWorkspace),user:{id:'u',name:'用户',username:'u',factory_id:'f',permissions:['data:read']},params:new URLSearchParams('id=fake'),refresh:async()=>{}};
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 await act(async()=>root.render(detail?<ReportLiveView {...props}/>:<ReportsLivePage {...props}/>));
 expect(host.textContent).toContain('连接中断');expect(host.textContent).not.toContain('DO-NOT-DISPLAY');expect(host.textContent).not.toContain('样张');
});
