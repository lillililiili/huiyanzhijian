import {requireValue} from '../../infrastructure/errors';
export const kinds=['DAILY','WEEKLY','MONTHLY','QUARTERLY','YEARLY','WORK_ORDER'] as const;
export type ReportKind=typeof kinds[number];
export function reportScope(input:any){
 requireValue(input&&typeof input==='object'&&!Array.isArray(input));
 requireValue(kinds.includes(input.kind),'REQUEST_INVALID','请选择报告类型');
 const kind:ReportKind=input.kind;
 const environment=input.environment||'';
 requireValue(['','REAL','SIMULATED'].includes(environment));
 const order=String(input.order_id||'');requireValue(order.length<=128);
 if(kind==='WORK_ORDER'){requireValue(order,'REQUEST_INVALID','请选择工单');return {kind,order_id:order,environment,anchor:'',from:null,to:null,bucket:'interval',label:'工单全周期'};}
 const anchor=String(input.anchor||'');requireValue(/^\d{4}-\d{2}-\d{2}$/.test(anchor),'REQUEST_INVALID','请选择有效日期');
 const d=new Date(anchor+'T00:00:00Z');requireValue(Number.isFinite(+d)&&d.toISOString().slice(0,10)===anchor&&d.getUTCFullYear()>=2000&&d.getUTCFullYear()<=2100);
 const start=new Date(d),end=new Date(d);let bucket='day';
 if(kind==='DAILY'){end.setUTCDate(end.getUTCDate()+1);bucket='hour';}
 if(kind==='WEEKLY'){start.setUTCDate(start.getUTCDate()-(start.getUTCDay()+6)%7);end.setTime(+start);end.setUTCDate(end.getUTCDate()+7);}
 if(kind==='MONTHLY'){start.setUTCDate(1);end.setTime(+start);end.setUTCMonth(end.getUTCMonth()+1);}
 if(kind==='QUARTERLY'){start.setUTCMonth(Math.floor(start.getUTCMonth()/3)*3,1);end.setTime(+start);end.setUTCMonth(end.getUTCMonth()+3);bucket='month';}
 if(kind==='YEARLY'){start.setUTCMonth(0,1);end.setTime(+start);end.setUTCFullYear(end.getUTCFullYear()+1);bucket='month';}
 const first=start.toISOString().slice(0,10),last=new Date(+end-86400000).toISOString().slice(0,10);
 return {kind,order_id:order,environment,anchor,from:new Date(+start-28800000).toISOString(),to:new Date(+end-28800000).toISOString(),bucket,label:first===last?first:`${first} — ${last}`};
}
export function reportPresentation(input:any){
 const out:any={};for(const field of ['supplier','recipient','title']){const s=String(input?.[field]||'').trim();requireValue(s.length<=40,'REQUEST_INVALID','报告抬头最多40字');out[field]=s;}
 return {...out,trends:input?.trends!==false,details:input?.details!==false};
}
