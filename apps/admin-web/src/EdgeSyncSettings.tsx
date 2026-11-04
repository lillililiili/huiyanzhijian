import {useEffect,useState} from 'react';
import {Panel} from '../../web/src/ui/Panel';
import {DataTable} from '../../web/src/ui/DataTable';
import {Button} from '../../web/src/ui/Button';
import {Field} from '../../web/src/ui/Field';
import {Modal} from '../../web/src/ui/Modal';
import {Note} from '../../web/src/ui/Note';
import {useRead} from '../../web/src/shared/useRead';
import {labelTime,type ApiClient,type Commands,type Person} from '../../web/src/shared/api';

const states:Record<string,string>={UNCONFIGURED:'等待配置',PENDING:'等待推送',RETRYING:'推送失败 · 自动重试',NEXT_RUN:'边缘已接收 · 下一盘生效',ACTIVE:'本盘已生效',REQUIRES_DISTANCE:'需要配置仪器间距'};
export function EdgeSyncSettings({api,commands,user}:{api:ApiClient;commands:Commands;user:Person}){
 const allowed=user.permissions.includes('settings:write');
 const [tick,setTick]=useState(0),[edit,setEdit]=useState<any>(null),[notice,setNotice]=useState('');
 const result=useRead<{items:any[]}>(api,allowed?'/admin/edge-sync':null,tick);
 useEffect(()=>{if(!allowed)return;const timer=setInterval(()=>setTick(v=>v+1),10000);return()=>clearInterval(timer);},[allowed]);
 if(!allowed)return <Note>当前账号没有初始化配置权限。</Note>;
 return <><Panel core title="测径仪安装间距" tools={<Button onClick={()=>setTick(v=>v+1)}>刷新推送状态</Button>}>
 <p>配置测径仪 A 与 B 测量截面之间的线缆路径距离，单位为毫米。保存后平台自动推送距离，补偿时间由计米器计算。</p>
 <Note>填写现场实测距离，精确到 1 mm。运行中的本盘保留原距离，新版本从下一盘生效；补偿时间无需在后台填写。</Note>
 {notice&&<Note>{notice}</Note>}{result.error&&<Note><span role="alert">同步状态读取失败：{result.error}。当前推送状态未知。</span></Note>}
 {!result.value&&!result.error&&<p>读取同步配置…</p>}
 {result.value&&<DataTable headers={['设备','A / B 间距','配置版本','距离推送与生效','操作']} rows={result.value.items.map(r=>[
  <><strong>{r.device_name}</strong><div className="muted small">{r.device_id} · {r.environment==='SIMULATED'?'接入设备':'现场设备'}</div></>,
  r.distance_mm==null?'未配置':r.distance_mm+' mm',
  r.version==='0'?'—':`期望 V${r.version} / 已接收 ${r.delivered_version?'V'+r.delivered_version:'—'}`,
  <><strong>{result.error?'状态未知':!r.target_ready?'推送通道未安装':states[r.delivery_state]||r.delivery_state}</strong><div className="muted small">最近尝试：{labelTime(r.last_attempt_at)}</div>{r.active_version&&<div className="muted small">当前盘 V{r.active_version}</div>}{r.last_error&&<div>{r.last_error}</div>}</>,
  <Button disabled={!r.target_ready||Boolean(result.error)} onClick={()=>setEdit(r)}>配置并推送</Button>
 ])}/>}
 {result.value?.items.length===0&&<Note>当前工厂尚未安装边缘推送通道。安装端关联设备、边缘地址及机器凭据后，此处即可配置；凭据不会在网页显示。</Note>}
 </Panel>
 {edit&&<Modal title={`安装间距 · ${edit.device_name}`} open onClose={()=>setEdit(null)} submitLabel="保存并自动推送" onSubmit={async f=>{
  await commands.run('/admin/edge-sync/'+encodeURIComponent(edit.device_id),{distance_mm:Number(f.get('distance_mm')),reason:f.get('reason')},String(edit.version));
  setNotice('距离已保存，正在自动推送。距离接收成功后，仍需有效计米器数据才能同步取点。');setTick(v=>v+1);
 }}>
 <Field label="测径仪 A 与 B 之间的距离 / mm"><input name="distance_mm" type="number" min="1" max="2147483647" step="1" required defaultValue={edit.distance_mm??''} placeholder="填写沿线缆路径实测的整数毫米数；1 m = 1000 mm"/></Field>
 <Field label="修改原因 / 测量依据"><input name="reason" required maxLength={500} placeholder="记录距离测量依据或安装调整原因"/></Field>
 <Note>距离按两台测径仪的测量截面、沿线缆实际路径测量。计米器负责计算补偿时间，边缘端据此同步 A / B 取点；缺少有效计米器数据时不显示护套厚度。</Note>
 </Modal>}</>;
}
