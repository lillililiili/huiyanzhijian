import {SpecificationPicker} from "./SpecificationPicker";
import {availableRecipes,recipeLabel} from './recipeOptions';
import { useRef, useState } from "react";
import { Modal } from "../ui/Modal";
import { Field, TextInput } from "../ui/Field";
import { Note } from "../ui/Note";
import { DataTable } from "../ui/DataTable";
import { HashLink } from "../ui/HashLink";
import { environmentLabel, names, specificationLabel, type Commands, type Workspace, type WorkOrder, type Spool, type Task } from "./api";

type Props = { commands: Commands; data: Workspace; close: () => void; refresh: () => Promise<void>; initialOrder?:string; initialSpool?:string; onCreated?:(order:WorkOrder)=>void };
export function WorkOrderForm({ commands, data, close, refresh, onCreated, initialOrder }: Props) {
  const editing=data.orders.find(o=>o.id===initialOrder);
  return <Modal title={editing?"修改订单规格":"新建工单"} open onClose={close} onSubmit={async values => {
    if(!values.getAll("spec").length)throw Error("请至少选择一个产品规格");const created=await commands.run<WorkOrder>(editing?"/work-orders/"+editing.id+"/specifications":"/work-orders", editing?{specification_ids:values.getAll("spec")}:{ external_code: String(values.get("code")).trim(), specification_ids: values.getAll("spec") }); await refresh();onCreated?.(created);
  }}><Field label="订单编号 / 工单编号"><input name="code" required maxLength={128} defaultValue={editing?.external_code||""} readOnly={!!editing}/></Field><SpecificationPicker options={data.catalog.product_specification.filter(s=>s.enabled||editing?.specification_ids?.includes(s.id))} initial={editing?.specification_ids||(editing?[editing.specification_id]:[])}/><Note>一个订单对应一个工单；登记每盘线缆时再选择该盘的具体规格。</Note></Modal>;
}
export function SpoolForm({ commands, data, close, refresh, initialOrder }: Props) {
  const [results, setResults] = useState<{code: string; result: string}[]>([]);
  const [codesText,setCodesText]=useState("");
  const [spoolOrder,setSpoolOrder]=useState(initialOrder||"");
  const [spoolSpec,setSpoolSpec]=useState("");
  const spoolWo=data.orders.find(o=>o.id===spoolOrder);const orderSpecs=spoolWo?.specification_ids||[spoolWo?.specification_id||""];const actualSpec=spoolSpec||(orderSpecs.length===1?orderSpecs[0]:"");
  const codeCount=new Set(codesText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)).size;
  const completed = useRef(new Map<string, string>());
  return <Modal title="登记多盘线缆" open onClose={close} submitDisabled={!actualSpec || !spoolOrder || !codeCount || codeCount>50 || (results.length>0 && results.every(r=>r.result==="已登记"))} submitLabel={results.some(r=>r.result!=="已登记")?`重试${results.filter(r=>r.result!=="已登记").length}个失败盘号`:`登记${new Set(codesText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)).size}盘线缆`} onSubmit={async values => {
    const wo = String(values.get("order")); const codes = [...new Set(String(values.get("codes")).split(/\r?\n/).map(s => s.trim()).filter(Boolean))];
    if (!wo || !codes.length || codes.length > 50) throw Error("请选择工单，每次登记1～50个盘号，每行一个");
    const rows = [];
    for (const code of codes) {
      const signature = `${wo}:${actualSpec}:${code}`;
      try {
        const existing = data.spools.find(s => s.work_order_id === wo && s.spool_code === code);
        if (!completed.current.has(signature)) {
          if(existing&&existing.specification_id!==actualSpec)throw Error("该盘号已按其他规格登记，请使用不同盘号");
          const item = existing || await commands.run<Spool>("/spools", { work_order_id: wo, spool_code: code, specification_id:actualSpec }); completed.current.set(signature, item.id);
        }
        rows.push({code, result: "已登记"});
      } catch (e) { rows.push({code, result: e instanceof Error ? e.message : "失败"}); }
      setResults([...rows]);
    }
    await refresh(); return false as const;
  }}><Field label="所属工单"><select name="order" required value={spoolOrder} onChange={e=>{setSpoolOrder(e.target.value);setSpoolSpec("");setResults([]);}}><option value="">请选择</option>{data.orders.map(o => <option key={o.id} value={o.id}>{o.external_code}</option>)}</select></Field>
    <Field label="本批线缆规格"><select required value={actualSpec} onChange={e=>{setSpoolSpec(e.target.value);setResults([])}}><option value="">请选择本批线缆规格</option>{data.catalog.product_specification.filter(s=>orderSpecs.includes(s.id)).map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field><Field label="线缆盘号（每行一个，相同规格）"><textarea name="codes" value={codesText} onChange={e=>{setCodesText(e.target.value);setResults([]);}} rows={5} required maxLength={6500} /></Field>
    <Note>{!spoolOrder?"请先选择所属工单。":!codeCount?"请输入线缆盘号，每行一个。":codeCount>50?"每批最多登记50盘，请分批登记。":results.length>0&&results.every(r=>r.result==="已登记")?"本批线缆已全部登记，可关闭窗口后分配任务。":""} 每盘独立保存，同工单同盘号只登记一次；检测任务在下一步分配。</Note>
    {!!results.length && <DataTable headers={["盘号", "结果"]} rows={results.map(r => [r.code,r.result])} />}
  </Modal>;
}
export function TaskForm({ commands, data, close, refresh, collect, initialOrder, initialSpool }: Props & { collect?: (items: Record<string, unknown>[]) => void }) {
  const [register,setRegister]=useState(false);
  const [order, setOrder] = useState(initialOrder||"");
  const [selected, setSelected] = useState<string[]>(initialSpool?[initialSpool]:[]);
  const [deviceIds, setDeviceIds] = useState<string[]>([]);
  const [results, setResults] = useState<{label: string; id?: string; error?: string}[]>([]);
  const done = useRef(new Map<string, Task>());
  const wo = data.orders.find(o => o.id === order);
  const [specChoice,setSpecChoice]=useState(data.spools.find(s=>s.id===initialSpool)?.specification_id||"");
  const allowedSpecs=wo?.specification_ids||[wo?.specification_id||""];
  const specId=specChoice||(allowedSpecs.length===1?allowedSpecs[0]:"");
  const spools = data.spools.filter(s => s.work_order_id === order && s.specification_id===specId);
  const devices = data.catalog.device.filter(d => d.enabled && data.catalog.specification_applicability.some(a => a.specification_id === specId && a.process_id === d.process_id && a.metric_code === d.metric_code));
  const toggle = (list: string[], id: string) => list.includes(id) ? list.filter(x => x !== id) : [...list,id];
  if(register)return <SpoolForm commands={commands} data={data} refresh={refresh} initialOrder={order} close={()=>setRegister(false)}/>;
  return <Modal title={collect?"添加计划执行项":"新建多盘检测任务"} open onClose={close} submitDisabled={!wo || !selected.length || !deviceIds.length || selected.length*deviceIds.length>50} submitLabel={collect?`加入${selected.length*deviceIds.length}个执行项`:results.some(r=>r.error)?`重试${results.filter(r=>r.error).length}个失败项`:`创建${selected.length*deviceIds.length}个任务`} onSubmit={async values => {
    if (!wo || !selected.length || !deviceIds.length) throw Error("请选择工单、线缆和执行设备");
    if (selected.length * deviceIds.length > 50) throw Error("每批最多50个执行任务，请分批创建");
    const rows: typeof results = [];
    if (collect) { collect(selected.flatMap(spoolId => deviceIds.map(deviceId => { const d = devices.find(x => x.id === deviceId)!; return {work_order_id: wo.id, spool_id: spoolId, specification_id: specId, process_id: d.process_id, device_id: d.id, metric_code: d.metric_code, recipe_version_id: values.get(`recipe-${d.id}`)||null, planned_length_m: String(values.get("length"))}; }))); return; }
    for (const spoolId of selected) for (const deviceId of deviceIds) {
      const device = devices.find(d => d.id === deviceId); if (!device) throw Error("设备适用关系已变化，请重新选择");
      const body = { work_order_id: wo.id, spool_id: spoolId, specification_id: specId, process_id: device.process_id, device_id: device.id, metric_code: device.metric_code,
        recipe_version_id: values.get(`recipe-${device.id}`) || null, planned_length_m: String(values.get("length")) };
      const signature = JSON.stringify(body), label = `${spools.find(s => s.id === spoolId)?.spool_code} · ${device.id} · ${names[device.metric_code]}`;
      try { const task = done.current.get(signature) || await commands.run<Task>("/tasks", body); done.current.set(signature,task); rows.push({label,id:task.id}); }
      catch (e) { rows.push({label,error:e instanceof Error ? e.message : "创建失败"}); }
      setResults([...rows]);
    }
    await refresh(); return false as const;
  }}>
    <Field label="工单"><select name="order" value={order} onChange={e => {setOrder(e.target.value);setSpecChoice("");setSelected([]);setDeviceIds([]);setResults([]);}} required><option value="">请选择已有工单</option>{data.orders.map(o => <option key={o.id} value={o.id}>{o.external_code} · {(o.specification_ids||[o.specification_id]).length}种规格</option>)}</select></Field>
    <Field label="本批任务规格"><select required value={specId} onChange={e=>{setSpecChoice(e.target.value);setSelected([]);setDeviceIds([]);setResults([])}}><option value="">请选择订单中的规格</option>{data.catalog.product_specification.filter(s=>allowedSpecs.includes(s.id)).map(s=><option key={s.id} value={s.id}>{specificationLabel(s)}</option>)}</select></Field><fieldset className="b2-group"><legend>线缆（可多选）</legend><div className="b2-choices">{spools.map(s => <label key={s.id}><input type="checkbox" checked={selected.includes(s.id)} onChange={() => {setSelected(toggle(selected,s.id));setResults([]);}} />{s.spool_code}</label>)}{!spools.length && <span>{!order?"请先选择工单。":<>当前规格尚无线缆。<button className="btn" type="button" onClick={()=>setRegister(true)}>登记线缆</button></>}</span>}</div></fieldset>
    <fieldset className="b2-group"><legend>执行设备与检测项（可多选）</legend>{!devices.length&&<Note>{order?"当前规格没有可用的适用设备，请核对基础配置。":"选择工单后显示适用设备。"}</Note>}<div className="b2-choices">{devices.map(d => <label key={d.id}><input type="checkbox" checked={deviceIds.includes(d.id)} onChange={() => {setDeviceIds(toggle(deviceIds,d.id));setResults([]);}} />{d.id} · {names[d.metric_code]} · {environmentLabel(d.data_environment)}</label>)}</div></fieldset>
    {devices.filter(d => deviceIds.includes(d.id)).map(d => <Field key={d.id} label={`${d.id} 配方`}><select name={`recipe-${d.id}`}><option value="">仅采集，不判定</option>{availableRecipes(data.catalog.recipes,d,specId).map(r => <option key={r.id} value={r.id}>{recipeLabel(r)}</option>)}</select></Field>)}
    <Field label="每个任务计划长度 / m"><TextInput name="length" type="number" value="100" required min="0.0000000001" step="any" /></Field>
    <Note>{!wo ? "请先选择工单。" : !selected.length ? "请选择需要检测的线缆。" : !deviceIds.length ? "请选择执行设备与检测项。" : selected.length*deviceIds.length>50 ? "本次超过50个任务，请减少选择或分批创建。" : "选择完成。"} 将创建 {selected.length * deviceIds.length} 个独立任务。同一设备只能同时运行一个任务；下一盘需在上一任务结束后开始。测试规则仅用于模拟数据。</Note>
    {!!results.length && <DataTable headers={["线缆 / 设备 / 指标", "逐项结果"]} rows={results.map(r => [r.label, r.id ? <HashLink route={`task?id=${r.id}`}>已创建 · 查看任务</HashLink> : r.error])} />}
  </Modal>;
}
