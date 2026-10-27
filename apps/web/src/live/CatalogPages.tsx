import {useState} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {DataTable} from '../ui/DataTable';
import {Button} from '../ui/Button';
import {Field,TextInput} from '../ui/Field';
import {Modal} from '../ui/Modal';
import {Note} from '../ui/Note';
import {HashLink} from '../ui/HashLink';
import {useRead} from './ServerLists';
import {DeviceCatalog} from './OperationsPages';
import {names,labelTime,type ApiClient,type Commands,type Workspace,type Person} from './api';

type Props={api:ApiClient;commands:Commands;data:Workspace;user:Person;params:URLSearchParams;refresh:()=>Promise<void>};
type Spec={id:string;code:string;name:string;version:string;voltage_kv:string;conductor_area_mm2:string;core_count:number;shield_structure:string;enabled:boolean;cable_model:string;customer_code:string;product_type:string;description:string;applicability:{process_id:string;metric_code:string}[]};
type List<T>={items:T[];page:number;limit:number;total:number};
const structureNames:Record<string,string>={tape:'铜带屏蔽',wire:'铜丝屏蔽',combined:'复合屏蔽',none:'无屏蔽'};
const navigate=(route:string)=>{window.location.hash='#'+route;};

function Revisions({api,kind,id,tick}:{api:ApiClient;kind:string;id:string;tick:number}){
 const [page,setPage]=useState(1),[selected,setSelected]=useState<any>(null);
 const r=useRead<List<any>>(api,`/catalog/revisions/${kind}/${id}?page=${page}&limit=10`,tick);
 return <Panel core table title="档案版本履历">
 {r.error?<Note><span role="alert">履历读取失败：{r.error}</span></Note>:!r.value?<Note>正在读取履历…</Note>:<>
 <DataTable headers={['版本','记录时间','操作人ID','原因','详情']} rows={r.value.items.map(x=>[x.version,labelTime(x.recorded_at),x.actor_id||'原修改人未知',x.reason,<Button onClick={()=>setSelected(x)}>查看版本</Button>])}/>
 {!r.value.total&&<Note>尚未发生维护操作；首次维护时保留原档案基线。</Note>}
 <div className="row"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>第{page}页 · 共{r.value.total}个版本</span><Button disabled={page*10>=r.value.total} onClick={()=>setPage(p=>p+1)}>下一页</Button></div></>}
 {selected&&<Modal title={`档案版本 ${selected.version}`} open onClose={()=>setSelected(null)} submitLabel="关闭" onSubmit={()=>{}}><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{JSON.stringify(selected.snapshot,null,2)}</pre><p>请求号：{selected.request_id}</p></Modal>}
 </Panel>;
}

function SpecEditor({props,initial,onClose,onSaved}:{props:Props;initial:Spec|null;onClose:()=>void;onSaved:(s:Spec)=>void}){
 const [structure,setStructure]=useState(initial?.shield_structure||'tape');
 const pairs=[...props.data.catalog.device.map(d=>({process_id:d.process_id,metric_code:d.metric_code})),...(initial?.applicability||[])];
 const choices=pairs.filter((a,i)=>pairs.findIndex(b=>b.process_id===a.process_id&&b.metric_code===a.metric_code)===i).map(a=>({...a,label:`${props.data.catalog.inspection_process.find(p=>p.id===a.process_id)?.name||a.process_id} / ${names[a.metric_code]}`}));
 const [checked,setChecked]=useState(new Set(initial?.applicability.map(a=>a.process_id+'|'+a.metric_code)||[]));
 const selectAll=()=>setChecked(new Set(choices.map(c=>c.process_id+'|'+c.metric_code)));
 const clearAll=()=>setChecked(new Set());
 return <Modal title={initial?'编辑规格档案':'新增规格档案'} open onClose={onClose} onSubmit={async f=>{
  const b:any=Object.fromEntries(['code','name','voltage_kv','conductor_area_mm2','cable_model','customer_code','product_type','description','reason'].map(k=>[k,String(f.get(k)||'').trim()]));
  b.core_count=Number(f.get('core_count'));b.shield_structure=structure;b.enabled=f.get('enabled')==='true';b.applicability=choices.filter(c=>checked.has(c.process_id+'|'+c.metric_code)).map(({process_id,metric_code})=>({process_id,metric_code}));
  const saved=await props.commands.run<Spec>('/catalog/specifications'+(initial?'/'+initial.id:''),b,initial?.version);onSaved(saved);await props.refresh();
 }}>
 <div className="form-grid">
 <Field label="规格编号"><TextInput aria-label="规格编号" name="code" required maxLength={64} value={initial?.code||''}/></Field>
 <Field label="规格名称"><TextInput aria-label="规格名称" name="name" required maxLength={128} value={initial?.name||''}/></Field>
 <Field label="电压 kV"><TextInput aria-label="电压 kV" name="voltage_kv" required inputMode="decimal" value={initial?.voltage_kv||'35'}/></Field>
 <Field label="导体截面积 mm²"><TextInput aria-label="导体截面积 mm²" name="conductor_area_mm2" required inputMode="decimal" value={initial?.conductor_area_mm2||''}/></Field>
 <Field label="芯数"><TextInput aria-label="芯数" name="core_count" type="number" required min="1" max="1000" step="1" value={initial?.core_count||1}/></Field>
 <Field label="屏蔽结构"><select value={structure} onChange={e=>setStructure(e.target.value)}>{Object.entries(structureNames).map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></Field>
 <Field label="线缆型号"><TextInput aria-label="线缆型号" name="cable_model" maxLength={128} value={initial?.cable_model||''}/></Field>
 <Field label="客户代码"><TextInput aria-label="客户代码" name="customer_code" maxLength={128} value={initial?.customer_code||''}/></Field>
 <Field label="产品类型"><TextInput aria-label="产品类型" name="product_type" maxLength={128} value={initial?.product_type||''}/></Field>
 <Field label="状态"><select name="enabled" defaultValue={String(initial?.enabled??true)}><option value="true">启用</option><option value="false">停用</option></select></Field>
 </div>
 <fieldset className="b2-group"><legend>适用工序与检测项（至少一项）</legend><div className="row"><Button onClick={selectAll}>全选检测项</Button><Button onClick={clearAll}>清空选择</Button></div><div className="spec-applicability-choices">{choices.map(c=>{const k=c.process_id+'|'+c.metric_code;return <label key={k}><input type="checkbox" checked={checked.has(k)} onChange={e=>setChecked(old=>{const next=new Set(old);if(e.target.checked)next.add(k);else next.delete(k);return next;})}/><span>{names[c.metric_code]}<small>{props.data.catalog.inspection_process.find(p=>p.id===c.process_id)?.name||c.process_id}</small></span></label>;})}</div></fieldset>
 <Field label="规格说明"><textarea name="description" maxLength={2000} defaultValue={initial?.description||''}/></Field>
 <Field label="修改原因"><TextInput aria-label="修改原因" name="reason" required maxLength={500}/></Field>
 <Note>测试模式允许选择当前设备接入的三项指标，不按屏蔽结构隐藏。此处和“三项检测指标”页共用适用关系；修改生成新版本，历史任务保持创建快照。测试选择不代表生产适用性已批准。</Note>
 </Modal>;
}

export function Specifications(props:Props){
 const {api,params,user}=props,id=params.get('id'),[tick,setTick]=useState(0),[editing,setEditing]=useState(false);
 const query=new URLSearchParams();for(const k of ['q','enabled','page','limit'])if(params.get(k))query.set(k,params.get(k)!);
 const r=useRead<any>(api,id?'/catalog/specifications/'+encodeURIComponent(id):'/catalog/specifications?'+query,tick);
 const write=user.permissions.includes('catalog:write'),back=params.get('back')||'specs';
 const page=Number(query.get('page')||1),limit=Number(query.get('limit')||20);
 const turn=(p:number)=>{const next=new URLSearchParams(query);next.set('page',String(p));navigate('specs?'+next);};
 const saved=(s:Spec)=>{setTick(v=>v+1);if(!id)navigate('specs?id='+encodeURIComponent(s.id)+'&back='+encodeURIComponent('specs?'+query));};
 return <><PageTitle title={id?'规格档案详情':'产品规格档案'} subtitle="按工厂维护 · 版本与修改原因可追溯" actions={<>{id&&<HashLink route={back}>返回规格列表</HashLink>}<Button onClick={()=>setTick(t=>t+1)}>刷新档案</Button>{write&&(!id||r.value)&&<Button primary onClick={()=>setEditing(true)}>{id?'编辑规格':'新增规格'}</Button>}</>}/>
 {!id&&<form key={params.toString()} className="filters" onSubmit={e=>{e.preventDefault();const q=new URLSearchParams();new FormData(e.currentTarget).forEach((v,k)=>{if(v)q.set(k,String(v));});navigate('specs?'+q);}}>
 <Field label="编号 / 名称 / 型号 / 客户"><TextInput aria-label="编号 / 名称 / 型号 / 客户" name="q" maxLength={128} value={query.get('q')||''}/></Field><Field label="启用状态"><select name="enabled" defaultValue={query.get('enabled')||''}><option value="">全部</option><option value="true">启用</option><option value="false">停用</option></select></Field><button className="btn primary">查询</button><HashLink route="specs">清空筛选</HashLink></form>}
 {r.error?<Note><span role="alert">档案读取失败：{r.error}</span></Note>:!r.value?<Note>正在读取档案…</Note>:id?<>
 <Panel core title={`${r.value.code} · ${r.value.name}`}><div className="detail-grid">{Object.entries({版本:r.value.version,状态:r.value.enabled?'启用':'停用',内部ID:r.value.id,线缆型号:r.value.cable_model||'未填写',电压:r.value.voltage_kv+' kV',导体截面积:r.value.conductor_area_mm2+' mm²',芯数:r.value.core_count,结构:structureNames[r.value.shield_structure]||r.value.shield_structure,客户代码:r.value.customer_code||'未填写',产品类型:r.value.product_type||'未填写',说明:r.value.description||'未填写'}).map(([k,v])=><div className="meta-item" key={k}><span className="muted small">{k}</span><div>{String(v)}</div></div>)}</div></Panel>
 <Panel core table title="适用工序与指标"><DataTable headers={['工序','检测项']} rows={r.value.applicability.map((a:any)=>[props.data.catalog.inspection_process.find(p=>p.id===a.process_id)?.name||a.process_id,names[a.metric_code]])}/></Panel>
 <Revisions key={id} api={api} kind="specifications" id={id} tick={tick}/>
 </>:<Panel core table title="规格列表"><DataTable headers={['编号 / 名称','电压 / 截面积','芯数 / 结构','型号 / 客户','状态 / 版本','操作']} rows={r.value.items.map((s:Spec)=>[<>{s.code}<div>{s.name}</div></>,`${s.voltage_kv} kV / ${s.conductor_area_mm2} mm²`,`${s.core_count} / ${structureNames[s.shield_structure]||s.shield_structure}`,`${s.cable_model||'未填写'} / ${s.customer_code||'未填写'}`,`${s.enabled?'启用':'停用'} / v${s.version}`,<HashLink route={'specs?id='+encodeURIComponent(s.id)+'&back='+encodeURIComponent('specs?'+query)}>详情与维护</HashLink>])}/>{!r.value.total&&<Note>查询成功，没有匹配的规格。</Note>}<div className="row"><Button disabled={page===1} onClick={()=>turn(page-1)}>上一页</Button><span>第{page}页 · 共{r.value.total}条</span><Button disabled={page*limit>=r.value.total} onClick={()=>turn(page+1)}>下一页</Button></div></Panel>}
 {editing&&<SpecEditor props={props} initial={id?r.value:null} onClose={()=>setEditing(false)} onSaved={saved}/>}
 </>;
}

export function ManagedDevices(props:Props){
 const id=props.params.get('id'),device=props.data.catalog.device.find(d=>d.id===id) as any,[editing,setEditing]=useState(false),[tick,setTick]=useState(0);
 return <><DeviceCatalog data={props.data} id={id}/>{device&&<>
 <Panel core title="维护资料" tools={props.user.permissions.includes('catalog:write')?<Button primary onClick={()=>setEditing(true)}>编辑基础资料</Button>:undefined}>
 <div className="detail-grid">{[['厂商',device.manufacturer],['序列号',device.serial_number],['固件',device.firmware],['备注',device.notes],['档案版本',device.version]].map(([k,v])=><div className="meta-item" key={k}><span className="muted small">{k}</span><div>{v||'未填写'}</div></div>)}</div><Note>此处维护资料说明；设备启停、协议、量程、校准和来源环境由后续受控配置管理。</Note>
 </Panel><Revisions key={id} api={props.api} kind="devices" id={id!} tick={tick}/>
 {editing&&<Modal title="编辑设备基础资料" open onClose={()=>setEditing(false)} onSubmit={async f=>{const fields=['name','model','manufacturer','serial_number','firmware','notes','reason'];await props.commands.run('/catalog/devices/'+device.id,Object.fromEntries(fields.map(k=>[k,String(f.get(k)||'').trim()])),String(device.version));await props.refresh();setTick(t=>t+1);}}>
 {([['name','设备名称'],['model','型号说明'],['manufacturer','厂商'],['serial_number','序列号'],['firmware','固件'],['notes','备注'],['reason','修改原因']] as const).map(([k,label])=><Field key={k} label={label}><TextInput aria-label={label} name={k} required={['name','model','reason'].includes(k)} maxLength={k==='notes'?2000:k==='reason'?500:128} value={k==='reason'?'':device[k]||''}/></Field>)}
 </Modal>}</>}</>;
}
