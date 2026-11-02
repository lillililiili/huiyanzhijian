type FilterOption = {value:string; label:string; tone?:'fail'|'pass'; count?:number};

/** Detection record filters share placement, selected state and keyboard behavior. */
export function RecordFilterSwitch({label,value,options,disabled,onChange}:{label:string;value:string;options:FilterOption[];disabled?:boolean;onChange:(value:string)=>void}) {
 return <div className="review-filter-switch" role="group" aria-label={label}>
  {options.map(option=><button key={option.value} type="button" className={option.tone?`filter-${option.tone}`:undefined} aria-pressed={value===option.value} disabled={disabled} onClick={()=>onChange(option.value)}>
   {option.tone&&<i className={`filter-dot is-${option.tone}`}/>}{option.label}
   {option.count!==undefined&&option.count>0&&<span className="filter-count">{option.count}</span>}
  </button>)}
 </div>;
}
