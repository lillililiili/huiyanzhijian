import { useSyncExternalStore } from "react";
import { isMetricId, METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { Alarm, InspectionRecord, ReportTemplate, Stats } from "../../domain/types";
import { DataTable } from "../../ui/DataTable";
import { Button } from "../../ui/Button";
import { HashLink } from "../../ui/HashLink";
import { Kpi } from "../../ui/Kpi";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { StatusBadge } from "../../ui/StatusBadge";
import { TrendChart } from "../../ui/TrendChart";
import { downloadRecords } from "../../ui/download";
import { date, fmt, ruleLabel } from "../../ui/format";
import { MetaItem } from "../present";
import { MissingRecord } from "../quality/MissingRecord";

function templateSwitches(template: Partial<ReportTemplate> | undefined) {
  const row = template ?? {};
  return {
    logo: row.includeLogo !== false,
    trend: row.includeTrend === undefined ? row.showCharts !== false : row.includeTrend,
    alarms: row.includeAlarms === undefined ? row.showAlarms !== false : row.includeAlarms,
    details: row.includeDetails === undefined ? row.showRecords === true : row.includeDetails
  };
}

function reportConclusion(kind: string, unresolved: number, summary: Stats): { text: string; tone: "amber" | "green" } {
  if (kind === "stage") return { text: "阶段数据记录 · 任务未结束，最终质量结论尚未生成", tone: "amber" };
  if (unresolved) return { text: "检测已完成 · 存在待复核事件，待质量确认", tone: "amber" };
  if (summary.fail) return { text: "检测已完成 · 过程存在超限记录，请依据复核结论确认质量", tone: "amber" };
  if (summary.valid) return { text: "有效检测记录符合所配置阈值 · 最终放行由质量人员确认", tone: "green" };
  return { text: "无有效记录 · 不形成质量判定", tone: "green" };
}

function alarmNote(alarm: Alarm) {
  return alarm.note || alarm.history.at(-1)?.note || "暂无人工复核结论";
}

export function ReportPage({ store, params }: { store: InspectionStore; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const report = params.has("id") ? state.reports.find(item => item.id === (params.get("id") || "")) : state.reports.at(-1);
  if (!report) return <MissingRecord title="尚无质量报告" back="reports" />;

  const snapshot = report.snapshot;
  const task = snapshot?.task;
  const records = snapshot?.records ?? [];
  const alarms = snapshot?.alarms ?? [];
  const template = snapshot?.template;
  const spec = snapshot?.spec;
  const switches = templateSwitches(template);
  const metricId = task && isMetricId(task.metric) ? task.metric : "dg";
  const metric = METRICS[metricId];
  const summary = store.stats(records);
  const unresolved = alarms.filter(alarm => alarm.status !== "resolved").length;
  const conclusion = reportConclusion(report.kind, unresolved, summary);
  const heading = template?.title || template?.header || "高压电缆质量检测报告";
  const footer = template?.footer || "山东沉积岩信息科技有限公司 · 慧眼智检 · 质见未来";
  const signatory = template?.signatory || template?.reviewer || "复核人：____________";

  const exportSnapshot = () => {
    downloadRecords(records, `${report.id}-报告快照.csv`);
  };

  return (
    <>
      <PageTitle
        title="报告预览与导出"
        subtitle="当前显示生成时快照。浏览器打印可保存为 PDF。"
        actions={
          <>
            <HashLink route="reports">返回报告管理</HashLink>
            <Button icon="download" onClick={exportSnapshot}>导出报告数据</Button>
            <Button primary icon="printer" onClick={() => window.print()}>打印 / 保存 PDF</Button>
          </>
        }
      />
      <article
        className="report-document"
        style={{ background: "#fff", border: "1px solid #e7edf5", borderRadius: 10, padding: "36px 46px", maxWidth: 1220, margin: "auto" }}
      >
        <div className="row" style={{ borderBottom: "2px solid #155ab6", paddingBottom: 22 }}>
          {switches.logo ? <img src="assets/images/logo.png" alt="慧眼智检" style={{ width: 190, height: "auto", objectFit: "contain" }} /> : null}
          <span className="spacer" />
          <div style={{ textAlign: "right" }}>
            <strong style={{ fontSize: 26 }}>{heading}</strong>
            <p className="muted">{report.id} · {report.kind === "final" ? "最终报告" : "阶段报告"}</p>
          </div>
        </div>
        <div style={{ margin: "24px 0" }}>
          <Note tone={conclusion.tone}>{conclusion.text}</Note>
        </div>
        <div className="detail-grid">
          <MetaItem label="任务编号">{task?.id || "—"}</MetaItem>
          <MetaItem label="工单 / 盘号">
            {task?.workOrder || "—"}
            <br />
            {task?.reelId || "—"}
          </MetaItem>
          <MetaItem label="电缆规格">{`${spec?.voltage || "—"} kV · ${spec?.cores || 1}×${spec?.area || "—"} mm²`}</MetaItem>
          <MetaItem label="检测项目">{metric.name}</MetaItem>
          <MetaItem label="执行设备">{task?.deviceId || "—"}</MetaItem>
          <MetaItem label="规则快照">
            {ruleLabel(metric, task?.ruleSnapshot)}
            <br />
            <span className="small muted">{task?.ruleSnapshot?.version}</span>
          </MetaItem>
          <MetaItem label="任务时间">
            {date(task?.startAt)}
            <br />
            {date(task?.endAt)}
          </MetaItem>
          <MetaItem label="生成时间">{date(report.createdAt)}</MetaItem>
        </div>
        <h3 style={{ borderBottom: "1px solid #e7edf5", paddingBottom: 12, marginTop: 30 }}>检测数据汇总</h3>
        <div className="grid cols-4">
          <Kpi compact label="有效记录" value={summary.valid} note={`无效记录 ${summary.invalid} 条`} icon="database" />
          <Kpi compact label="最小 / 最大值" value={`${fmt(summary.min)} / ${fmt(summary.max)}`} note={metric.unit} icon="chart-line" />
          <Kpi compact label="平均值" value={fmt(summary.avg)} note={metric.unit} icon="activity" tone="green" />
          <Kpi compact label="超限 / 待复核" value={`${summary.fail} / ${unresolved}`} note="不以最新值替代过程记录" icon="alert-triangle" tone={summary.fail ? "amber" : "green"} />
        </div>
        {switches.trend ? (
          <>
            <h3 style={{ marginTop: 28 }}>量测趋势</h3>
            <TrendChart metric={metric} records={records} height={265} />
          </>
        ) : null}
        {switches.alarms ? (
          <>
            <h3 style={{ marginTop: 26 }}>过程异常与复核快照</h3>
            {alarms.length ? (
              <DataTable
                headers={["时间", "原始超限值", "当时阈值", "处理状态", "复核记录"]}
                rows={alarms.map(alarm => {
                  const linked = records.find(item => item.id === alarm.recordId);
                  const alarmMetric = isMetricId(alarm.metric) ? METRICS[alarm.metric] : metric;
                  return [
                    date(alarm.createdAt),
                    `${fmt(linked?.value)} ${alarmMetric.unit}`,
                    ruleLabel(alarmMetric, linked?.ruleSnapshot),
                    <StatusBadge value={alarm.status} kind="alarm" />,
                    alarmNote(alarm)
                  ];
                })}
              />
            ) : <Note tone="green">本报告无关联报警记录。</Note>}
          </>
        ) : null}
        {switches.details ? (
          <>
            <h3 style={{ marginTop: 26 }}>量测明细</h3>
            <DataTable
              headers={["时间", "米数 / m", "实测值", "规则快照", "数值判定", "MES 状态"]}
              rows={records.map(record => detailRow(record))}
            />
          </>
        ) : <p className="muted small" style={{ marginTop: 20 }}>全部量测明细可通过“导出报告数据”下载；导出依据此报告快照。</p>}
        <div style={{ marginTop: 30, paddingTop: 20, borderTop: "1px solid #e7edf5" }}>
          <p className="small muted">量测图像与设备数据为原型演示。本报告只反映所关联任务和所配置检测项目，未检测或不适用项目不作质量推断。</p>
          <div className="row">
            <span>{signatory}</span>
            <span className="spacer" />
            <span className="muted small">{footer}</span>
          </div>
        </div>
      </article>
    </>
  );
}

function detailRow(record: InspectionRecord) {
  const metric = isMetricId(record.metric) ? METRICS[record.metric] : METRICS.dg;
  return [
    date(record.time),
    fmt(record.meter, 1),
    `${fmt(record.value)} ${metric.unit}`,
    `${ruleLabel(metric, record.ruleSnapshot)} · ${record.ruleSnapshot?.version || ""}`,
    <StatusBadge value={record.judgement} />,
    <StatusBadge value={record.mesStatus} kind="mes" />
  ];
}
