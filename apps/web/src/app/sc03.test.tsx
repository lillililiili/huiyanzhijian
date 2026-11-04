import {createRoot} from 'react-dom/client';
import {act} from 'react';
import {expect,test,vi} from 'vitest';
import {ApiClient} from '../shared/api';
import {ScanExecution} from '../live/ProductionPages';
import type {Task} from '../live/api';
test('SC03 executions have distinct labels and source task links',async()=>{
 const host=document.createElement('div'),root=createRoot(host);
 const task={metric_code:'OVALITY',data_environment:'SIMULATED',context_snapshot:{}} as Task;
 try{
  await act(async()=>root.render(<><ScanExecution task={task}/><ScanExecution task={{...task,context_snapshot:{...task.context_snapshot,scan_execution:{round:2,source_task_id:'origin',source_task_code:'202611020002',previous_task_id:'origin'}}}}/></>));
  expect(host.textContent).toContain('第1次采集');expect(host.textContent).toContain('第2次采集');expect(host.querySelector('a')?.getAttribute('href')).toBe('#task?id=origin');
  await act(async()=>root.render(<ScanExecution task={{...task,metric_code:'WIRE_GAP'}}/>));expect(host.textContent).toBe('第1次采集');
  await act(async()=>root.render(<ScanExecution task={{...task,metric_code:'WIRE_GAP',data_environment:'REAL'}}/>));expect(host.textContent).toBe('');
 }finally{await act(async()=>root.unmount());}
});

test('SC03 slow task query can complete after 20 seconds while navigation still cancels',async()=>{
 vi.useFakeTimers();
 const send=vi.fn((_url:unknown,init?:RequestInit)=>new Promise<Response>((resolve,reject)=>{
  const timer=setTimeout(()=>resolve(new Response(JSON.stringify({code:'OK',data:{total:2}}))),30000);
  init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('aborted'));});
 }));
 const api=new ApiClient(send as typeof fetch);
 try{
  const pending=api.request<{total:number}>('/production/tasks',undefined,{},undefined,60000);
  await vi.advanceTimersByTimeAsync(30000);expect((await pending).total).toBe(2);
  const controller=new AbortController();
  const cancelled=api.request('/production/tasks',undefined,{},controller.signal,60000).catch(e=>e);
  controller.abort();expect(await cancelled).toBeInstanceOf(Error);
  const normal=api.request('/catalog').catch(e=>e);
  await vi.advanceTimersByTimeAsync(20000);expect(await normal).toMatchObject({code:'NETWORK_ERROR'});
 }finally{vi.useRealTimers();}
});
