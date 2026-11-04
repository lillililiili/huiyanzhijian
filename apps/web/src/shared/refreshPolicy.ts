/** Business reads pause in hidden tabs; session/security checks are independent. */
export function startVisiblePolling(read:()=>void|Promise<void>,delay:number){
 let stopped=false,pending=false,timer:ReturnType<typeof setTimeout>|undefined;
 const schedule=()=>{if(!stopped)timer=setTimeout(()=>void tick(),delay);};
 const tick=async()=>{
  if(stopped||pending)return;
  if(document.visibilityState==='hidden'){schedule();return;}
  pending=true;try{await read();}finally{pending=false;schedule();}
 };
 const visible=()=>{if(document.visibilityState!=='hidden'&&!pending){clearTimeout(timer);void tick();}};
 document.addEventListener('visibilitychange',visible);schedule();
 return()=>{stopped=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
}
export function watchesTask(state:string|undefined){return state==='CREATED'||state==='RUNNING';}
