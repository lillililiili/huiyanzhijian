import {useEffect,useRef,useState} from 'react';
import {PageTitle} from '../ui/PageTitle';
import {Panel} from '../ui/Panel';
import {Button} from '../ui/Button';
import {Note} from '../ui/Note';
import {HashLink} from '../ui/HashLink';
import {type ApiClient,type Person,ApiError} from './api';
import {headersFor} from './importRegistry';
import {businessImportKinds as importKinds,loadBusinessRefs as loadImportRefs,prepareBusinessImport,verifyBusinessImport,resolveBusinessCommand,type BusinessCommand} from './importBusiness';
import {csvText,downloadText,readImportCsv,importTemplate} from './importCsv';
import {requirement} from './importValidation';
import './importConfiguration.css';
const statusText={ready:'待提交',saved:'已保存并回读',error:'未保存',unknown:'结果待确认'};

export function ImportConfiguration({api,user}:{api:ApiClient;user:Person}){
 const [kindId,setKind]=useState('spec'),[fileName,setFileName]=useState(''),[rows,setRows]=useState<Record<string,string>[]>([]),[commands,setCommands]=useState<BusinessCommand[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[previewed,setPreviewed]=useState(false),[page,setPage]=useState(1);
 const stop=useRef(false),input=useRef<HTMLInputElement>(null),kind=importKinds.find(k=>k.id===kindId)!,allowed=user.permissions.includes(kind.permission);
 const pending=commands.some(c=>c.status==='unknown'),saved=commands.filter(c=>c.status==='saved').length;
 useEffect(()=>{const handler=(e:BeforeUnloadEvent)=>{if(busy||pending){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',handler);return()=>window.removeEventListener('beforeunload',handler);},[busy,pending]);
 function reset(id:string){setKind(id);setRows([]);setCommands([]);setFileName('');setError('');setMessage('');setPreviewed(false);setPage(1);if(input.current)input.current.value='';}
 function template(){downloadText(kind.title+'_导入模板.csv',importTemplate(kind));}
 function instructions(){downloadText(kind.title+'_填写说明.txt',[kind.title,kind.description,'格式：CSV UTF-8，最大2 MiB、200条数据。* 为必填，† 为条件必填。第2行填写说明可保留，示例整行必须删除。','正式行的行类型填“数据”；含示例模板必须删除示例整行，不能只删除示例标记。','编号引用平台已有数据。先维护规格与标准，再用工单明细清单一次登记工单、关联线缆与分配任务；线缆/任务也可单独补充。','文件内不得重复操作同一对象。更新会替换该行对应的全部可编辑字段，空值按字段说明处理。','按业务依赖逐步保存，不是整批事务；已保存行不能撤销，失败行按结果修正。',...kind.fields.map(f=>`${f.label}（${requirement(kind,f.label)}）：${f.hint}`)].join('\r\n'),'text/plain;charset=utf-8');}
 async function reference(){setBusy(true);setError('');try{
  const r=await loadImportRefs(api,kindId);const out:unknown[][]=[['类别','业务编号','名称','关联信息','版本']];const specCodes=(ids:string[])=>ids.map(id=>r.catalog.product_specification.find((s:any)=>s.id===id)?.code||id).join(';');
  r.catalog.product_specification.forEach((s:any)=>out.push(['规格',s.code,s.name,s.enabled?'启用':'停用',s.version]));
  r.catalog.device.forEach((d:any)=>out.push(['设备',d.code,d.name,d.metric_code+' / 工序 '+d.process_id,d.version]));
  r.catalog.inspection_process.forEach((p:any)=>out.push(['工序',p.code,p.name,'','']));
  r.catalog.recipes.forEach((x:any)=>out.push(['检测标准',x.code,x.name,x.metric_code+' / '+(x.enabled?'启用':'停用')+' / '+(x.specification_ids?.length?specCodes(x.specification_ids):'全部规格'),x.revision]));
  r.orders.forEach(w=>out.push(['工单',w.external_code,'',specCodes(w.specification_ids||[w.specification_id]),'']));
  r.spools.forEach(s=>out.push(['线缆',s.spool_code,'',r.orders.find(w=>w.id===s.work_order_id)?.external_code+' / '+specCodes([s.specification_id]),s.version]));
  downloadText('当前工厂_'+kind.title+'_引用资料.csv',csvText(out));setMessage('引用资料已读取，来自当前账号可见的服务端档案。');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function readFile(file?:File){if(!file)return;setError('');setMessage('');setRows([]);setCommands([]);setPreviewed(false);setPage(1);setFileName(file.name);
 setBusy(true);try{
  if(!file.name.toLowerCase().endsWith('.csv'))throw Error('请上传CSV UTF-8文件，不支持Excel工作簿');
  if(file.size>2*1024*1024)throw Error('文件不能超过2 MiB');
  const buffer=await file.arrayBuffer();
  let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{throw Error('文件编码不是UTF-8，请另存为“CSV UTF-8”后上传');}
  const parsed=readImportCsv(text,headersFor(kind),kind);
  setRows(parsed);setMessage('已读取'+parsed.length+'行，点击“校验并预览”检查平台关联。');
 }catch(e){setError((e as Error).message);}finally{setBusy(false);if(input.current)input.current.value='';}}

 async function preview(){setBusy(true);setError('');setMessage('');setCommands([]);setPreviewed(false);try{const r=await loadImportRefs(api,kindId);const c=await prepareBusinessImport(api,kindId,rows,r,user);setCommands(c);setPreviewed(true);setMessage(`格式与引用校验通过，共${c.length}项操作；提交时服务端还会检查状态、权限和版本。`);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
 async function submit(){if(!allowed||busy||!previewed)return;setBusy(true);setError('');stop.current=false;setMessage('正在逐行保存；请保持本页打开。');
 const copy=commands.map(c=>({...c}));
 for(let i=0;i<copy.length;i++){
  if(stop.current)break;const c=copy[i];if(c.status==='saved')continue;
  try{
   // Retain the command key and result across network/readback failures; never repeat a known write.
   const resolved=resolveBusinessCommand(c,copy);
   if(!c.result)c.result=await api.request(resolved.path,resolved.body,{'Idempotency-Key':c.key,...(resolved.version!==undefined?{'If-Match':resolved.version}:{})});
   await verifyBusinessImport(api,c);c.status='saved';c.error='';
  }catch(e){c.status=c.result||e instanceof ApiError&&(e.status===0||e.status>=500)?'unknown':'error';c.error=(e as Error).message;
   stop.current=true;
  }
  setCommands([...copy]);
 }
 setCommands([...copy]);setBusy(false);setMessage(`已保存并回读${copy.filter(c=>c.status==='saved').length}/${copy.length}项。${copy.some(c=>c.status==='unknown')?'有结果待确认，请留在本页重试，不要重新上传。':''}`);
 }
 function results(){downloadText(kind.title+'_导入结果.csv',csvText([['文件行','对象','状态','保存对象ID','错误原因','请求键'],...commands.map(c=>[c.row,c.label,statusText[c.status],c.result?.id||'',c.error||'',c.key])]));}
 return <div className="import-page"><PageTitle title="数据导入配置" subtitle="按业务编号关联规格、检测标准、工单、线缆与任务" actions={<HashLink route={kind.destination}>查看{kind.title} →</HashLink>}/>
 <div className="import-layout"><aside className="import-categories" aria-label="导入分类">{[...new Set(importKinds.map(k=>k.group))].map(g=><section key={g}><h2>{g}</h2>{importKinds.filter(k=>k.group===g).map(k=><button key={k.id} disabled={busy||pending} className={k.id===kindId?'selected':''} aria-current={k.id===kindId?'page':undefined} onClick={()=>reset(k.id)}>{k.title}<span>{user.permissions.includes(k.permission)?'→':'只读'}</span></button>)}</section>)}</aside>
 <main className="import-main"><Panel core title={kind.title} tools={<span className="muted">{kind.group}</span>}><p className="import-description">{kind.description}</p>
 <p className="muted small">建议顺序：线缆规格 → 检测标准 → 工单明细（关联规格、登记线缆、分配检测任务）。双测径一项分配同时生成不圆度与护套两个任务。</p><div className="import-steps"><span><b>01</b> 下载模板</span><span><b>02</b> 填写并删除示例</span><span><b>03</b> 校验预览</span><span><b>04</b> 保存并回读</span></div>
 <div className="row"><Button onClick={template}>下载CSV模板（含示例和说明）</Button><Button onClick={instructions}>填写说明</Button><Button disabled={busy} onClick={()=>void reference()}>下载当前引用资料</Button></div>
 <details className="import-guide"><summary>字段说明 · {kind.fields.length}项</summary><table><thead><tr><th>字段</th><th>必填条件</th><th>填写要求</th></tr></thead><tbody><tr><td>行类型 *</td><td>必填</td><td>正式行填写“数据”；示例整行必须删除。</td></tr>{kind.fields.map(f=><tr key={f.label}><td>{f.label}</td><td>{requirement(kind,f.label)}</td><td>{f.hint}</td></tr>)}</tbody></table></details>
 </Panel>
 <Panel core title="上传与校验" tools={<span className="muted">CSV UTF-8 · 2 MiB以内 · 最多200行</span>}>
 {!allowed&&<Note>当前账号没有此项维护权限（{kind.permission}）。可以下载模板与查看说明。</Note>}
 <div className="import-upload"><div><strong>{fileName||'选择填写后的模板文件'}</strong><p>删除示例整行后上传，填写说明行可保留。* 必填，† 条件必填。</p></div><input ref={input} aria-label="上传导入文件" type="file" accept=".csv,text/csv" disabled={busy||pending||!allowed} onChange={e=>void readFile(e.target.files?.[0])}/></div>
 <div className="row"><Button primary disabled={busy||pending||!allowed||!rows.length||commands.some(c=>!!c.result)} onClick={()=>void preview()}>校验并预览</Button><span className="muted">{rows.length?`${rows.length}行待处理`:'尚未选择有效文件'}</span></div>
 {error&&<div role="alert" className="import-error" style={{whiteSpace:'pre-wrap'}}>{error}</div>}{message&&<p role="status" className="import-message">{message}</p>}
 </Panel>
 {!!commands.length&&<Panel core title="导入预览与结果" tools={<Button onClick={results}>下载结果</Button>}>
 <div className="import-summary"><span>待处理 <b>{commands.length-saved}</b></span><span>已保存 <b>{saved}</b></span><span>未保存 <b>{commands.filter(c=>c.status==='error').length}</b></span><span>待确认 <b>{commands.filter(c=>c.status==='unknown').length}</b></span></div>
 <p className="muted small">按工单→线缆→任务顺序保存，每步核对实际字段与关联。失败即暂停，已完成步骤保留，重试跳过已完成步骤。更新以校验时版本为准；版本冲突须重新下载核对。规则导入不会覆盖历史快照。</p>
 <div className="import-table"><table><thead><tr><th>文件行</th><th>对象</th><th>操作内容</th><th>结果</th></tr></thead><tbody>{commands.slice((page-1)*20,page*20).map(c=><tr key={c.key}><td>{c.row}</td><td>{c.label}</td><td><details><summary>查看字段{c.version!==undefined?` · 版本${c.version}`:''}</summary><dl className="import-values">{Object.entries(c.display).filter(([k,v])=>k!=='行类型'&&v).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{c.depends.length>0&&<p className="muted small">须完成 {c.depends.length} 项前置登记</p>}</details></td><td><strong className={'import-state '+c.status}>{statusText[c.status]}</strong>{c.status==='saved'&&c.destination&&<div><HashLink route={c.destination}>查看已保存内容 →</HashLink></div>}{c.error&&<p className="import-error">{c.error}</p>}</td></tr>)}</tbody></table></div>
 <div className="import-footer"><div className="row"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>上一页</Button><span>{page} / {Math.ceil(commands.length/20)}</span><Button disabled={page*20>=commands.length} onClick={()=>setPage(p=>p+1)}>下一页</Button></div><div className="row">{busy?<Button onClick={()=>{stop.current=true;setMessage('当前行完成后暂停。');}}>暂停后续行</Button>:<Button primary disabled={!allowed||saved===commands.length} onClick={()=>void submit()}>{pending?'重试确认结果':saved?'继续导入未保存项':`确认导入 ${commands.length} 项`}</Button>}</div></div>
 </Panel>}
 <details className="import-boundaries"><summary>导入范围与保存说明</summary><p>所有保存均使用当前账号的服务端维护接口，由数据库持久化并记录原模块审计。页面不会自动导入采样、判定结果、审计日志或已冻结报告。</p><p>仅导入线缆规格、检测标准与配方、工单、线缆及检测任务/计划。设备资料、采集配置、账号权限和系统参数由专业人员在对应页面维护，不提供导入。</p><p>预览及请求键只保留在当前页面。存在待确认请求时，请先重试确认再离开，避免另建批次。</p></details>
 </main></div></div>;
}
