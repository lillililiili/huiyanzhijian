import type { ReactNode } from "react";
import type { InspectionStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { HashLink } from "../ui/HashLink";
import { AlarmPage } from "./alarms/AlarmPage";
import { AlarmsPage } from "./alarms/AlarmsPage";
import { AnalyticsPage } from "./analytics/AnalyticsPage";
import { DashboardPage } from "./dashboard/DashboardPage";
import { DetectionPage } from "./detection/DetectionPage";
import { HistoryPage } from "./history/HistoryPage";
import { MetricsPage } from "./metrics/MetricsPage";
import { MonitorPage } from "./monitor/MonitorPage";
import { RecipesPage } from "./recipes/RecipesPage";
import { ReportPage } from "./reports/ReportPage";
import { ReportsPage } from "./reports/ReportsPage";
import { SpecsPage } from "./specs/SpecsPage";
import { TaskPage } from "./tasks/TaskPage";
import { TasksPage } from "./tasks/TasksPage";
import { TemplatesPage } from "./templates/TemplatesPage";
import { TracePage } from "./trace/TracePage";
import { ConnectionsPage } from "./connections/ConnectionsPage";
import { DevicesPage } from "./devices/DevicesPage";
import { MesPage } from "./mes/MesPage";
import { SyncPage } from "./sync/SyncPage";
import { AuditPage } from "./audit/AuditPage";
import { SettingsPage } from "./settings/SettingsPage";
import { UsersPage } from "./users/UsersPage";

/** Route body lookup. PR 12 replaces users, audit and settings. */
export function renderPage(route: string, params: URLSearchParams, store: InspectionStore, user: SessionUser): ReactNode {
  if (route === "dashboard") return <DashboardPage store={store} user={user} />;
  if (route === "monitor") return <MonitorPage store={store} />;
  if (route === "detection") return <DetectionPage store={store} user={user} params={params} />;
  if (route === "tasks") return <TasksPage store={store} user={user} />;
  if (route === "task") return <TaskPage store={store} user={user} params={params} />;
  if (route === "specs") return <SpecsPage store={store} user={user} params={params} />;
  if (route === "history") return <HistoryPage store={store} user={user} params={params} />;
  if (route === "trace") return <TracePage store={store} user={user} params={params} />;
  if (route === "alarms") return <AlarmsPage store={store} />;
  if (route === "alarm") return <AlarmPage store={store} user={user} params={params} />;
  if (route === "analytics") return <AnalyticsPage store={store} />;
  if (route === "reports") return <ReportsPage store={store} user={user} />;
  if (route === "report") return <ReportPage store={store} params={params} />;
  if (route === "metrics") return <MetricsPage store={store} user={user} />;
  if (route === "recipes") return <RecipesPage store={store} user={user} params={params} />;
  if (route === "templates") return <TemplatesPage store={store} user={user} />;
  if (route === "devices") return <DevicesPage store={store} user={user} />;
  if (route === "connections") return <ConnectionsPage store={store} user={user} />;
  if (route === "mes") return <MesPage store={store} user={user} />;
  if (route === "sync") return <SyncPage store={store} user={user} />;
  if (route === "users") return <UsersPage store={store} user={user} />;
  if (route === "audit") return <AuditPage store={store} user={user} />;
  if (route === "settings") return <SettingsPage store={store} user={user} />;
  return <UnknownPage />;
}

function UnknownPage() {
  return (
    <>
      <h1>页面不存在</h1>
      <p>请选择左侧导航继续浏览</p>
      <HashLink route="dashboard">返回工作台</HashLink>
    </>
  );
}
