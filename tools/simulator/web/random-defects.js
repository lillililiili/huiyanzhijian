/* Seeded spatial presets: no sampling-time randomness, replay remains stable. */
(function(root){
function generateRandomDefects({length,count,seed,metric,baseline,existing=[],minLength,maxLength,strength}){
 if(!Number.isFinite(length)||length<=0||!Number.isInteger(count)||count<1||existing.length+count>20)throw Error('线长必须大于0，新增后最多20段');
 if(!Number.isInteger(seed)||seed<0||seed>999999999)throw Error('种子必须为0至999999999的整数');
 if(!Number.isFinite(minLength)||!Number.isFinite(maxLength)||minLength<0.000001||maxLength<minLength||maxLength>length)throw Error('请检查最短/最长区段，不能超过线长');
 if(!Number.isFinite(strength)||strength<=0||strength>50)throw Error('峰值变化幅度应大于0且不超过50%');
 for(const v of Object.values(baseline))if(!Number.isFinite(Number(v))||Number(v)<0||Number(v)>1000)throw Error('请先填写有效正常基准参数');
 if(Number(baseline.diameter_x_mm)<=0||Number(baseline.diameter_y_mm)<=0||Number(baseline.tape_width_mm)<=0)throw Error('基准直径及带宽必须大于0');
 let state=seed>>>0;const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const kinds=['SHIELD_OVERLAP_RATE','WIRE_GAP','OVALITY'];if(metric!=='ALL'&&!kinds.includes(metric))throw Error('检测项无效');
 const result=[];const dec=n=>n.toFixed(6);
 for(let i=0;i<count;i++){
  const m=metric==='ALL'?kinds[i%3]:metric;let slot=null;
  for(let attempt=0;attempt<300;attempt++){
   const size=Number(dec(minLength+random()*(maxLength-minLength))),start=Number(dec(random()*(length-size)));
   if(size>0&&start+size<=length+1e-9&&![...existing,...result].some(d=>d.metric===m&&start<Number(d.start_m)+Number(d.length_m)&&start+size>Number(d.start_m))){slot={start,size};break;}
  }
  if(!slot)throw Error('没有足够的不重叠空间，请减少数量或区段长度；原草稿未改动');
  const amplitude=strength/100*(0.5+random()*0.5);
  const field=m==='SHIELD_OVERLAP_RATE'?'overlap_width_mm':m==='WIRE_GAP'?'wire_gap_mm':'diameter_y_mm';
  const base=Number(baseline[field]);const peak=m==='SHIELD_OVERLAP_RATE'?base*(1-amplitude):base*(1+amplitude);
  if(peak>1000)throw Error('生成峰值超过1000mm，请降低幅度');
  result.push({name:'随机波动 '+(existing.length+i+1)+' · 种子'+seed,metric:m,start_m:dec(slot.start),length_m:dec(slot.size),value_mm:dec(peak),profile:{kind:'SMOOTH',seed:String(Math.floor(random()*999999999)),ripple_pct:'12'}});
 }
 return result;
}
root.generateRandomDefects=generateRandomDefects;
if(typeof module!=='undefined')module.exports={generateRandomDefects};
})(globalThis);
