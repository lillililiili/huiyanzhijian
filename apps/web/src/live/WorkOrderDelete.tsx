import {useEffect,useId,useState,type SyntheticEvent} from 'react';
import {createPortal} from 'react-dom';
import './work-orders.css';
import {Button} from '../ui/Button';
import {Modal} from '../ui/Modal';
import {Field,TextInput} from '../ui/Field';
import {Note} from '../ui/Note';
import type {Commands} from './api';

export function WorkOrderDelete({order,commands,disabled=false,onDeleted}:{
 order:{id:string;external_code:string;can_delete?:boolean;delete_block_reason?:string|null};
 commands:Commands;disabled?:boolean;onDeleted:()=>Promise<void>;
}){
 const [open,setOpen]=useState(false);
 const [tip,setTip]=useState<{right:number;top?:number;bottom?:number}|null>(null),tipId=useId();
 const blocked=disabled||order.can_delete!==true;
 const reason=disabled?'工单读取失败，请刷新核对':order.delete_block_reason||'删除条件尚未确认，请刷新';
 function showReason(event:SyntheticEvent<HTMLSpanElement>){
  if(!blocked)return;
  const rect=event.currentTarget.getBoundingClientRect();
  setTip({right:Math.max(12,window.innerWidth-rect.right),...(rect.top>90?{bottom:window.innerHeight-rect.top+8}:{top:rect.bottom+8})});
 }
 useEffect(()=>{
  const hide=()=>setTip(null);window.addEventListener('scroll',hide,true);window.addEventListener('resize',hide);
  return()=>{window.removeEventListener('scroll',hide,true);window.removeEventListener('resize',hide);};
 },[]);
 return <>
  <span className="work-order-delete" tabIndex={blocked?0:undefined} aria-label={blocked?`不可删除工单 ${order.external_code}：${reason}`:undefined} aria-describedby={tip&&blocked?tipId:undefined}
   onMouseEnter={showReason} onMouseLeave={()=>setTip(null)} onFocus={showReason} onBlur={()=>setTip(null)} onKeyDown={event=>{if(event.key==='Escape')setTip(null);}}>
   <Button className="work-order-delete-button" disabled={blocked} onClick={()=>setOpen(true)} aria-label={`删除工单 ${order.external_code}`}>删除</Button>
  </span>
  {tip&&blocked&&createPortal(<span id={tipId} role="tooltip" className="work-order-delete-tooltip" style={tip}>{reason}</span>,document.body)}
  {open&&<Modal title="删除工单" open submitLabel="确认删除" onClose={()=>setOpen(false)} onSubmit={async values=>{
   const reason=String(values.get('reason')||'').trim();if(!reason)throw Error('请填写删除原因');
   await commands.run(`/work-orders/${order.id}:delete`,{reason});
   setOpen(false);await onDeleted();
  }}>
   <p>工单：<strong>{order.external_code}</strong></p>
   <Note>仅删除未关联线缆、检测任务或批量计划的平台空工单。提交时重新校验；删除后从列表移除，工单原信息及删除原因保留在后台操作审计。</Note>
   <Field label="删除原因"><TextInput name="reason" aria-label="删除原因" required maxLength={1000} placeholder="例如：重复录入工单"/></Field>
  </Modal>}
 </>;
}
