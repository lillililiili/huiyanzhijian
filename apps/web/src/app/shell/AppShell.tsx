import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { roleBadge } from "../../auth/permissions";
import { setSessionUser } from "../../auth/session";
import type { AppState, SessionUser } from "../../domain/types";
import type { InspectionStore } from "../../domain/store";
import { applicationUrl } from "../../shared/applicationLinks";
import { Button } from "../../ui/Button";
import { Drawer } from "../../ui/Drawer";
import { HashLink } from "../../ui/HashLink";
import { Icon } from "../../ui/Icon";
import { Note } from "../../ui/Note";
import { trapFocus, visibleFocusables } from "../../ui/focusTrap";
import { breadcrumbTitle, navigate, type ParsedHash } from "../hashRoute";
import { groupActive, groupByKey, groupsForRoute, linkActive, navEntries, businessNavEntries, pendingBusinessRoutes, reservedBusinessRoutes, subActive } from "../nav";

class PageBoundary extends Component<{ resetKey: string; children: ReactNode }, { message: string }> {
  state = { message: "" };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "页面加载失败" };
  }

  componentDidUpdate(previous: { resetKey: string }) {
    if (previous.resetKey !== this.props.resetKey && this.state.message) this.setState({ message: "" });
  }

  render() {
    if (!this.state.message) return this.props.children;
    return (
      <>
        <h1>页面加载失败</h1>
        <p>{this.state.message}</p>
        <Button onClick={() => this.setState({ message: "" })}>重新加载</Button>
      </>
    );
  }
}

function setInert(element: HTMLElement | null, hidden: boolean) {
  if (!element) return;
  element.inert = hidden;
  if (!hidden) element.removeAttribute("inert");
}

function applyNavVisibility(mobile: boolean, open: boolean) {
  const sidebar = document.getElementById("primary-navigation");
  const shell = document.querySelector<HTMLElement>(".app-shell");
  const hidden = mobile && !open;
  setInert(sidebar, hidden);
  if (sidebar) sidebar.setAttribute("aria-hidden", String(hidden));
  setInert(shell, mobile && open);
  document.body.classList.toggle("nav-open", mobile && open);
}

export function AppShell({ store, session, state, parsed, children, onLogout, connectionLabel, alarmsAvailable=true, application }: { store?: InspectionStore; session: SessionUser; state: { alarms: AppState["alarms"]; settings: Partial<AppState["settings"]> }; parsed: ParsedHash; children?: ReactNode; onLogout?: () => Promise<void>; connectionLabel?:string; alarmsAvailable?:boolean; application?: "business" | "admin" }) {
  const [mobile, setMobile] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [openedFor, setOpenedFor] = useState(parsed.route);
  const [opened, setOpened] = useState(() => groupsForRoute(parsed.route));
  const mobileOpenRef = useRef(false);
  const mobileRef = useRef(false);
  const seenRaw = useRef(parsed.raw);
  const pendingGroupFocus = useRef<string | null>(null);
  mobileOpenRef.current = mobileOpen;
  mobileRef.current = mobile;

  if (openedFor !== parsed.route) {
    setOpenedFor(parsed.route);
    setOpened(groupsForRoute(parsed.route));
  }

  useEffect(() => {
    const media = window.matchMedia("(max-width: 1023px)");
    function onChange() {
      const sidebar = document.getElementById("primary-navigation");
      const menu = document.querySelector<HTMLElement>(".mobile-menu");
      const active = document.activeElement;
      const moveFocus = Boolean(sidebar?.contains(active) || active === menu);
      const matches = media.matches;
      setMobile(matches);
      setMobileOpen(false);
      mobileRef.current = matches;
      mobileOpenRef.current = false;
      applyNavVisibility(matches, false);
      if (!moveFocus) return;
      const target = matches
        ? menu
        : sidebar?.querySelector<HTMLElement>(".nav-item.active, .subnav a.active") ?? (sidebar ? visibleFocusables(sidebar)[0] : null);
      target?.focus({ preventScroll: true });
    }
    onChange();
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyNavVisibility(mobile, mobileOpen);
  }, [mobile, mobileOpen]);

  useEffect(() => {
    if (seenRaw.current === parsed.raw) return;
    seenRaw.current = parsed.raw;
    window.scrollTo(0, 0);
    setAccountOpen(false);
    if (!mobileOpenRef.current) return;
    mobileOpenRef.current = false;
    setMobileOpen(false);
    applyNavVisibility(mobileRef.current, false);
    document.getElementById("main-content")?.focus({ preventScroll: true });
  }, [parsed.raw]);

  useEffect(() => {
    const key = pendingGroupFocus.current;
    if (!key) return;
    pendingGroupFocus.current = null;
    document.querySelector<HTMLElement>(`[data-nav-group][data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  }, [opened]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const dialog = document.querySelector(".modal, .drawer");
      if (dialog) return;
      if (event.key === "Escape" && mobileRef.current && mobileOpenRef.current) {
        event.preventDefault();
        mobileOpenRef.current = false;
        setMobileOpen(false);
        applyNavVisibility(true, false);
        document.querySelector<HTMLElement>(".mobile-menu")?.focus({ preventScroll: true });
        return;
      }
      if (event.key === "Tab" && mobileRef.current && mobileOpenRef.current) {
        trapFocus(event, document.getElementById("primary-navigation"));
      }
    }
    function onClick(event: MouseEvent) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href^='#']");
      if (!link) return;
      setAccountOpen(false);
      if (!mobileOpenRef.current) return;
      if (link.getAttribute("href") === window.location.hash) {
        mobileOpenRef.current = false;
        setMobileOpen(false);
        applyNavVisibility(mobileRef.current, false);
        document.getElementById("main-content")?.focus({ preventScroll: true });
      }
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onClick);
    };
  }, []);

  function openNavigation() {
    setMobileOpen(true);
    mobileOpenRef.current = true;
    applyNavVisibility(true, true);
    const sidebar = document.getElementById("primary-navigation");
    const initial = sidebar?.querySelector<HTMLElement>(".nav-item.active, .subnav a.active")
      ?? (sidebar ? visibleFocusables(sidebar)[0] : null)
      ?? sidebar;
    initial?.focus({ preventScroll: true });
  }

  function toggleNavigation() {
    if (!mobileRef.current) return;
    if (mobileOpenRef.current) {
      mobileOpenRef.current = false;
      setMobileOpen(false);
      applyNavVisibility(true, false);
      document.querySelector<HTMLElement>(".mobile-menu")?.focus({ preventScroll: true });
      return;
    }
    openNavigation();
  }

  function toggleGroup(key: string) {
    pendingGroupFocus.current = key;
    setOpened(current => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function logout() {
    if (onLogout) { await onLogout(); return; }
    if (!store) return;
    store.setSession(session);
    store.log("退出登录", "退出本地演示会话");
    store.setSession(null);
    setSessionUser(null);
    setAccountOpen(false);
    navigate("login");
  }

  const alarmCount = state.alarms.filter(alarm => alarm.status !== "resolved").length;
  const [roleLabel, roleTone] = roleBadge(session.role);
  const organization = state.settings.organization || state.settings.company || "山东沉积岩信息科技有限公司";
  const navOpen = mobile && mobileOpen;

  return (
    <div className="app">
      <button className="mobile-backdrop" type="button" aria-label="关闭导航" tabIndex={-1} onClick={() => { mobileOpenRef.current = false; setMobileOpen(false); applyNavVisibility(mobile, false); }} />
      <aside id="primary-navigation" className="sidebar" aria-label="主导航" tabIndex={-1} aria-hidden={mobile && !navOpen}>
        <button className="icon-button mobile-nav-close" type="button" aria-label="关闭主导航" onClick={() => { mobileOpenRef.current = false; setMobileOpen(false); applyNavVisibility(true, false); document.querySelector<HTMLElement>(".mobile-menu")?.focus({ preventScroll: true }); }}>
          <Icon name="x" />
        </button>
        <HashLink route={application === "admin" ? "settings" : "dashboard"}>
          <img className="sidebar-logo" src="assets/images/logo.png" alt="慧眼智检 AI线缆智能检测装备" width={204} height={68} />
        </HashLink>
        <div className="sidebar-platform">{state.settings.platformName || "线缆质量管控平台"}</div>
        <nav className="nav-scroll">
          {application === "admin" && <>
            {[["users","用户角色与权限","user"],["audit","操作审计","clipboard"],["audit?view=logs","运行日志","history"],["audit?view=diagnostics","采集诊断","connect"],["settings","系统设置","settings"]].map(([route,label,icon])=><HashLink key={route} route={route} className={parsed.route+(parsed.params.get('view')?'?view='+parsed.params.get('view'):'')===route?'nav-item active':'nav-item'}><Icon name={icon}/><span>{label}</span></HashLink>)}
            <a className="nav-item" href={applicationUrl('business','dashboard')}><Icon name="home"/><span>返回业务平台</span></a>
          </>}
          {(application === "admin" ? [] : application === "business" ? businessNavEntries : navEntries).map(entry => {
            if(application === "business" && entry.type === "group" && entry.key === "system") return <a className="nav-item" key="admin" href={applicationUrl('admin','settings')}><Icon name="settings"/><span>管理后台</span></a>;
            if (entry.type === "link") {
              if(entry.route==="workorders"&&!onLogout)return null;
              const active = linkActive(entry.route, parsed.route);
              return (
                <HashLink key={entry.route} route={entry.route} className={active ? "nav-item active" : "nav-item"}>
                  <Icon name={entry.icon} />
                  <span>{entry.label}</span>{application === "business" && pendingBusinessRoutes.has(entry.route) && <small className="ux-nav-status">待开放</small>}
                </HashLink>
              );
            }
            const group = groupByKey(entry.key);
            const open = opened.has(group.key);
            const active = groupActive(group, parsed.route) && !(application === "business" && parsed.route === "trace");
            return (
              <div key={group.key}>
                <button type="button" className={active ? "nav-item group-open" : "nav-item"} data-nav-group="" data-key={group.key} aria-expanded={open} onClick={() => toggleGroup(group.key)}>
                  <Icon name={group.icon} />
                  <span>{application === "business" && group.key === "data" ? "历史数据" : group.label}</span>
                  <Icon name={open ? "chevron-down" : "chevron-right"} size={13} />
                </button>
                {open ? (
                  <div className="subnav">
                    {group.items.filter(([route])=>!(application === "business" && route === "trace")).map(([route, label]) => (
                      <HashLink key={route} route={route} className={subActive(route, parsed.route, parsed.params) ? "active" : undefined}>{label}{application === "business" && pendingBusinessRoutes.has(route) && <small className="ux-nav-status">待开放</small>}{application === "business" && reservedBusinessRoutes.has(route) && <small className="ux-nav-status">预留</small>}</HashLink>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-bottom">
          <strong>慧眼智检 · 质见未来</strong>
          <div className="voltage">35–220kV 高压电缆</div>
          <div>聚焦三项关键量测指标</div>
          <div>{organization}</div>
        </div>
      </aside>
      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button className="icon-button mobile-menu" type="button" aria-label={navOpen ? "收起导航" : "展开导航"} aria-expanded={navOpen} aria-controls="primary-navigation" onClick={toggleNavigation}>
              <Icon name="menu" />
            </button>
            <Icon name="home" size={15} />
            <span>慧眼智检</span>
            <span>/</span>
            <strong>{breadcrumbTitle(parsed.route, parsed.params)}</strong>
          </div>
          <div className="top-tools">
            <HashLink route={application === "business" ? "monitor" : "settings"} className="demo-pill">{connectionLabel || (onLogout ? "平台连接待确认" : "演示数据 · 非现场实测")}</HashLink>
            <span className="demo-time">{state.settings.demoTime || "2026-10-09 14:30:00"}</span>
            {application !== "admin" && <button className="bellbox" type="button" aria-label={alarmsAvailable?"查看待复核报警":"查看检测超限记录"} title={alarmsAvailable?"查看待复核报警":"查看检测超限记录"} onClick={() => navigate("alarms")}>
              <Icon name="bell" />
              {alarmCount ? <em>{alarmCount}</em> : null}
            </button>}
            <button className="avatar" type="button" aria-label="当前账户与退出登录" onClick={() => setAccountOpen(true)}>
              <span><Icon name="user" size={19} /></span>
              {session.name}
              <Icon name="down" size={12} />
            </button>
          </div>
        </header>
        <main id="main-content" className={`page page-${parsed.route}`} tabIndex={-1}>
          <PageBoundary resetKey={parsed.raw}>
            {children}
          </PageBoundary>
        </main>
      </div>
      <Drawer title="当前账户" open={accountOpen} onClose={() => setAccountOpen(false)}>
        <div className="row">
          <span className="kpi-icon"><Icon name="user" size={27} /></span>
          <div>
            <h2>{session.name}</h2>
            <p className="muted">{session.username || "演示账号"}</p>
          </div>
        </div>
        <span className={`badge ${roleTone}`}>{roleLabel}</span>
        <Note>{onLogout ? "会话与操作权限由平台服务端验证。" : "当前会话仅用于本地原型的操作权限演示。"}</Note>
        <Button icon="logout" onClick={logout}>退出登录</Button>
      </Drawer>
    </div>
  );
}
