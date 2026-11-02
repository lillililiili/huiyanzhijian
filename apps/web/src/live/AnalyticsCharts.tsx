import {useEffect,useRef} from 'react';
import * as echarts from 'echarts';
import type {EChartsOption} from 'echarts';
import type {Task} from './api';
import {labelTime} from './api';
import {analyticsMetrics,resultColors,resultNames,summarizeTasks} from './analyticsData';

export function AnalyticsChart({option,label,height=260}:{option:EChartsOption;label:string;height?:number}){
  const host=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    if(!host.current)return;
    const chart=echarts.init(host.current,undefined,{renderer:'svg'});
    chart.setOption(option);
    const resize=()=>chart.resize();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);
    observer?.observe(host.current);window.addEventListener('resize',resize);
    return()=>{observer?.disconnect();window.removeEventListener('resize',resize);chart.dispose();};
  },[option]);
  return <div ref={host} role="img" aria-label={label} style={{height,width:'100%'}}/>;
}
export function distributionOption(tasks:Task[]):EChartsOption{
  const s=summarizeTasks(tasks);
  return {animation:false,color:resultColors,tooltip:{trigger:'item',formatter:'{b}<br/>{c} 条 · {d}%'},
    series:[{type:'pie',radius:['66%','84%'],center:['50%','50%'],avoidLabelOverlap:true,label:{show:false},
      itemStyle:{borderColor:'#fff',borderWidth:4,borderRadius:6},data:[s.passed,s.failed,s.pending].map((value,i)=>({name:resultNames[i],value}))}]};
}
export function comparisonOption(tasks:Task[]):EChartsOption{
  const summaries=analyticsMetrics.map(m=>summarizeTasks(tasks.filter(t=>t.metric_code===m.code)));
  return {animation:false,color:resultColors,tooltip:{trigger:'axis',axisPointer:{type:'shadow'}},legend:{bottom:0,icon:'circle',itemWidth:8,textStyle:{color:'#71829b'}},
    grid:{left:18,right:18,top:30,bottom:42,containLabel:true},xAxis:{type:'category',data:analyticsMetrics.map(m=>m.short),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:'#526582',margin:14}},
    yAxis:{type:'value',minInterval:1,name:'采样记录 / 条',nameTextStyle:{color:'#8998ae'},splitLine:{lineStyle:{color:'#edf1f7',type:'dashed'}}},
    series:(['passed','failed','pending'] as const).map((key,i)=>({name:resultNames[i],type:'bar',stack:'quality',barMaxWidth:48,data:summaries.map(s=>s[key])}))};
}
export function trendTasks(tasks:Task[],metric:string){
  return tasks.filter(t=>t.metric_code===metric&&t.measurements?.latest_sample_at&&t.measurements?.mean!=null&&Number.isFinite(Number(t.measurements.mean)))
    .sort((a,b)=>Date.parse(a.measurements!.latest_sample_at!)-Date.parse(b.measurements!.latest_sample_at!)||a.id.localeCompare(b.id));
}
export function trendOption(tasks:Task[],metric:string):EChartsOption{
  const rows=trendTasks(tasks,metric),meta=analyticsMetrics.find(m=>m.code===metric)!;
  return {animation:false,color:[meta.color],tooltip:{trigger:'axis',renderMode:'richText',formatter:(p:any)=>{
    const t=rows[p?.[0]?.dataIndex];if(!t)return '';
    return `${t.task_code}\n${labelTime(t.measurements!.latest_sample_at)}\n任务均值 ${t.measurements!.mean} ${meta.unit}\n超限 ${t.measurements!.failed} 条 · 未判定 ${t.measurements!.unevaluated} 条`;
  }},grid:{left:18,right:24,top:26,bottom:68,containLabel:true},
    xAxis:{type:'category',boundaryGap:false,data:rows.map(t=>labelTime(t.measurements!.latest_sample_at).replace(/ 北京时间$/,'').slice(5,16)),axisLine:{lineStyle:{color:'#dce5f0'}},axisTick:{show:false},axisLabel:{color:'#8290a6',hideOverlap:true}},
    yAxis:{type:'value',name:meta.unit,scale:true,splitLine:{lineStyle:{color:'#eaf0f7',type:'dashed'}},axisLabel:{color:'#8290a6'}},
    dataZoom:[{type:'inside'},{type:'slider',height:18,bottom:4,borderColor:'#e4ebf4',fillerColor:'#2468cc18',showDetail:false}],
    series:[{name:'任务均值',type:'line',smooth:false,showSymbol:true,symbolSize:7,lineStyle:{width:2.5},itemStyle:{borderColor:'#fff',borderWidth:2},areaStyle:{color:{type:'linear',x:0,y:0,x2:0,y2:1,colorStops:[{offset:0,color:meta.color+'38'},{offset:1,color:meta.color+'03'}]}},data:rows.map(t=>Number(t.measurements!.mean))}]};
}
