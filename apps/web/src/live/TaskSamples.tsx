import {labelTime,type SampleSummary} from './api';
export function TaskSamples({summary:s}:{summary?:SampleSummary}){
 if(!s)return <span className="muted">采样摘要暂不可用</span>;
 return <div className="b3r3-samples">
  <div>样本 {s.total} · 有效 {s.valid} · 无效/缺测 {s.invalid}</div>
  <div>超限 {s.failed} · 未判定 {s.unevaluated} · 隔离 {s.quarantined}</div>
  <div className="muted small">最近：{labelTime(s.latest_sample_at)}</div>
  <div className="muted small">有效已存值：{s.minimum??'—'} ～ {s.maximum??'—'} {s.unit||''} · 均值 {s.mean??'—'}</div>
 </div>;
}
