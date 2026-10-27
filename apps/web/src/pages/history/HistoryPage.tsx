import { useEffect, useState } from "react";
import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { filterHistoryRecords, resolveHistoryFilter } from "../../domain/historyQuery";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, SessionUser } from "../../domain/types";
import { Button } from "../../ui/Button";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { Kpi } from "../../ui/Kpi";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { Pagination, usePagination } from "../../ui/Pagination";
import { RecordDrawer } from "../../ui/RecordDrawer";
import { toast } from "../../ui/Toast";
import { downloadRecords } from "../../ui/download";
import { fmt } from "../../ui/format";
import { HistoryRecordTable, MetricMiniCard } from "./historyView";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];

export function HistoryPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const written = view.filters.history;
  const resolved = resolveHistoryFilter(written, params.get("metric"), state.settings.demoTime);
  const rows = filterHistoryRecords(state.records, resolved);
  const summary = store.stats(rows);
  const page = usePagination(rows, "history", 8, state.settings.pageSize);
  const confirmed = rows.filter(record => record.mesStatus === "confirmed").length;
  const requested = params.get("record");
  const [recordId, setRecordId] = useState<string | null>(requested);
  const passRate = summary.valid ? fmt(summary.pass / summary.valid * 100) : "0.00";
  const syncRate = rows.length ? fmt(confirmed / rows.length * 100, 0) : "0";

  useEffect(() => {
    setRecordId(requested);
  }, [requested]);

  function exportRows() {
    if (!rows.length) {
      toast("当前查询无可导出的记录");
      return;
    }
    downloadRecords(rows, `慧眼智检-查询结果-${rows.length}条.csv`);
    store.log("导出历史记录", `按当前筛选条件导出 ${rows.length} 条记录`);
  }

  return (
    <>
      <PageTitle
        title="历史检测数据查询"
        subtitle="按时间、盘号、工单和三项检测内容查询原始记录。"
        actions={<Button icon="download" onClick={exportRows}>导出查询结果</Button>}
      />
      <FilterForm key={written ? "history-stored" : `history-open:${params.get("metric") || ""}`} id="history">
        {() => (
          <>
            <Field label="盘号 / 工单">
              <TextInput name="query" value={resolved.query || ""} placeholder="输入盘号或工单号" />
            </Field>
            <Field label="检测项目">
              <Select
                name="metric"
                value={resolved.metric || ""}
                options={[["", "全部三项"], ...Object.values(METRICS).map(metric => [metric.id, metric.name] as const)]}
              />
            </Field>
            <Field label="开始时间">
              <TextInput name="start" type="datetime-local" value={resolved.start || ""} />
            </Field>
            <Field label="结束时间">
              <TextInput name="end" type="datetime-local" value={resolved.end || ""} />
            </Field>
            <Field label="数值判定">
              <Select
                name="judgement"
                value={resolved.judgement || ""}
                options={[["", "全部"], ["pass", "符合阈值"], ["fail", "超限"], ["invalid", "无效数据"]]}
              />
            </Field>
          </>
        )}
      </FilterForm>
      <div className="grid cols-4">
        <Kpi label="当前查询有效记录" value={summary.valid} note={`共 ${summary.total} 条 · 无效 ${summary.invalid} 条`} icon="database" />
        <Kpi label="符合阈值记录" value={summary.pass} note={`占有效记录 ${passRate}%`} icon="check" tone="green" />
        <Kpi label="超限记录" value={summary.fail} note="处理后仍保留原始判定" icon="bell" tone="red" />
        <Kpi label="MES确认接收" value={<>{confirmed}<small> / {rows.length}</small></>} note={`同步成功率 ${syncRate}%`} icon="cloud-upload" />
      </div>
      <div className="grid cols-3">
        {METRIC_ORDER.map(key => (
          <MetricMiniCard key={key} metricId={key} records={rows.filter(record => record.metric === key)} />
        ))}
      </div>
      <Panel
        core
        table={page.items.length > 0}
        title="检测记录"
        tools={<span className="muted small">原始超限记录保留 · 统计与导出严格按当前查询条件</span>}
      >
        {page.items.length ? (
          <HistoryRecordTable
            records={page.items}
            tasks={state.tasks}
            specs={state.specs}
            display={state.settings.metricDisplay}
            onView={setRecordId}
          />
        ) : <Empty text="当前条件下没有检测记录" />}
        <Pagination pageKey="history" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <RecordDrawer store={store} user={user} recordId={recordId} open={Boolean(recordId)} onClose={() => setRecordId(null)} />
    </>
  );
}
