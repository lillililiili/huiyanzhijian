import {useRead} from './ServerLists';
import {Panel} from '../ui/Panel';
import {Note} from '../ui/Note';
import {type ApiClient,type Task,labelTime} from './api';

export function OdmSource({api,task}:{api:ApiClient;task:Task}){
 const {value,error}=useRead<{line_id:string;device_id:string;created_at:string}|null>(api,'/tasks/'+task.id+'/odm-source',String(task.version));
 return <Panel core title="整机订单与采集来源">{error?<Note>{error}</Note>:value?<div className="detail-grid"><div className="meta-item"><span className="muted small">设备订单号（lineId）</span><strong>{value.line_id}</strong></div><div className="meta-item"><span className="muted small">检测设备</span><span>{value.device_id}</span></div><div className="meta-item"><span className="muted small">扫码绑定时间</span><span>{labelTime(value.created_at)}</span></div></div>:<p className="muted">扫码绑定后在此显示设备订单；历史记录保留原归属。</p>}<Note>设备自带采集软件，通过厂家数据接口接入中心。每次检测使用新的设备订单号；扫码开启独立采集，补传记录仍归属原订单与任务。</Note></Panel>;
}
