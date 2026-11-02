import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {startVisiblePolling,watchesTask} from '../shared/refreshPolicy';
import {ProductionTasks} from '../live/ProductionPages';
import {ApiClient,Commands,emptyWorkspace} from '../live/api';
let root:Root,box:HTMLDivElement;
beforeEach(()=>{vi.useFakeTimers();Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});box=document.createElement('div');document.body.append(box);root=createRoot(box);});
afterEach(async()=>{await act(async()=>root.unmount());box.remove();vi.useRealTimers();vi.restoreAllMocks();});
test('hidden tabs stop reads, visible resumes once, slow requests do not overlap and cleanup stops polling',async()=>{
 let finish:()=>void=()=>{};const read=vi.fn(()=>new Promise<void>(resolve=>finish=resolve));const stop=startVisiblePolling(read,1000);
 await vi.advanceTimersByTimeAsync(1000);expect(read).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(6000);expect(read).toHaveBeenCalledTimes(1);
 finish();await Promise.resolve();Object.defineProperty(document,'visibilityState',{value:'hidden'});await vi.advanceTimersByTimeAsync(3000);expect(read).toHaveBeenCalledTimes(1);
 Object.defineProperty(document,'visibilityState',{value:'visible'});document.dispatchEvent(new Event('visibilitychange'));expect(read).toHaveBeenCalledTimes(2);stop();finish();await vi.advanceTimersByTimeAsync(5000);expect(read).toHaveBeenCalledTimes(2);
});
test('only pending/running task state is watched',()=>{expect(['CREATED','RUNNING','ENDED','CANCELLED',undefined].map(watchesTask)).toEqual([true,true,false,false,false]);});
test('task selectors remain stable without automatic requery; manual refresh still works',async()=>{
 const api=new ApiClient();const request=vi.spyOn(api,'request').mockResolvedValue({items:[],total:0,running:0,ended:0,waiting:0,spools:0,page:1});const refresh=vi.fn(async()=>{});
 await act(async()=>root.render(<ProductionTasks api={api} commands={new Commands(api)} data={emptyWorkspace} user={{permissions:[]} as any} refresh={refresh} params={new URLSearchParams()} metric="OVALITY" detectionView="ht"/>));
 expect(request).toHaveBeenCalledTimes(1);await act(async()=>vi.advanceTimersByTimeAsync(35000));expect(request).toHaveBeenCalledTimes(1);
 await act(async()=>[...box.querySelectorAll('button')].find(b=>b.textContent==='刷新列表')!.click());expect(request).toHaveBeenCalledTimes(2);expect(refresh).toHaveBeenCalledTimes(1);
});
