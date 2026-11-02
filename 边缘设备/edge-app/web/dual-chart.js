// Operator visibility preferences affect display only, never persisted readings.
const GAUGE_LINES = [
 {id:'ax',name:'A · X直径',color:'#D5AD4F',gauge:'A',key:'x'},
 {id:'ay',name:'A · Y直径',color:'#719FE0',gauge:'A',key:'y'},
 {id:'amean',name:'A · 平均直径',color:'#69AC86',gauge:'A',key:'mean'},
 {id:'ratio',name:'A · 圆整度',color:'#A47BD2',gauge:'A',key:'ratio',axis:1},
 {id:'bx',name:'B · X直径',color:'#A5BC50',gauge:'B',key:'x',dash:true},
 {id:'by',name:'B · Y直径',color:'#53B9C5',gauge:'B',key:'y',dash:true},
 {id:'sheath',name:'护套厚度',color:'#DF8875',key:'sheath'},
];
let visibleLines={};
try { visibleLines=JSON.parse(localStorage.getItem('huiyan-gauge-lines-v1')||'{}')||{}; } catch {}
let mainChartRows=[], historyChartRows=[];
function gaugeOf(row){return row.gauge||'A'}
function axialMean(row){return row.mean??(row.valid&&row.x!=null?(row.y==null?row.x:(row.x+row.y)/2):null)}
function lineMatches(row,line){return line.id==='sheath'?gaugeOf(row)===(row.sheath?.upstreamGauge==='A'?'B':'A'):gaugeOf(row)===line.gauge}
function lineValue(row,line){
 if(!lineMatches(row,line)||!row.valid)return null;
 if(line.id==='sheath'){const p=row.sheath;return p?.status==='TIME_COMPENSATED'&&Number.isFinite(p.value)?p.value:null;}
 return line.key==='mean'?axialMean(row):row[line.key]??null;
}
function linesFor(rows){return GAUGE_LINES.filter(line=>rows.some(row=>lineValue(row,line)!=null))}
function updateLegend(container,rows,onToggle){
 const available=linesFor(rows), key=available.map(x=>x.id).join(',');
 if(container.dataset.lines!==key){
  container.replaceChildren();container.dataset.lines=key;
  for(const line of available){
   const b=document.createElement('button');b.type='button';b.className='legend-button';b.dataset.line=line.id;
   const dot=document.createElement('span');dot.className='legend-stroke'+(line.dash?' dashed':'');dot.style.setProperty('--series',line.color);
   const name=document.createElement('span');name.textContent=line.name;b.append(dot,name);
   b.onclick=()=>{visibleLines[line.id]=visibleLines[line.id]===false;try{localStorage.setItem('huiyan-gauge-lines-v1',JSON.stringify(visibleLines))}catch{};onToggle()};container.append(b);
  }
 }
 container.querySelectorAll('button').forEach(b=>{const on=visibleLines[b.dataset.line]!==false;b.classList.toggle('muted',!on);b.setAttribute('aria-pressed',String(on));b.title=on?'点击隐藏此曲线':'点击显示此曲线'});
}

// Display-only affine scales: stored values and quality decisions remain untouched.
function scaleGroup(line){return line.id==='ratio'?'ratio':line.id==='sheath'?'sheath':'diameter'}
function realText(value,group){return Number.isFinite(value)?Number(value.toFixed(group==='ratio'?7:6)).toString()+(group==='ratio'?'':' mm'):'—'}

function tightScale(values,group){
 if(!values.length)return {min:0,max:1,step:.25,present:false};
 let low=Infinity,high=-Infinity;for(const v of values){low=Math.min(low,v);high=Math.max(high,v);}
 const span=Math.max(high-low,group==='ratio'?.00001:.0001),padding=span*.12;
 const rough=(span+2*padding)/5,power=10**Math.floor(Math.log10(rough));
 const step=[1,2,2.5,5,10].find(n=>n*power>=rough)*power;
 let min=Math.floor((low-padding)/step)*step,max=Math.ceil((high+padding)/step)*step;
 if(group==='ratio'){min=Math.max(0,min);max=Math.min(1,max);}
 return {min,max,step,present:true};
}
function tickPrecision(step){return Math.min(7,Math.max(0,Math.ceil(-Math.log10(step))+1))}
function tickText(value,precision){return (Math.abs(value)<10**(-precision)/2?0:value).toFixed(precision)}
const focusReferences={live:{key:'',values:{}},history:{key:'',values:{}}};
function chartView(rows,lower,realtime){
 const available=linesFor(rows),active=available.filter(l=>visibleLines[l.id]!==false);
 const groups=[...new Set(active.map(scaleGroup))],focus=groups.length===1;
 const values={},groupValues={diameter:[],sheath:[],ratio:[]};
 for(const line of active){
  values[line.id]=[];
  for(const row of rows){const v=lineValue(row,line);if(Number.isFinite(v)){values[line.id].push(v);groupValues[scaleGroup(line)].push(v);}}
 }
 const scales={};for(const group of Object.keys(groupValues))scales[group]=tightScale(groupValues[group],group);
 if(!focus&&scales.ratio.present){
  const s=scales.ratio;let low=s.min;if(Number.isFinite(lower))low=Math.min(low,lower);
  scales.ratio={...s,min:Math.max(0,Math.floor((low-.01)*100)/100),max:1};
 }
 let deviation=false,baselines={},axis=focus?scales[groups[0]]:{min:0,max:100,step:25};
 if(focus&&groups[0]==='diameter'&&active.length>1){
  let largestSpan=.0001;
  for(const line of active){let low=Infinity,high=-Infinity;for(const v of values[line.id]){low=Math.min(low,v);high=Math.max(high,v);}largestSpan=Math.max(largestSpan,high-low);}
  deviation=axis.max-axis.min>largestSpan*4;
 }
 const cache=focusReferences[realtime?'live':'history'];
 if(deviation){
  const context=realtime?(typeof state==='undefined'?'':state?.run?.id||''):(typeof historyRun==='undefined'?'':historyRun);
  const key=context+'|'+active.map(l=>l.id).join(',');
  if(cache.key!==key){cache.key=key;cache.values={};for(const line of active)cache.values[line.id]=values[line.id][0];}
  baselines=cache.values;const deltas=[];
  for(const line of active)for(const v of values[line.id])deltas.push(v-baselines[line.id]);
  axis=tightScale(deltas,'diameter');
 }else {cache.key='';cache.values={};}
 return {available,active,groups,focus,scales,axis,deviation,baselines};
}
function scalePosition(value,scale){return Number.isFinite(value)?(value-scale.min)/(scale.max-scale.min)*100:null}
function chartOption(rows,lower,realtime=true){
 const view=chartView(rows,lower,realtime),{available,active,groups,focus,scales,axis,deviation,baselines}=view;
 const narrow=window.innerWidth<800,fontSize=narrow?10:12,precision=focus?tickPrecision(axis.step):0;
 const groupName={diameter:'直径',sheath:'护套厚度',ratio:'圆整度'};
 const axisName=!focus?'量程位置 / %':deviation?'相对基准变化 / mm':groupName[groups[0]]+(groups[0]==='ratio'?'':' / mm');
 const project=(v,line)=>!Number.isFinite(v)?null:deviation?v-baselines[line.id]:focus?v:scalePosition(v,scales[scaleGroup(line)]);
 const ratioInRange=v=>scales.ratio.present&&Number.isFinite(v)&&v>=scales.ratio.min&&v<=scales.ratio.max;
 const series=available.map(line=>({
  id:line.id,name:line.name,type:'line',yAxisIndex:0,showSymbol:false,connectNulls:false,
  lineStyle:{width:line.id==='ratio'||line.id==='sheath'?3:2.5,color:line.color,type:line.dash?'dashed':'solid'},itemStyle:{color:line.color},
  dimensions:['time','position','reading'],encode:{x:'time',y:'position'},
  data:visibleLines[line.id]===false?[]:rows.filter(row=>lineMatches(row,line)).map(row=>{const v=lineValue(row,line);return [new Date(row.at).getTime(),project(v,line),v]}),
  markLine:line.id==='ratio'&&visibleLines.ratio!==false&&ratioInRange(lower)?{silent:true,symbol:'none',lineStyle:{color:'#B18F5A',type:'dashed',width:1},label:{formatter:'圆整度下限 '+lower,fontSize,position:'insideStartTop'},data:[{yAxis:project(lower,line)}]}:undefined,
 }));
 if(ratioInRange(1))series.push({id:'standard-circle-reference',name:'标准圆参考',type:'line',silent:true,showSymbol:false,data:[],tooltip:{show:false},markLine:{silent:true,symbol:'none',animation:false,lineStyle:{color:'#BDA6D7',type:'dotted',width:1},label:{formatter:'圆整度 1 = 标准圆',position:'insideEndBottom',color:'#9271B3',fontSize},data:[{yAxis:focus?1:100}]}});
 const graphic=[];let top=72;
 const label=(text,left,y,color='#53657C')=>({type:'text',left,top:y,silent:true,style:{text,fill:color,fontSize,fontFamily:'Microsoft YaHei, sans-serif',lineHeight:17}});
 if(focus){
  graphic.push(label((deviation?'波动放大 · 各线减去基准':'精细量程 · '+groupName[groups[0]])+'\n'+tickText(axis.min,precision)+' → '+tickText(axis.max,precision)+(groups[0]==='ratio'?'':' mm'),narrow?'2%':'5%',4));
  if(deviation){
   const columns=narrow?2:3;
   active.forEach((line,i)=>graphic.push(label(line.name+' 基准 '+realText(baselines[line.id],'diameter'),(3+(i%columns)*(94/columns))+'%',42+Math.floor(i/columns)*17,line.color)));
   top+=Math.ceil(active.length/columns)*17;
  }else if(groups[0]==='ratio'){
   const refs=[];if(!ratioInRange(1))refs.push('标准圆 1（当前量程外）');
   if(Number.isFinite(lower)&&!ratioInRange(lower))refs.push('判定下限 '+lower+'（当前量程外）');
   if(refs.length)graphic.push(label(refs.join('\n'),'55%',4,'#8B63B8'));
  }
 }else{
  groups.forEach((key,i)=>{const s=scales[key];graphic.push(label(groupName[key]+'量程\n'+realText(s.min,key)+' → '+realText(s.max,key),(5+i*92/groups.length)+'%',4,key==='sheath'?'#BE6958':key==='ratio'?'#8B63B8':'#53657C'));});
  if(!groups.length)graphic.push(label(available.length?'全部曲线已隐藏 · 点击图例恢复显示':'等待有效测径数据','center',4));
 }
 if(realtime){
  if(trendCaption)trendCaption.textContent='最近 60 秒 · '+(deviation?'波动放大 · 悬停看真实直径':focus?'精细量程 · 随可见曲线缩放':'独立量程叠加 · 悬停查看实值');
  if(trendHint){trendHint.textContent=deviation?'基准固定 · 点击图例调整':focus?'真实值坐标 · 点击图例调整':'量程位置 / % · 点击图例显隐';trendHint.title=deviation?'纵轴为各线减去标注基准后的变化量；基准在当前盘和图例选择内固定，悬停显示真实直径。':focus?'只按当前显示曲线的有效值收紧量程，隐藏曲线不影响缩放。':'各类读数按可见数据分别缩放，百分比是量程位置，交点不表示真实数值相等。';}
 }
 return {animation:false,textStyle:{fontFamily:'Noto Sans CJK SC, Microsoft YaHei, sans-serif'},graphic,
  grid:{left:narrow?70:90,right:narrow?16:26,top,bottom:narrow?29:35},
  tooltip:{trigger:'axis',confine:true,renderMode:'richText',axisPointer:{type:'line'},formatter:params=>{
   const points=params.filter(p=>Array.isArray(p.data)&&Number.isFinite(p.data[2]));if(!points.length)return '';
   return time(points[0].data[0],true)+'\n'+points.map(p=>{const line=GAUGE_LINES.find(l=>l.id===p.seriesId);return p.seriesName+'   '+realText(p.data[2],line?scaleGroup(line):'diameter')+(deviation?'  （变化 '+tickText(p.data[1],precision)+' mm）':'')}).join('\n');
  }},
  xAxis:{type:'time',min:realtime?Date.now()-60000:null,max:realtime?Date.now():null,splitNumber:5,axisLabel:{fontSize,color:'#63738A',formatter:v=>time(v),hideOverlap:true},axisLine:{lineStyle:{color:'#C9D5E3'}},splitLine:{show:true,lineStyle:{type:'dashed',color:'#E7EDF4'}}},
  yAxis:{type:'value',name:axisName,min:axis.min,max:axis.max,interval:axis.step,nameTextStyle:{fontSize,color:'#53657C'},axisLabel:{fontSize,color:'#63738A',formatter:v=>focus?tickText(v,precision):v+'%'},splitLine:{lineStyle:{type:'dashed',color:'#E0E8F1'}}},series,
 };
}
const trendCaption=document.querySelector('.chart-panel .panel-heading>div>span');
const trendHint=document.querySelector('.legend-hint');
