import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import type {MockInstance} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {LiveApp} from '../live/LiveApp';
import {ApiClient,emptyWorkspace} from '../live/api';
vi.mock('./shell/AppShell',()=>({AppShell:({children}:any)=><div>{children}</div>}));
vi.mock('../live/LivePages',()=>({LivePages:({data}:any)=><div>{data.tasks.map((t:any)=>t.state).join(',')}</div>}));
let root:Root,box:HTMLDivElement,request:MockInstance<ApiClient['request']>;
beforeEach(()=>{
 vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});box=document.createElement('div');document.body.append(box);root=createRoot(box);
 request=vi.spyOn(ApiClient.prototype,'request').mockImplementation(async function(path:string){
  if(path==='/auth/me')return {user:{id:'u',permissions:[]},csrf_token:'test'};
  if(path==='/catalog')return emptyWorkspace.catalog;
  if(path==='/health/ready')return {database:'UP',analysis_worker:{healthy:true}};
  if(path==='/admin/settings')return {};
  if(path==='/tasks/t')return {id:'t',state:'ENDED'};
  return [];
 } as any);
 vi.spyOn(ApiClient.prototype,'all').mockImplementation(async(path:string)=>path==='/tasks'?[{id:'t',state:'RUNNING'}] as any:[]);
});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();vi.useRealTimers();vi.restoreAllMocks();});
for(const route of ['history','reports','specs','tasks'])test(`${route}: no background workspace or settings refresh, session check retained`,async()=>{
 window.location.hash='#'+route;await act(async()=>root.render(<LiveApp/>));const catalog=request.mock.calls.filter(c=>c[0]==='/catalog').length;
 await act(async()=>vi.advanceTimersByTimeAsync(31000));expect(request.mock.calls.filter(c=>c[0]==='/catalog')).toHaveLength(catalog);expect(request.mock.calls.filter(c=>c[0]==='/admin/settings')).toHaveLength(1);expect(request.mock.calls.filter(c=>c[0]==='/auth/me').length).toBeGreaterThan(1);
});
test('live detection polls selected task only and stops after task ends',async()=>{
 window.location.hash='#detection?metric=ht&task=t';await act(async()=>root.render(<LiveApp/>));expect(box.textContent).toBe('RUNNING');
 await act(async()=>vi.advanceTimersByTimeAsync(5000));expect(box.textContent).toBe('ENDED');expect(request.mock.calls.filter(c=>c[0]==='/tasks/t')).toHaveLength(1);
 const catalog=request.mock.calls.filter(c=>c[0]==='/catalog').length;await act(async()=>vi.advanceTimersByTimeAsync(15000));expect(request.mock.calls.filter(c=>c[0]==='/tasks/t')).toHaveLength(1);expect(request.mock.calls.filter(c=>c[0]==='/catalog')).toHaveLength(catalog);
});
