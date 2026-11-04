import {type Recipe,type Device,ruleText} from './api';
export const metricUnits:Record<string,string>={SHIELD_OVERLAP_RATE:'%',WIRE_GAP:'mm',OVALITY:'%',SHEATH_THICKNESS:'mm'};
export function availableRecipes(recipes:Recipe[],device:Device,specificationId:string){
 return recipes.filter(r=>r.enabled!==false&&r.metric_code===device.metric_code&&(r.approval_state==='APPROVED'||r.approval_state==='TEST_ONLY'&&device.data_environment==='SIMULATED')&&(!r.specification_ids?.length||r.specification_ids.includes(specificationId)));
}
export function recipeLabel(r:Recipe){return `${r.name||r.id} · ${r.revision} · ${ruleText(r.rule_snapshot).replace(/ · [^·]+$/,'')} ${r.unit||metricUnits[r.metric_code]}`;}

export function sheathMinimum(nominal:string){
 if(!/^\d{1,12}(\.\d{1,8})?$/.test(nominal))return '';
 const [whole,fraction='']=nominal.split('.');
 const n=(BigInt(whole)*100000000n+BigInt(fraction.padEnd(8,'0')))*95n;
 return `${n/10000000000n}.${String(n%10000000000n).padStart(10,'0')}`;
}
