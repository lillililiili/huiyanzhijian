import {useEffect,useRef} from 'react';
import type {ApiClient} from './api';

/** Ports share host cookies. Recheck on return and periodically; never replay mutations. */
export function useSessionWatch(api:ApiClient,enabled:boolean,onChecked:()=>void){
  const callback=useRef(onChecked);callback.current=onChecked;
  useEffect(()=>{
    if(!enabled)return;
    let pending=false,active=true;
    const check=async()=>{if(pending)return;pending=true;try{await api.checkSession();if(active)callback.current();}catch{/* transport failures remain recoverable; 401 / identity change expires UI */}finally{pending=false;}};
    const visible=()=>{if(document.visibilityState==='visible')void check();};
    window.addEventListener('focus',visible);document.addEventListener('visibilitychange',visible);
    const timer=setInterval(()=>void check(),15000);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',visible);document.removeEventListener('visibilitychange',visible);};
  },[api,enabled]);
}
