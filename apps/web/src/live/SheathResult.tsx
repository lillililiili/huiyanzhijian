import {compactDecimal} from './detectionDisplay';

export function SheathResult({result}:{result:any}){
 if(!result)return null;
 const p=result.pair;
 return <section className="sheath-thickness-card" aria-label="护套厚度配对结果"><div className="sheath-card-header"><strong>护套厚度 · 双测径配对</strong><span>{result.status==='VERIFIED'?'中心核对通过':result.status==='INVALID'?'配对校验不通过':'暂无可用配对'}</span></div>
 <div className="sheath-stats-row"><div className="sheath-stat-cell"><span className="stat-label">A 均径 − B 均径</span><strong className="stat-value">{result.value===null?'—':compactDecimal(result.value)} <small>mm</small></strong></div><div className="sheath-stat-cell"><span className="stat-label">出口 A / 入口 B 均径</span><strong>{p?.aMean??'—'} / {p?.bMean??'—'} mm</strong></div><div className="sheath-stat-cell"><span className="stat-label">采样补偿时间</span><strong>{p?.delayMs??'—'} ms</strong><span className="stat-note">距离配置版本 {p?.syncRevision??'—'}</span></div></div>
 <p className="sheath-footnote">{result.reason}。保留负值与零值；该辅助结果不代表产品放行。</p><details><summary>配对依据</summary><p>A：{p?.aAt??'—'} · 样本 {p?.aId??'—'}</p><p>B：{p?.bAt??'—'} · 样本 {p?.bId??'—'}</p><p>算法：{result.method} · 校验版本：{result.validation_version}</p></details></section>;
}
