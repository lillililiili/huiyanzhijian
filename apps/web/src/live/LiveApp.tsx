import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AppShell } from "../app/shell/AppShell";
import { LoginPage } from "../app/shell/LoginPage";
import { currentHash, documentTitle, navigate, parseHash, subscribeHash } from "../app/hashRoute";
import { Note } from "../ui/Note";
import { Button } from "../ui/Button";
import { ToastViewport } from "../ui/Toast";
import { ApiClient, ApiError, Commands, emptyWorkspace, type Person, type Workspace, type Catalog, type Task, type WorkOrder, type Spool, type DeviceStatus } from "./api";
import './ux02.css';
import { LivePages } from "./LivePages";
import {AdminPreferences} from '../shared/preferences';
import {useRead} from '../shared/useRead';
import {useSessionWatch} from '../shared/useSessionWatch';
import {AdminRedirect} from '../shared/AdminRedirect';

export function LiveApp() {
  const api = useMemo(() => {const client=new ApiClient();client.guardSession=true;return client;}, []);
  const commands = useMemo(() => new Commands(api), [api]);
  const hash = useSyncExternalStore(subscribeHash, currentHash, () => "#login");
  const parsed = useMemo(() => parseHash(hash), [hash]);
  const [user, setUser] = useState<Person | null>(null);
  const [checking, setChecking] = useState(true);
  const [data, setData] = useState<Workspace>(emptyWorkspace);
  const [workspaceStatus,setWorkspaceStatus]=useState<"loading"|"ready"|"failed">("loading");
  const [connection,setConnection]=useState("正在读取平台状态");
  const [error, setError] = useState("");
  const [settingsTick,setSettingsTick]=useState(0);
  const settings=useRead<any>(api,user?'/admin/settings':null,settingsTick+':'+user?.id);
  useEffect(()=>{const changed=()=>setSettingsTick(n=>n+1);window.addEventListener('huiyan-settings-changed',changed);return()=>window.removeEventListener('huiyan-settings-changed',changed);},[]);
  const generation = useRef(0), loading = useRef(false);
  const target = useRef(parsed.route === "login" ? "tasks" : parsed.raw);
  const clear = useCallback(() => { generation.current++; setUser(null); setData(emptyWorkspace); setWorkspaceStatus("loading"); api.csrf = ""; }, [api]);
  api.onExpired = clear;
  useSessionWatch(api,Boolean(user),()=>setSettingsTick(n=>n+1));
  const listOnly=["users","settings","audit","workorders","monitor","devices","metrics","recipes","specs"].includes(parsed.route)||(parsed.route==='trace'&&!parsed.params.get('spool'))||(parsed.route==='tasks'&&!parsed.params.get('plan')&&parsed.params.get('view')!=='auto')||(parsed.route==='detection'&&!parsed.params.get('task'));
  const refresh = useCallback(async (forceWorkspace=false):Promise<void> => {
    if (loading.current) { if(forceWorkspace){await new Promise(r=>setTimeout(r,100));return refresh(true);} return; }
    loading.current = true; const gen = generation.current;
    try {
      const [catalog, tasks, spools, orders, devices, health] = await Promise.all([
        api.request<Catalog>("/catalog"), !listOnly||forceWorkspace?api.all<Task>("/tasks"):Promise.resolve(null), !listOnly||forceWorkspace?api.all<Spool>("/spools"):Promise.resolve(null), !listOnly||forceWorkspace?api.all<WorkOrder>("/work-orders"):Promise.resolve(null), api.request<DeviceStatus[]>("/device-status"),api.request<{database:string;analysis_worker:{healthy:boolean}}>("/health/ready")
      ]);
      if (gen === generation.current) { if(tasks && spools && orders)setWorkspaceStatus("ready"); setData(previous=>({catalog,tasks:tasks||previous.tasks,spools:spools||previous.spools,orders:orders||previous.orders,devices})); setError("");setConnection(health.database==="UP"&&health.analysis_worker.healthy?"平台与数据库正常 · 来源见任务":"平台部分服务异常"); }
    } catch (e) { if (gen === generation.current) {setError(e instanceof Error ? e.message : "刷新失败");setWorkspaceStatus(s=>s==="ready"?s:"failed");} if(forceWorkspace)throw e; }
    finally { loading.current = false; }
  }, [api,listOnly]);
  useEffect(() => {
    let disposed = false;
    api.request<{user: Person; csrf_token: string}>("/auth/me").then(result => { if (!disposed) { api.csrf = result.csrf_token; setUser(result.user); } }).catch(e => { if (!disposed && (!(e instanceof ApiError) || e.status !== 401)) setError(e.message); }).finally(() => { if (!disposed) setChecking(false); });
    return () => { disposed = true; };
  }, [api]);
  useEffect(() => { if (!user) return; void refresh(); const timer = setInterval(() => void refresh(), 5000); return () => clearInterval(timer); }, [user, refresh]);
  useEffect(() => { document.title = documentTitle(parsed.route); if (user && parsed.route === "login") navigate(target.current); }, [parsed.route, user]);
  if (['users','audit','settings'].includes(parsed.route)) return <AdminRedirect route={parsed.route} params={parsed.params}/>;
  if (checking) return <div className="shell-proof"><h1>慧眼智检</h1><p>正在验证平台会话…</p></div>;
  if (!user) return <><LoginPage authenticate={async (username, password) => {
    const result = await api.request<{user: Person; csrf_token: string}>("/auth/login", { username, password });
    generation.current++; api.csrf = result.csrf_token; setUser(result.user); setError(""); navigate(target.current);
  }} />{error && <Note>{error}</Note>}<ToastViewport /></>;
  const session = { ...user, role: user.permissions.includes("audit:read") ? "admin" as const : user.permissions.includes("task:write") ? "quality" as const : "viewer" as const };
  return <><AppShell application="business" session={session} state={{ alarms: [], settings: { platformName: settings.value?.platform?.platform_name||"线缆质量管控平台", demoTime: new Date().toLocaleString("zh-CN", { hour12: false }) } }} parsed={parsed} connectionLabel={error?"平台刷新失败 · 显示上次数据":connection} alarmsAvailable={false} onLogout={async () => {
    try { await api.request("/auth/logout", {}); clear(); navigate("login"); }
    catch (e) { setError(e instanceof Error ? e.message : "退出失败，请重试"); }
  }}>
    {error && <Note><span role="alert">刷新失败，当前显示上次数据：{error}</span> <Button onClick={() => void refresh()}>重试</Button></Note>}
    {settings.error&&<Note>显示偏好读取失败，暂用默认显示：{settings.error}</Note>}
    <AdminPreferences.Provider value={{pageSize:settings.value?.personal?.page_size||settings.value?.platform?.default_page_size||20,density:settings.value?.personal?.density||'comfortable'}}><div className={settings.value?.personal?.density==='compact'?'live-page-content admin-compact':'live-page-content'}><LivePages workspaceStatus={workspaceStatus} key={parsed.raw} route={parsed.route} params={parsed.params} api={api} commands={commands} user={user} data={data} refresh={refresh} prepareForms={()=>refresh(true)} /></div></AdminPreferences.Provider>
  </AppShell><ToastViewport /></>;
}

