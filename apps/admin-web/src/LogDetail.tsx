import {labelTime} from '../../web/src/shared/api';
import {HashLink} from '../../web/src/ui/HashLink';
import {Note} from '../../web/src/ui/Note';
import {useRef} from 'react';
import {createPortal} from 'react-dom';
import {useDialog} from '../../web/src/ui/useDialog';
import './logs.css';
export function LogDialog({record,onClose}:{record:any;onClose:()=>void}){
 const ref=useRef<HTMLElement>(null);useDialog(true,onClose,ref,'button');
 return createPortal(<div className="overlay"><section ref={ref} className="modal log-modal" role="dialog" aria-modal="true" aria-labelledby="log-detail-title" tabIndex={-1}><div className="modal-header"><h2 id="log-detail-title">运行日志详情</h2><button className="btn" type="button" onClick={onClose}>关闭</button></div><div className="modal-content"><LogDetail record={record}/></div></section></div>,document.body);
}
export function LogDetail({record:r}:{record:any}){
 const pairs=[['时间',labelTime(r.occurred_at)],['服务 / 实例',`${r.service} / ${r.instance||'历史未记录'}`],['模块 / 事件',`${r.module||'—'} / ${r.event||'HTTP_REQUEST'}`],['级别',r.level],['事件说明',r.message||'历史请求记录'],['请求号',r.request_id],['追踪号',r.trace_id||'历史未记录'],['Span / 父Span',`${r.span_id||'—'} / ${r.parent_span_id||'—'}`],['操作人 / 类型',`${r.actor_id||'历史未记录'} / ${r.actor_kind||'—'}`],['接口',`${r.method} ${r.route}`],['HTTP / 错误码',`${r.status||'不适用'} / ${r.code||'—'}`],['耗时',`${r.duration_ms} ms`]];
 const q=encodeURIComponent(r.request_id);
 return <><div className="detail-grid">{pairs.map(([label,value])=><div key={label} className="meta-item" style={{minWidth:0,overflowWrap:'anywhere'}}><span className="muted small">{label}</span><div>{value}</div></div>)}</div>
 <div className="row"><HashLink route={`audit?view=logs&request_id=${q}`}>同请求日志</HashLink>{r.trace_id&&<HashLink route={`audit?view=logs&trace_id=${encodeURIComponent(r.trace_id)}`}>同追踪日志</HashLink>}<HashLink route={`audit?request_id=${q}`}>关联操作审计</HashLink><HashLink route={`audit?view=diagnostics&request_id=${q}`}>关联采集回执</HashLink></div>
 <h3>入参与业务上下文摘要</h3><Note>对象ID来自当前请求，只用于定位；被拒绝的请求不代表对象已授权或已写入。密码、令牌和原始采样不记录。</Note><pre className="admin-json">{JSON.stringify(r.context||{},null,2)}</pre>
 {r.error&&<><h3>异常类型与调用位置</h3><p>{r.error.type} · {r.error.code||'无底层错误码'}</p><pre className="admin-json">{r.error.frames?.length?r.error.frames.join('\n'):'当前异常没有可用栈帧'}{r.error.cause?'\n原因分类：'+JSON.stringify(r.error.cause):''}</pre><Note>隐藏可能包含密码、SQL或客户数据的异常原文，保留文件名、行号、列号与安全错误码。</Note></>}
 <details><summary>查看完整结构化记录</summary><pre className="admin-json">{JSON.stringify(r,null,2)}</pre></details></>;
}
