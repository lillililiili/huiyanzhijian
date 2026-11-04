import {expect,test} from 'vitest';
import {sheathMinimum,availableRecipes} from '../live/recipeOptions';
import {measurementJudgment,type Measurement,type Recipe} from '../live/api';
import {sheathChartRows} from '../live/sheathDisplay';
import {distributionOption,comparisonOption} from '../live/AnalyticsCharts';
test('95% standard is computed with exact decimal strings including small values',()=>{
 expect(sheathMinimum('3')).toBe('2.8500000000');expect(sheathMinimum('5')).toBe('4.7500000000');expect(sheathMinimum('0.00000001')).toBe('0.0000000095');expect(sheathMinimum('1.23456789')).toBe('1.1728394955');
 for(const s of ['-3','NaN','Infinity','1e3','3.000000001',''])expect(sheathMinimum(s)).toBe('');
});
test('record judgment describes validity/rule problems without invented pass or generic category',()=>{
 const row={receipt_status:'STORED',raw_payload:{data_status:'VALID'},quality_result:'NOT_EVALUATED',evaluation_reason:'RULE_MISSING'} as Measurement;
 expect(measurementJudgment(row)).toBe('任务未配置判定标准');expect(measurementJudgment({...row,quality_result:'PASS'})).toBe('符合当前规则');expect(measurementJudgment({...row,raw_payload:{...row.raw_payload,data_status:'MISSING'}})).toBe('缺测');expect(measurementJudgment({...row,receipt_status:'QUARANTINED'})).toBe('隔离记录');
});
test('sheath chart uses its own verdict and cannot borrow an ovality failure',()=>{
 const row={metric_code:'SHEATH_THICKNESS',quality_result:'FAIL',receipt_status:'STORED',raw_payload:{data_status:'VALID'},sheath_result:{status:'VERIFIED',unit:'mm',value:'2.84'}} as Measurement;
 expect(sheathChartRows([row])[0].quality_result).toBe('FAIL');expect(sheathChartRows([{...row,metric_code:'OVALITY'}])[0].quality_result).toBe('NOT_EVALUATED');
});
test('quality charts expose only pass/fail series',()=>{
 expect((distributionOption([]).series as any[])[0].data.map((d:any)=>d.name)).toEqual(['符合规则','超限']);expect((comparisonOption([]).series as any[]).map(s=>s.name)).toEqual(['符合规则','超限']);
});
test('sheath recipe selector enforces selected specification and enabled version',()=>{
 const recipe={id:'s1',enabled:true,metric_code:'SHEATH_THICKNESS',approval_state:'TEST_ONLY',specification_ids:['spec1']} as Recipe;
 const device={metric_code:'SHEATH_THICKNESS',data_environment:'SIMULATED'} as any;
 expect(availableRecipes([recipe],device,'spec1')).toHaveLength(1);expect(availableRecipes([recipe],device,'spec2')).toHaveLength(0);expect(availableRecipes([{...recipe,enabled:false}],device,'spec1')).toHaveLength(0);
});
