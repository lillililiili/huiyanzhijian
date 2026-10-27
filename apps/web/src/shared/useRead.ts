import {useEffect,useState} from 'react';
import type {ApiClient} from './api';
export function useRead<T>(api:ApiClient,path:string|null,revision:unknown){
 const [value,setValue]=useState<T|null>(null),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();let active=true;setValue(null);setError('');
  if(path)api.request<T>(path,undefined,{},controller.signal).then(v=>{if(active){setValue(v);setError('');}}).catch(e=>{if(active&&!controller.signal.aborted)setError(e.message);});
  return()=>{active=false;controller.abort();};
 },[api,path,revision]);return {value,error};
}
