import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { InspectionRecord, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
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
import { toast } from "../../ui/Toast";
import { date, metricFmt } from "../../ui/format";

const METRIC_OPTIONS = [["", "全部三项检测"], ...Object.values(METRICS).map(metric => [metric.id, metric.short] as const)] as const;

function filteredSync(records: readonly InspectionRecord[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return records.filter(record => {
    const text = [record.id, record.taskId, record.reelId].join(" ").toLowerCase();
    return (!filters.status || record.mesStatus === filters.status)
      && (!filters.metric || record.metric === filters.metric)
      && (!keyword || text.includes(keyword));
  }).sort((left, right) => String(right.time).localeCompare(String(left.time)));
}

export function SyncPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.sync ?? {};
  const rows = filteredSync(state.records, filters);
  const page = usePagination(rows, "sync", 8, state.settings.pageSize);
  const received = state.records.filter(record => record.platformStatus === "received").length;
  const confirmed = state.records.filter(record => record.mesStatus === "confirmed").length;
  const pending = state.records.filter(record => record.mesStatus === "pending").length;
  const failed = state.records.filter(record => record.mesStatus === "failed").length;

  function retry(ids: string[]) {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    if (store.getState().mes.enabled === false) {
      toast("MES 同步演示已停用，请先在接口配置中启用。");
      return;
    }
    if (!ids.length) {
      toast("筛选范围内没有待重试记录。");
      return;
    }
    const result = store.retrySync(ids);
    toast(`模拟重试完成：确认 ${result.count || 0} 条，失败 ${result.failed || 0} 条，待同步 ${result.pending || 0} 条。`);
  }

  function retryFiltered() {
    const current = getViewSnapshot().filters.sync ?? {};
    const ids = filteredSync(store.getState().records, current)
      .filter(record => record.mesStatus !== "confirmed")
      .map(record => record.id);
    retry(ids);
  }

  return (
    <>
      <PageTitle
        title="MES 同步监控"
        subtitle="逐条追踪平台接收、推送与确认，失败记录支持幂等重试。"
        actions={<Button primary icon="refresh" onClick={retryFiltered}>重试筛选内未确认记录</Button>}
      />
      <div className="grid cols-4">
        <Kpi label="平台接收" value={received} note="平台端已接收记录" icon="database" />
        <Kpi label="MES 已确认" value={confirmed} note="已确认记录重试不会重复写入" icon="cloud-check" tone="green" />
        <Kpi label="待同步" value={pending} note="保留业务对象关联" icon="clock" tone="amber" />
        <Kpi label="同步失败" value={failed} note="可手动执行模拟重试" icon="alert-triangle" tone="red" />
      </div>
      <FilterForm id="sync">
        {current => (
          <>
            <Field label="记录 / 任务 / 盘号">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入记录编号、任务或盘号" />
            </Field>
            <Field label="检测项目">
              <Select name="metric" value={current.metric || ""} options={METRIC_OPTIONS} />
            </Field>
            <Field label="MES 状态">
              <Select
                name="status"
                value={current.status || ""}
                options={[["", "全部状态"], ["confirmed", "已确认"], ["pending", "待同步"], ["failed", "同步失败"]]}
              />
            </Field>
          </>
        )}
      </FilterForm>
      <Panel core table={page.items.length > 0} title="同步记录" tools={<span className="muted small">{rows.length} 条记录</span>}>
        <DataTable
          headers={["记录编号 / 时间", "任务 / 盘号", "检测项目", "实测值", "平台接收", "MES 状态", "确认时间", "操作"]}
          rows={page.items.map(record => {
            const metric = METRICS[record.metric];
            const receivedRow = record.platformStatus === "received";
            return [
              <>
                {record.id}
                <div className="small muted">{date(record.time)}</div>
              </>,
              <>
                <HashLink route={`task?id=${encodeURIComponent(record.taskId)}`}>{record.taskId}</HashLink>
                <div className="small muted">{record.reelId}</div>
              </>,
              metric.short,
              `${metricFmt(record.value, record.metric, state.settings.metricDisplay)} ${metric.unit}`,
              <Badge tone={receivedRow ? "blue" : "gray"}>{receivedRow ? "已接收" : "待接收"}</Badge>,
              <StatusBadge value={record.mesStatus} kind="mes" />,
              date(record.confirmedAt),
              record.mesStatus !== "confirmed"
                ? <Button icon="refresh" onClick={() => retry([record.id])}>重试</Button>
                : <span className="small muted">已确认</span>
            ];
          })}
        />
        <Pagination pageKey="sync" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note>重试只更新同步状态，不会改变原始量测值、数据有效性、规则快照或报警处理状态。</Note>
    </>
  );
}
