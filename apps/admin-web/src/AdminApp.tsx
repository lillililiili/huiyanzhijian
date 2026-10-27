import {useEffect,useMemo,useState,useSyncExternalStore} from 'react';
import {AppShell} from '../../web/src/app/shell/AppShell';
import {LoginPage} from '../../web/src/app/shell/LoginPage';
import {currentHash,parseHash,subscribeHash,navigate} from '../../web/src/app/hashRoute';
import {ApiClient,ApiError,Commands,type Person} from '../../web/src/shared/api';
import {useRead} from '../../web/src/shared/useRead';
import {AdminPreferences} from '../../web/src/shared/preferences';
import {useSessionWatch} from '../../web/src/shared/useSessionWatch';
import {Note} from '../../web/src/ui/Note';
import {ToastViewport} from '../../web/src/ui/Toast';
import {AdminUsers,AdminSettings,AdminEvents} from './AdminPages';

export function AdminApp(){
  const api=useMemo(()=>{const client=new ApiClient();client.guardSession=true;return client;},[]);
  const commands=useMemo(()=>new Commands(api),[api]);
  const hash=useSyncExternalStore(subscribeHash,currentHash,()=> '#settings');
  const parsed=useMemo(()=>parseHash(hash),[hash]);
  const [user,setUser]=useState<Person|null>(null),[checking,setChecking]=useState(true),[error,setError]=useState(''),[tick,setTick]=useState(0);
  const settings=useRead<any>(api,user?'/admin/settings':null,tick+':'+user?.id);
  api.onExpired=()=>{setUser(null);api.csrf='';};
  useSessionWatch(api,Boolean(user),()=>setTick(n=>n+1));
  useEffect(()=>{let active=true;api.request<{user:Person;csrf_token:string}>('/auth/me').then(r=>{if(active)setUser(r.user);}).catch(e=>{if(active&&(!(e instanceof ApiError)||e.status!==401))setError(e.message);}).finally(()=>{if(active)setChecking(false);});return()=>{active=false;};},[api]);
  useEffect(()=>{const changed=()=>setTick(n=>n+1);window.addEventListener('huiyan-settings-changed',changed);return()=>window.removeEventListener('huiyan-settings-changed',changed);},[]);
  useEffect(()=>{document.title='慧眼智检 · 管理后台';},[]);
  if(checking)return <div className="shell-proof">正在验证管理后台会话…</div>;
  if(!user)return <><LoginPage applicationName="管理后台" authenticate={async(username,password)=>{const r=await api.request<{user:Person;csrf_token:string}>('/auth/login',{username,password});setUser(r.user);setError('');if(parsed.route==='login')navigate('settings');}}/>{error&&<Note>{error}</Note>}<ToastViewport/></>;
  const route=['users','audit','settings'].includes(parsed.route)?parsed.route:'settings';
  const session={...user,role:user.permissions.includes('users:manage')?'admin' as const:user.permissions.includes('task:write')?'quality' as const:'viewer' as const};
  const props={api,commands,user,params:parsed.params};
  return <><AppShell application="admin" session={session} parsed={{...parsed,route}} state={{alarms:[],settings:{platformName:'管理后台',demoTime:new Date().toLocaleString('zh-CN',{hour12:false}),organization:settings.value?.platform?.organization_name}}} connectionLabel="独立管理后台 · 共用平台API" alarmsAvailable={false} onLogout={async()=>{try{await api.request('/auth/logout',{});api.onExpired();navigate('login');}catch(e){setError((e as Error).message);}}}>
    {error&&<Note><span role="alert">{error}</span></Note>}
    <AdminPreferences.Provider value={{pageSize:settings.value?.personal?.page_size||settings.value?.platform?.default_page_size||20,density:settings.value?.personal?.density||'comfortable'}}><div className={settings.value?.personal?.density==='compact'?'live-page-content admin-compact':'live-page-content'} key={parsed.raw}>{route==='users'?<AdminUsers {...props}/>:route==='audit'?<AdminEvents {...props}/>:<AdminSettings {...props}/>}</div></AdminPreferences.Provider>
  </AppShell><ToastViewport/></>;
}
