import {type Recipe,type Device,ruleText} from './api';
export const metricUnits:Record<string,string>={SHIELD_OVERLAP_RATE:'%',WIRE_GAP:'mm',OVALITY:'%'};
export function availableRecipes(recipes:Recipe[],device:Device,specificationId:string){
 return recipes.filter(r=>r.enabled!==false&&r.metric_code===device.metric_code&&(r.approval_state==='APPROVED'||r.approval_state==='TEST_ONLY'&&device.data_environment==='SIMULATED')&&(!r.specification_ids?.length||r.specification_ids.includes(specificationId)));
}
export function recipeLabel(r:Recipe){return `${r.name||r.id} · ${r.revision} · ${ruleText(r.rule_snapshot).replace(/ · [^·]+$/,'')} ${r.unit||metricUnits[r.metric_code]}`;}
