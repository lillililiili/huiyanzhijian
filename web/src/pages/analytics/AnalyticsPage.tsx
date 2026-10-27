import { useMemo } from "react";
import { useSyncExternalStore } from "react";
import { EMPTY_FILTERS, getViewSnapshot, subscribeView } from "../../app/viewState";
import { isMetricId, METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { InspectionRecord, MetricId } from "../../domain/types";
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
import { TrendChart } from "../../ui/TrendChart";
import { downloadRecords } from "../../ui/download";
import { fmt, metricFmt } from "../../ui/format";
import { MetaItem } from "../present";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];
const METRIC_OPTIONS = [["", "全部三项检测"], ...Object.values(METRICS).map(metric => [metric.id, metric.short || metric.name] as const)] as const;

function analyticsRecords(records: readonly InspectionRecord[], filters: Record<string, string>) {
  return records.filter(record => {
    const day = String(record.time || "").slice(0, 10);
    return (!filters.metric || filters.metric === record.metric)
      && (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to);
  });
}

export function AnalyticsPage({ store }: { store: InspectionStore }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.analytics ?? EMPTY_FILTERS;
  const records = useMemo(() => analyticsRecords(state.records, filters), [state.records, filters]);
  const summary = store.stats(records);
  const metricIds: MetricId[] = isMetricId(filters.metric || "") ? [filters.metric as MetricId] : METRIC_ORDER;
  const groups = useMemo(() => {
    const order: string[] = [];
    for (const record of records) {
      if (!order.includes(record.reelId)) order.push(record.reelId);
    }
    return order.map(id => ({ id, records: records.filter(record => record.reelId === id) }));
  }, [records]);
  const page = usePagination(groups, "analytics", 8, state.settings.pageSize);
  const rate = summary.valid ? `${fmt(summary.pass / summary.valid * 100)}%` : "—";
  const inverted = Boolean(filters.from && filters.to && filters.from > filters.to);

  function exportRows() {
    downloadRecords(records, "慧眼智检-质量统计明细.csv");
  }

  return (
    <>
      <PageTitle
        title="质量统计分析"
        subtitle="按有效记录汇总过程检测表现，支持按检测项目和日期范围分析。"
        actions={<Button icon="download" onClick={exportRows}>导出统计明细</Button>}
      />
      <FilterForm id="analytics">
        {current => (
          <>
            <Field label="检测项目">
              <Select name="metric" value={current.metric || ""} options={METRIC_OPTIONS} />
            </Field>
            <Field label="开始日期">
              <TextInput name="from" type="date" value={current.from || ""} />
            </Field>
            <Field label="结束日期">
              <TextInput name="to" type="date" value={current.to || ""} />
            </Field>
          </>
        )}
      </FilterForm>
      {inverted ? <Note tone="amber">开始日期晚于结束日期，请调整查询范围。</Note> : null}
      <div className="grid cols-4">
        <Kpi label="有效量测记录" value={summary.valid} note={`无效 / 缺失 ${summary.invalid} 条，不参与阈值统计`} icon="database" />
        <Kpi label="记录符合阈值比例" value={rate} note="过程记录比例，不代表产品最终合格率" icon="chart-line" tone="green" />
        <Kpi label="过程超限记录" value={summary.fail} note="保留原始阈值判定" icon="alert-triangle" tone="red" />
        <Kpi label="覆盖盘号" value={groups.length} note="按查询范围内的关联盘号去重" icon="box" />
      </div>
      <div className={`grid ${metricIds.length > 1 ? "cols-3" : "cols-1"}`}>
        {metricIds.map(id => {
          const metric = METRICS[id];
          const metricRows = records.filter(record => record.metric === id);
          const metricSummary = store.stats(metricRows);
          return (
            <Panel core key={id} title={metric.name}>
              <div className="row">
                <strong style={{ fontSize: 28, color: metric.color }}>
                  {metricFmt(metricSummary.avg, id, state.settings.metricDisplay)} <small>{metric.unit}</small>
                </strong>
                <span className="spacer" />
                <span className="muted small">有效均值</span>
              </div>
              <TrendChart metric={metric} records={metricRows} height={205} />
              <div className="metrics-strip" style={{ gridTemplateColumns: "repeat(3,minmax(0,1fr))", whiteSpace: "nowrap" }}>
                <MetaItem label="最小值">{metricFmt(metricSummary.min, id, state.settings.metricDisplay)} {metric.unit}</MetaItem>
                <MetaItem label="最大值">{metricFmt(metricSummary.max, id, state.settings.metricDisplay)} {metric.unit}</MetaItem>
                <MetaItem label="超限记录"><span className="text-red">{metricSummary.fail}</span></MetaItem>
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel core table={page.items.length > 0} title="按盘号汇总">
        <DataTable
          headers={["盘号", "检测项目", "有效记录", "符合阈值", "超限记录", "记录符合阈值比例", "MES 已确认", "操作"]}
          rows={page.items.map(group => {
            const groupSummary = store.stats(group.records);
            const names = [...new Set(group.records.map(record => METRICS[record.metric].short || METRICS[record.metric].name))];
            const confirmed = group.records.filter(record => record.mesStatus === "confirmed").length;
            const groupRate = groupSummary.valid ? `${fmt(groupSummary.pass / groupSummary.valid * 100)}%` : "—";
            return [
              <HashLink key={group.id} route={`trace?reel=${encodeURIComponent(group.id)}`}>{group.id}</HashLink>,
              names.join(" / "),
              groupSummary.valid,
              groupSummary.pass,
              groupSummary.fail ? <span className="text-red">{groupSummary.fail}</span> : "0",
              groupRate,
              `${confirmed} / ${group.records.length}`,
              <HashLink route={`trace?reel=${encodeURIComponent(group.id)}`}>盘号追溯</HashLink>
            ];
          })}
        />
        <Pagination pageKey="analytics" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note>三项检测单位不同，曲线与极值分别计算；质量结论需结合任务完成情况与异常复核，不以单一过程比例代替。</Note>
    </>
  );
}
