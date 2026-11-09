import {act,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,expect,test} from 'vitest';
import {PeriodSelector,periodRange} from '../live/reporting/PeriodSelector';
import type {Kind} from '../live/reporting/model';

test.each<[Kind,string,string]>([
 ['DAILY','2026-11-04','2026-11-04 至 2026-11-04'],
 ['WEEKLY','2026-01-01','2025-12-29 至 2026-01-04'],
 ['MONTHLY','2024-02-29','2024-02-01 至 2024-02-29'],
 ['MONTHLY','2100-02-28','2100-02-01 至 2100-02-28'],
 ['QUARTERLY','2026-11-04','2026-10-01 至 2026-12-31'],
 ['QUARTERLY','2024-02-29','2024-01-01 至 2024-03-31'],
 ['YEARLY','2024-02-29','2024-01-01 至 2024-12-31'],
])('%s %s displays inclusive days matching M06', (kind,anchor,expected)=>{
 expect(periodRange(kind,anchor)).toBe(expected);
});
test('empty, impossible and unsupported dates do not show a misleading range',()=>{
 for(const anchor of ['', '2026-02-30','1999-12-31','2101-01-01']) expect(periodRange('MONTHLY',anchor)).toBeNull();
 expect(periodRange('WORK_ORDER','2026-11-04')).toBeNull();
});
let root:Root|undefined,host:HTMLDivElement;
afterEach(async()=>{if(root)await act(async()=>root!.unmount());host?.remove();root=undefined;});
async function mount(kind:Kind,disabled=false){
 host=document.createElement('div');document.body.append(host);root=createRoot(host);
 function Harness(){const [anchor,setAnchor]=useState('2026-11-04');return <><PeriodSelector kind={kind} anchor={anchor} disabled={disabled} onChange={setAnchor}/><output>{anchor}</output></>;}
 await act(async()=>root!.render(<Harness/>));
}
async function change(selector:string,value:string){
 const node=host.querySelector(selector) as HTMLInputElement;
 const proto=node.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;
 await act(async()=>{Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));});
}
test('month selects only year/month and submits first day',async()=>{
 await mount('MONTHLY');expect(host.querySelector('input[type=date]')).toBeNull();
 await change('input','2024-02');expect(host.querySelector('output')!.textContent).toBe('2024-02-01');expect(host.textContent).toContain('2024-02-01 至 2024-02-29');
 await change('input','');expect(host.textContent).toContain('请选择有效的统计周期');
});
test('quarter and year changes submit valid dates and update range',async()=>{
 await mount('QUARTERLY');expect(host.querySelector('input')).toBeNull();
 await change('[aria-label="统计季度"]','1');await change('[aria-label="统计年份"]','2024');
 expect(host.querySelector('output')!.textContent).toBe('2024-01-01');expect(host.textContent).toContain('2024-01-01 至 2024-03-31');
});
test('year has no month/day picker; busy disables all selectors',async()=>{
 await mount('YEARLY',true);expect(host.querySelector('input')).toBeNull();expect(host.querySelector('select')!.disabled).toBe(true);expect(host.textContent).toContain('2026-01-01 至 2026-12-31');
});
