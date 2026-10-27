import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { Alarm, InspectionRecord } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { DataTable } from "../../ui/DataTable";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Kpi } from "../../ui/Kpi";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Pagination, usePagination } from "../../ui/Pagination";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { date, metricFmt, ruleLabel } from "../../ui/format";

const METRIC_OPTIONS = [["", "全部三项检测"], ...Object.values(METRICS).map(metric => [metric.id, metric.short || metric.name] as const)] as const;

function filteredAlarms(alarms: readonly Alarm[], records: readonly InspectionRecord[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return alarms.filter(alarm => {
    const record = records.find(item => item.id === alarm.recordId);
    const activeOk = !filters.active || ((filters.active === "active") === !!alarm.active);
    const text = [alarm.id, alarm.taskId, record?.reelId, record?.workOrder].join(" ").toLowerCase();
    return (!filters.metric || alarm.metric === filters.metric)
      && (!filters.status || alarm.status === filters.status)
      && activeOk
      && (!keyword || text.includes(keyword));
  }).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function AlarmsPage({ store }: { store: InspectionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.alarms ?? {};
  const rows = filteredAlarms(state.alarms, state.records, filters);
  const page = usePagination(rows, "alarms", 8, state.settings.pageSize);
  const pending = state.alarms.filter(alarm => alarm.status === "pending").length;
  const processing = state.alarms.filter(alarm => alarm.status === "processing").length;
  const resolved = state.alarms.filter(alarm => alarm.status === "resolved").length;

  return (
    <>
      <PageTitle title="报警事件" subtitle="保留过程超限证据；数值恢复、人工复核与 MES 接收状态分别记录。" />
      <div className="grid cols-4">
        <Kpi label="过程超限事件" value={state.alarms.length} note="所有报警原始记录保留" icon="bell" />
        <Kpi label="待人工复核" value={pending} note="当前值恢复不自动关闭事件" icon="alert-triangle" tone="red" />
        <Kpi label="正在处理" value={processing} note="处理过程可追溯" icon="clock" tone="amber" />
        <Kpi label="已完成处置" value={resolved} note="处置记录与原始量测分别保存" icon="shield-check" tone="green" />
      </div>
      <FilterForm id="alarms">
        {current => (
          <>
            <Field label="盘号 / 工单">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入盘号、工单或报警编号" />
            </Field>
            <Field label="检测项目">
              <Select name="metric" value={current.metric || ""} options={METRIC_OPTIONS} />
            </Field>
            <Field label="处理状态">
              <Select
                name="status"
                value={current.status || ""}
                options={[["", "全部状态"], ["pending", "待复核"], ["processing", "处理中"], ["resolved", "已处理"]]}
              />
            </Field>
            <Field label="数值状态">
              <Select
                name="active"
                value={current.active || ""}
                options={[["", "全部"], ["active", "仍超限"], ["recovered", "已恢复"]]}
              />
            </Field>
          </>
        )}
      </FilterForm>
      <Panel core table={page.items.length > 0} title="报警记录" tools={<span className="muted small">共 {rows.length} 条事件</span>}>
        <DataTable
          headers={["报警时间", "关联对象", "检测项目", "事件值 / 控制阈值", "数值状态", "处置状态", "操作"]}
          rows={page.items.map(alarm => {
            const metric = METRICS[alarm.metric];
            const record = state.records.find(item => item.id === alarm.recordId);
            return [
              date(alarm.createdAt),
              <>
                <HashLink route={`trace?reel=${encodeURIComponent(record?.reelId || "")}`}>{record?.reelId || alarm.taskId}</HashLink>
                <div className="small muted">{alarm.id}</div>
              </>,
              metric.name,
              <>
                <strong className="text-red">{metricFmt(record?.value, alarm.metric, state.settings.metricDisplay)} {metric.unit}</strong>
                <div className="small muted">{ruleLabel(metric, record?.ruleSnapshot)}</div>
              </>,
              <Badge tone={alarm.active ? "red" : "green"}>{alarm.active ? "仍超限" : "已恢复"}</Badge>,
              <StatusBadge value={alarm.status} kind="alarm" />,
              <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>查看与处置</HashLink>
            ];
          })}
        />
        <Pagination pageKey="alarms" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note>数值恢复仅说明后续采样恢复阈值内。原始超限记录不会被覆盖，处理结论须由质量人员复核。</Note>
    </>
  );
}
