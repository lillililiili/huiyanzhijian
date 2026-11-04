'use strict';
// Three physical streams, four derived business results. No independent sheath samples.
function lockBundle(locked){bundleBox.querySelectorAll('input,select,[data-grade],#bundle-read').forEach(el=>el.disabled=locked);}
let bundlePreview=null,bundleRequest=null,bundleBusy=false,bundleSignature='';
const bundleBox=$('presets-module');
bundleBox.innerHTML=`<div class="preset-steps" aria-label="配置步骤"><span>1 选择线缆</span><span>2 核对工序参数</span><span>3 生成并确认</span></div>
<section class="panel preset-section"><div class="preset-heading"><div><span class="eyebrow">01 / 线缆与采样</span><h2>选择本次配置的线缆</h2></div><a href="#specs">只配置一个检测项 →</a></div>
<div class="preset-basics"><label class="preset-cable">应用到线缆<select id="bundle-cable"><option value="">请选择线缆</option></select></label><label>线缆长度 / m<input id="bundle-length" type="number" min="0.000001" step="0.000001"></label><label>初始送料速度 / m/min<input id="bundle-speed" type="number" value="60" min="0.000001" max="600" step="0.000001"></label><label>采样间隔 / ms<input id="bundle-interval" type="number" value="40" min="1" max="60000" step="1"><span class="small muted">40 ms = 25次/秒</span></label></div>
<p id="bundle-selection" class="small muted">选择线缆后读取已配置的基准；本页与单项配置分别编辑。</p></section>
<section class="panel preset-section"><div class="preset-heading"><div><span class="eyebrow">02 / 工序参数</span><h2>核对三路输入，生成四项结果</h2></div><button type="button" id="bundle-read">重新读取已有基准</button></div>
<div id="bundle-inputs" class="preset-processes"></div>
<details class="preset-explanation"><summary>工序与测量说明</summary><p>工序直径是当前检测截面，不由导体截面积推算。周期节距控制模拟波动；没有实测值时仅作为模拟假设。各工序分别建模，不代表同一时刻的同一截面。圆整度和护套厚度由同组 A/B 数据计算，B参数和计米器时间需明确配置。</p></details></section>
<section class="panel preset-section"><span class="eyebrow">03 / 随机场景</span><h2>选择问题程度，生成一组新预设</h2>
<div class="preset-grades"><button type="button" data-grade="1"><strong>轻微问题</strong><span>目标缺陷占比 2–4%</span><small>低概率 · 小幅波动</small></button><button type="button" data-grade="2"><strong>明显问题</strong><span>目标缺陷占比 8–12%</span><small>中概率 · 中幅波动</small></button><button type="button" data-grade="3"><strong>严重问题</strong><span>目标缺陷占比 20–30%</span><small>高概率 · 大幅波动</small></button></div>
<p class="small muted">每次点击都会重新随机。缺陷占比不等于不合格率；生成后先看预览，确认才应用。</p>
<p id="bundle-status" class="notice" role="status">请先选择线缆并核对参数。</p>
<details id="bundle-generation-details" class="preset-explanation" hidden><summary>本次随机参数与种子</summary><p id="bundle-generation-info"></p></details>
<div id="bundle-charts" class="preset-charts"><div class="preset-empty">尚未生成预览。选择一个档位后，这里展示四项曲线。</div></div>
<div class="preset-footer"><span id="bundle-save-hint" class="muted">当前没有待确认的预设</span><div><button type="button" class="primary" id="bundle-confirm" disabled>确认四项预设</button><a id="bundle-go-feed" href="#feed" hidden>去送料 →</a></div></div></section>`;
const bundleFields=[['tape_width_mm','铜带宽度 / mm'],['overlap_width_mm','搭盖宽度基准 / mm'],['wire_gap_mm','铜丝间隙基准 / mm'],['diameter_x_mm','A原始圆直径 / mm'],['b_x_mm','B X直径 / mm'],['b_y_mm','B Y直径 / mm（选填）'],['meter_delay_ms','计米器输出 / ms'],['tape_diameter','铜带工序直径 / mm'],['wire_diameter','铜丝工序直径 / mm'],['tape_pitch','铜带周期节距 / mm'],['wire_pitch','铜丝周期节距 / mm'],['extrusion_pitch','测径波动周期长度 / mm']];
const bundleGroups=[['金属屏蔽搭盖率','铜带工序',['tape_diameter','tape_width_mm','overlap_width_mm','tape_pitch']],['铜丝屏蔽间隙','铜丝工序',['wire_diameter','wire_gap_mm','wire_pitch']],['圆整度 + 护套厚度','双测径 · 同源计算',['diameter_x_mm','b_x_mm','b_y_mm','meter_delay_ms','extrusion_pitch']]];
$('bundle-inputs').innerHTML=bundleGroups.map(([title,subtitle,fields])=>`<section class="preset-process"><h3>${title}</h3><p class="small muted">${subtitle}</p><div>${fields.map(k=>`<label>${bundleFields.find(v=>v[0]===k)[1]}<input id="bundle-${k}" type="number" min="0" step="${k==='meter_delay_ms'?'1':'0.000001'}" placeholder="按工序填写"></label>`).join('')}</div></section>`).join('');
function invalidateBundle(){bundlePreview=null;bundleRequest=null;$('bundle-confirm').disabled=true;$('bundle-charts').innerHTML='<div class="preset-empty">尚未生成预览，请选择一个档位。</div>';$('bundle-generation-details').hidden=true;$('bundle-go-feed').hidden=true;$('bundle-save-hint').textContent='当前没有待确认的预设';$('bundle-status').textContent='参数已变化，请重新选择档位生成。';}
function readBundle(){
 const c=models.cables.find(c=>c.id===$('bundle-cable').value),d=models.detectors.filter(d=>d.data.metric==='OVALITY').length===1?models.detectors.find(d=>d.data.metric==='OVALITY'):null;
 if(!c){invalidateBundle();$('bundle-length').value='';for(const [k] of bundleFields)$('bundle-'+k).value='';$('bundle-status').textContent='请先选择线缆。';return;}
 $('bundle-length').value=String(c.data.length_m||'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');$('bundle-selection').textContent=c.data.name+' · '+(c.source?.specification_code||'')+' · 基准版本 '+c.version;
 const values={...c.data.baseline,...(d?{b_x_mm:d.data.b_x_mm,b_y_mm:d.data.b_y_mm,meter_delay_ms:d.data.meter_delay_ms}:{})};
 for(const [k] of bundleFields)$('bundle-'+k).value=values[k]??'';
 invalidateBundle();$('bundle-status').textContent='已读取已有基准，请补齐各工序直径与周期长度，再选档位。';
}
$('bundle-read').onclick=readBundle;$('bundle-cable').addEventListener('change',readBundle);
$('bundle-inputs').addEventListener('input',invalidateBundle);
for(const id of ['bundle-cable','bundle-length','bundle-speed','bundle-interval'])$(id).addEventListener('input',invalidateBundle);
function bundleInput(grade){
 const v=k=>$('bundle-'+k).value;
 for(const [k,l] of bundleFields)if(k!=='b_y_mm'&&!v(k))throw Error('请填写'+l);
 return {grade,length_m:$('bundle-length').value,speed_m_min:$('bundle-speed').value,sampling_interval_ms:Number($('bundle-interval').value),inputs:Object.fromEntries(['tape_width_mm','overlap_width_mm','wire_gap_mm','diameter_x_mm','diameter_y_mm','b_x_mm','b_y_mm','meter_delay_ms'].map(k=>[k,v(k==='diameter_y_mm'?'diameter_x_mm':k)])),diameters:{SHIELD_OVERLAP_RATE:Number(v('tape_diameter')),WIRE_GAP:Number(v('wire_diameter')),OVALITY:Number(v('diameter_x_mm'))},pitches:{SHIELD_OVERLAP_RATE:Number(v('tape_pitch')),WIRE_GAP:Number(v('wire_pitch')),OVALITY:Number(v('extrusion_pitch'))}};
}
function bundleIdentity(grade){return JSON.stringify({cable:$('bundle-cable').value,input:bundleInput(grade)});}
function bundleChart(title,rows,key,unit){
 const values=rows.map(p=>p[key]),lo=Math.min(...values),hi=Math.max(...values),pad=Math.max((hi-lo)*.1,.000001),min=lo-pad,max=hi+pad;
 const points=values.map((v,i)=>(55+500*i/Math.max(1,rows.length-1)).toFixed(2)+','+(160-120*(v-min)/(max-min)).toFixed(2)).join(' ');
 return `<section class="spec-instrument"><h3>${title}</h3><svg viewBox="0 0 600 195" role="img" aria-label="${title}时间趋势"><path d="M55 30V160H560" stroke="#c4d3e4" fill="none"/><text x="3" y="35" font-size="11">${hi.toFixed(4)}</text><text x="3" y="160" font-size="11">${lo.toFixed(4)}</text><polyline points="${points}" fill="none" stroke="#2163c4" stroke-width="1.3"/><text x="55" y="183" font-size="12">0 ms</text><text x="450" y="183" font-size="12">${rows.at(-1).elapsed_ms} ms</text></svg><p class="small">最小 ${lo.toFixed(6)} · 最大 ${hi.toFixed(6)} ${unit}；完整原始生成点</p></section>`;
}
bundleBox.querySelectorAll('[data-grade]').forEach(button=>button.onclick=async()=>{
 if(bundleBusy)return;bundleBusy=true;lockBundle(true);invalidateBundle();const grade=Number(button.dataset.grade);
 try{
  const c=models.cables.find(c=>c.id===$('bundle-cable').value);if(!c)throw Error('请先选择线缆');
  const input=bundleInput(grade),signature=bundleIdentity(grade);$('bundle-status').textContent='正在生成四项预设…';
  const previews=await api('/specifications/bundle-preview',input);
  if(signature!==bundleIdentity(grade)){invalidateBundle();return;}
  bundlePreview={grade,previews,cable:c.id,version:c.version};bundleSignature=signature;
  $('bundle-status').textContent=['轻微','明显','严重'][grade-1]+'预设已生成，请查看四项曲线后确认。';$('bundle-generation-details').hidden=false;$('bundle-generation-info').textContent=previews.map(p=>(labels[p.data.metric]||p.data.metric)+'：区段占比'+p.data.anomaly_probability_pct.toFixed(2)+'%，幅度'+p.data.anomaly_pct.toFixed(2)+'%，种子'+p.data.seed).join('；');
  $('bundle-charts').innerHTML=previews.map(p=>bundleChart(labels[p.data.metric],p.points,'metric_value',p.data.metric==='WIRE_GAP'?'mm':p.data.metric==='OVALITY'?'比值':'%')).join('')+bundleChart('护套厚度（A均径−B均径）',previews[2].points,'sheath_mm','mm');
  if(previews.some(p=>p.clipped))$('bundle-status').textContent+=' 部分读数受几何/仪器范围限制，请核对尺寸。';
  $('bundle-confirm').disabled=false;$('bundle-save-hint').textContent='待确认：'+c.data.name;
 }catch(e){$('bundle-status').textContent=e.message;}finally{bundleBusy=false;lockBundle(false);}
});
$('bundle-confirm').onclick=async()=>{
 if(bundleBusy||!bundlePreview)return;const p=bundlePreview;
 try{if(bundleIdentity(p.grade)!==bundleSignature){invalidateBundle();return;}
 bundleBusy=true;lockBundle(true);$('bundle-confirm').disabled=true;
 bundleRequest??={request_id:crypto.randomUUID(),cable_id:p.cable,cable_version:p.version,items:p.previews.map(v=>({data:v.data,hash:v.hash})),reason:'确认四项工序随机预设：'+['轻微','明显','严重'][p.grade-1]};
 await api('/specifications/bundle-confirm',bundleRequest);
 $('bundle-status').textContent='四项预设已一起保存，下一次送料生效。可到送料页按对应任务开始；当前运行和历史不变。';
 bundlePreview=null;bundleRequest=null;$('bundle-save-hint').textContent='已保存，下一次送料生效';$('bundle-go-feed').hidden=false;await refreshModels();
 }catch(e){$('bundle-status').textContent=e.message;$('bundle-confirm').disabled=false;}finally{bundleBusy=false;lockBundle(false);}
};

function refreshBundleChoices(){const select=$('bundle-cable'),prior=select.value;select.innerHTML='<option value="">请选择线缆</option>'+models.cables.map(c=>`<option value="${escape(c.id)}">${escape(c.data.name)} · ${escape(c.source?.specification_code||'')}</option>`).join('');if(models.cables.some(c=>c.id===prior))select.value=prior;else if(prior){invalidateBundle();$('bundle-selection').textContent='原线缆已不在当前目录，请重新选择。';}}
const bundleBaseRefresh=refreshModels;refreshModels=async function(){await bundleBaseRefresh();refreshBundleChoices();};refreshBundleChoices();
