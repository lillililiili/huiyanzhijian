import {names,specificationLabel,taskState,type Specification} from './api';
export type TaskLabel={barcode:string;task_id:string;task_code:string;work_order_id:string;order_code:string;spool_code:string;process_id:string;metric_code:string;device_id:string;state:string;data_environment:string;association_version:string;specification:Specification;related_tasks?:{task_id:string;task_code:string;metric_code:string}[]};
export const labelTasks=(t:TaskLabel)=>t.related_tasks?.length?t.related_tasks:[{task_id:t.task_id,task_code:t.task_code,metric_code:t.metric_code}];
export const labelMetricName=(t:TaskLabel)=>labelTasks(t).map(r=>names[r.metric_code]||r.metric_code).join(' + ');
type BarcodeRenderer=(canvas:HTMLCanvasElement,value:string,options:Record<string,unknown>)=>void;
declare global { interface Window { JsBarcode?:BarcodeRenderer } }
let library:Promise<BarcodeRenderer>|undefined;
function barcodeLibrary(){
 if(window.JsBarcode)return Promise.resolve(window.JsBarcode);
 return library??=new Promise<BarcodeRenderer>((resolve,reject)=>{
  const script=document.createElement('script');script.src='/vendor/JsBarcode.code128.min.js';script.async=true;
  const fail=()=>{library=undefined;script.remove();reject(Error('条码组件加载失败，请重试'));};
  script.onload=()=>window.JsBarcode?resolve(window.JsBarcode):fail();script.onerror=fail;document.head.appendChild(script);
 });
}
export function labelFilename(t:TaskLabel){return `${t.task_code}_${t.spool_code}_${labelMetricName(t)}`.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,160)+'.png';}
export async function labelPng(t:TaskLabel,process:string):Promise<Blob>{
 const render=await barcodeLibrary(),bars=document.createElement('canvas');
 render(bars,t.barcode,{format:'CODE128',width:3,height:170,margin:36,fontSize:23,background:'#fff',lineColor:'#000'});
 const canvas=document.createElement('canvas');canvas.width=Math.max(1240,bars.width);
 const ctx=canvas.getContext('2d');if(!ctx)throw Error('浏览器不支持条码图片生成');
 const lines:string[]=[];ctx.font='28px sans-serif';
 for(const text of [`工单：${t.order_code}`,`线缆 / 盘号：${t.spool_code}`,`工序：${process}    检测项：${labelMetricName(t)}`,`设备：${t.device_id}    来源：${t.data_environment==='SIMULATED'?'外部输入':'设备采集'}`,`规格：${specificationLabel(t.specification)}`,...(labelTasks(t).length>1?[...labelTasks(t).map(r=>`${names[r.metric_code]||r.metric_code}任务：${r.task_code}`),'同次采集合并条码：一次扫码同时检测不圆度与护套厚度']:[])]){
  let line='';for(const char of text){if(ctx.measureText(line+char).width>canvas.width-80){lines.push(line);line=char;}else line+=char;}lines.push(line);
 }
 canvas.height=110+bars.height+lines.length*44+78;
 ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#111';ctx.font='bold 36px sans-serif';ctx.fillText('慧眼智检 · 检测任务 '+t.task_code,40,56);
 ctx.drawImage(bars,(canvas.width-bars.width)/2,90);ctx.font='28px sans-serif';
 lines.forEach((line,i)=>ctx.fillText(line,40,110+bars.height+36+i*44));
 ctx.font='22px sans-serif';ctx.fillStyle='#555';ctx.fillText(`下载时状态：${taskState[t.state]||t.state}   归属版本：${t.association_version}   开工前核对任务与盘号`,40,canvas.height-26);
 return new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('条码图片生成失败')),'image/png'));
}
export function saveLabelFile(blob:Blob,name:string){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
export function crc32(data:Uint8Array){let crc=0xffffffff;for(const b of data){crc^=b;for(let j=0;j<8;j++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
// ZIP store method: PNG is already compressed. UTF-8 names and CRC checked by unzip.
export function zipLabels(files:{name:string;data:Uint8Array}[]):Blob{
 const chunks:BlobPart[]=[],central:BlobPart[]=[];let offset=0,centralSize=0;
 for(const f of files){const name=new TextEncoder().encode(f.name),crc=crc32(f.data),local=new Uint8Array(30+name.length),lv=new DataView(local.buffer);
  lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x800,true);lv.setUint16(12,33,true);lv.setUint32(14,crc,true);lv.setUint32(18,f.data.length,true);lv.setUint32(22,f.data.length,true);lv.setUint16(26,name.length,true);local.set(name,30);
  const header=new Uint8Array(46+name.length),hv=new DataView(header.buffer);hv.setUint32(0,0x02014b50,true);hv.setUint16(4,20,true);hv.setUint16(6,20,true);hv.setUint16(8,0x800,true);hv.setUint16(14,33,true);hv.setUint32(16,crc,true);hv.setUint32(20,f.data.length,true);hv.setUint32(24,f.data.length,true);hv.setUint16(28,name.length,true);hv.setUint32(42,offset,true);header.set(name,46);
  chunks.push(local,new Uint8Array(f.data));central.push(header);centralSize+=header.length;offset+=local.length+f.data.length;
 }
 const end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,files.length,true);ev.setUint16(10,files.length,true);ev.setUint32(12,centralSize,true);ev.setUint32(16,offset,true);
 return new Blob([...chunks,...central,end],{type:'application/zip'});
}
