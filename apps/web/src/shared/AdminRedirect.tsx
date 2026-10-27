import {useEffect} from 'react';
import {applicationUrl} from './applicationLinks';
import {Note} from '../ui/Note';

export function AdminRedirect({route,params}:{route:string;params:URLSearchParams}) {
  const query=params.toString(), href=applicationUrl('admin',route+(query?'?'+query:''));
  useEffect(()=>{window.location.replace(href);},[href]);
  return <Note>管理功能已迁移至独立管理后台。<a href={href}>进入管理后台</a></Note>;
}
