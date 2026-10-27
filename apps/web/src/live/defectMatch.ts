import type {Measurement,Rule,Task} from './api';

export const metricIllustrations:Record<string,{name:string;direction:'LOW'|'HIGH';unit:string}>={
 SHIELD_OVERLAP_RATE:{name:'搭盖率偏低',direction:'LOW',unit:'%'},
 WIRE_GAP:{name:'铜丝间隙偏大',direction:'HIGH',unit:'mm'},
 OVALITY:{name:'不圆度偏大',direction:'HIGH',unit:'%'}
};
// Matching for display only; never reclassifies the server's quality result.
export function compareDecimal(a:string|null|undefined,b:string|null|undefined):number|null {
 if(typeof a!=='string'||typeof b!=='string'||[a,b].some(x=>x.length>128||!/^[-+]?\d+(\.\d+)?$/.test(x)))return null;
 const scale=Math.max(a.split('.')[1]?.length||0,b.split('.')[1]?.length||0);
 const fixed=(x:string)=>{const sign=x.startsWith('-')?-1n:1n;const [i,f='']=x.replace(/^[-+]/,'').split('.');return sign*BigInt(i+f.padEnd(scale,'0'));};
 const x=fixed(a),y=fixed(b);return x<y?-1:x>y?1:0;
}
export function ruleDirection(value:string|null,rule?:Rule):'LOW'|'HIGH'|null {
 const c=rule?.comparison;if(!c||!['APPROVED','TEST_ONLY'].includes(rule!.approval_state))return null;
 if(c.operator==='GE')return compareDecimal(value,c.lower)===-1?'LOW':null;
 if(c.operator==='LE')return compareDecimal(value,c.upper)===1?'HIGH':null;
 if(c.operator==='BETWEEN'){
  const bounds=compareDecimal(c.lower,c.upper);if(bounds===null||bounds>0)return null;
  if(compareDecimal(value,c.lower)===-1)return 'LOW';
  if(compareDecimal(value,c.upper)===1)return 'HIGH';
 }
 return null;
}
export function matchDefect(record:Measurement,task?:Task):{name?:string;direction?:'LOW'|'HIGH';reason:string} {
 if(!task)return {reason:'缺少任务及冻结规则，不能匹配图片。'};
 if(record.raw_payload.task_id!==task.id||record.metric_code!==task.metric_code)return {reason:'记录与任务的检测项或标识不一致，未匹配图片。'};
 if(record.quality_result!=='FAIL'||record.raw_payload.data_status!=='VALID'||record.receipt_status!=='STORED')return {reason:'仅对有效、已存储的超限记录匹配图片。'};
 const asset=metricIllustrations[record.metric_code];if(!asset)return {reason:'此检测项不属于当前三项范围。'};
 if(record.unit!==asset.unit)return {reason:'记录单位与当前接入契约不一致，未匹配图片。'};
 const direction=ruleDirection(record.value,task.rule_snapshot);
 if(!direction)return {reason:'记录与任务规则无法确认超限方向，未匹配图片。'};
 if(direction!==asset.direction)return {direction,name:({SHIELD_OVERLAP_RATE:'搭盖率',WIRE_GAP:'铜丝间隙',OVALITY:'不圆度'}[record.metric_code]||record.metric_code)+(direction==='LOW'?'偏低':'偏高'),reason:'按本条实际超限方向绘图，不使用相反方向图片。'};
 return {name:asset.name,direction,reason:'根据本条超限记录的检测项及任务冻结规则匹配'};
}
