import {createRoot,type Root} from 'react-dom/client';
import {act} from 'react';
import {afterEach,expect,test} from 'vitest';
import {ExecutionSummary} from '../live/ExecutionSummary';
import {emptyWorkspace,type Task} from '../live/api';
let root:Root,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root.unmount());host?.remove();});
async function render(tasks:Task[]){host=document.createElement('div');document.body.append(host);root=createRoot(host);await act(async()=>root.render(<ExecutionSummary tasks={tasks} data={emptyWorkspace} asOf="2026-10-26T01:02:03.123456Z"/>));}
function task(id:string,device:string){return {id,task_code:id,metric_code:'SHIELD_OVERLAP_RATE',device_id:device,state:'RUNNING',current_spool_code:'测试盘-'+device,current_order_code:'测试工单',context_snapshot:{},activity:{communication:'OFFLINE',sampling:'NO_RECENT_DATA'}} as Task;}
test('legacy task identity stays available without occupying primary label',async()=>{const t=task('2a343516-1520-4153-8188-c98ec275b024','d1');await render([t]);expect(host.querySelector('summary')!.textContent).toBe('旧任务 · 2a343516');expect(host.querySelector('details')!.textContent).toContain(t.id);expect(host.querySelector('.execution-title')!.textContent).toContain('测试盘-d1');});
test('each summary action retains exact task and device distinction; offline remains visible',async()=>{await render([task('first','d1'),task('second','d2')]);const rows=host.querySelectorAll('li');expect(rows).toHaveLength(2);for(const [i,id] of ['first','second'].entries()){const link=rows[i].querySelector<HTMLAnchorElement>('.execution-actions a')!;expect(new URLSearchParams(link.hash.split('?')[1]).get('task')).toBe(id);expect(link.hash).toContain('back=dashboard');expect(rows[i].textContent).toContain('通信离线');expect(rows[i].textContent).toContain('近期未更新');}});
test('empty summary offers task navigation and does not invent a running row',async()=>{await render([]);expect(host.querySelectorAll('li')).toHaveLength(0);expect(host.textContent).toContain('当前没有运行任务');expect(host.querySelector<HTMLAnchorElement>('.execution-empty a')!.hash).toBe('#tasks');});
