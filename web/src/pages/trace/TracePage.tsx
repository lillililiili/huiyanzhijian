import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, SessionUser, Task } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Empty } from "../../ui/Empty";
import { Field, Select } from "../../ui/Field";
import { HashLink } from "../../ui/HashLink";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { Pagination, usePagination } from "../../ui/Pagination";
import { RecordDrawer } from "../../ui/RecordDrawer";
import { StatusBadge } from "../../ui/StatusBadge";
import { notifyFailure } from "../../ui/Toast";
import { MetricHero, specLabel } from "../present";
import { refuseReadonly } from "../writeGuard";
import { HistoryRecordTable, MetricMiniCard } from "../history/historyView";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];

export function TracePage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const requested = params.get("reel");
  const reel = requested || state.tasks[0]?.reelId || "";
  const tasks = state.tasks.filter(task => task.reelId === reel);
  const rows = state.records.filter(record => record.reelId === reel).slice().sort((left, right) => right.time.localeCompare(left.time) || right.id.localeCompare(left.id));
  const summary = store.stats(rows);
  const alarms = state.alarms.filter(alarm => tasks.some(task => task.id === alarm.taskId));
  const page = usePagination(rows, "trace", 8, state.settings.pageSize);
  const confirmed = rows.filter(record => record.mesStatus === "confirmed").length;
  const [recordId, setRecordId] = useState<string | null>(null);
  const reelOptions = [...new Set(state.tasks.map(task => task.reelId))];
  const selectedReel = reelOptions.includes(reel) ? reel : reelOptions[0] || "";

  function openReport(taskId: string) {
    if (refuseReadonly(user)) return;
    try {
      const report = store.createReport(taskId);
      navigate(`report?id=${encodeURIComponent(report.id)}`);
    } catch (error) {
      notifyFailure(error);
    }
  }

  function reportCell(task: Task) {
    if (task.status === "pending") return <Badge tone="gray">待开始检测</Badge>;
    const pending = state.alarms.find(alarm => alarm.taskId === task.id && alarm.status !== "resolved");
    if (task.status === "completed" && pending) {
      return <HashLink route={`alarm?id=${encodeURIComponent(pending.id)}`}>先复核异常</HashLink>;
    }
    return (
      <Button icon="file-text" onClick={() => openReport(task.id)}>
        {task.status === "completed" ? "生成最终报告" : "预览阶段报告"}
      </Button>
    );
  }

  function queryReel(event: { currentTarget: HTMLButtonElement }) {
    const select = event.currentTarget.closest(".filters")?.querySelector<HTMLSelectElement>("[name='trace-reel']");
    navigate(`trace?reel=${encodeURIComponent(select?.value || reel)}`);
  }

  return (
    <>
      <PageTitle
        title="盘号追溯详情"
        subtitle="将检测任务、量测原始记录、过程异常与质量报告关联到同一盘号。"
        actions={<HashLink route="history">返回历史数据</HashLink>}
      />
      <div className="filters">
        <Field label="选择盘号">
          <Select name="trace-reel" value={selectedReel} options={reelOptions.map(id => [id, id] as const)} />
        </Field>
        <div className="filter-buttons">
          <Button primary icon="search" onClick={queryReel}>查询追溯</Button>
        </div>
      </div>
      <Panel core title={`盘号 ${reel}`}>
        <div className="grid cols-4">
          <div className="meta-item"><span className="muted small">检测任务</span><div><MetricHero value={tasks.length} unit="项" /></div></div>
          <div className="meta-item"><span className="muted small">有效记录</span><div><MetricHero value={summary.valid} unit="条" /></div></div>
          <div className="meta-item"><span className="muted small">过程超限</span><div><MetricHero value={summary.fail} unit="条" tone={summary.fail ? "text-red" : ""} /></div></div>
          <div className="meta-item"><span className="muted small">MES确认</span><div><MetricHero value={confirmed} unit={`/ ${rows.length}`} /></div></div>
        </div>
      </Panel>
      <Panel core table={tasks.length > 0} title="关联检测任务">
        {tasks.length ? (
          <DataTable
            headers={["任务编号", "检测项目", "规格", "执行设备", "任务状态", "关联报告"]}
            rows={tasks.map(task => {
              const spec = state.specs.find(item => item.id === task.specId);
              return [
                <HashLink route={`task?id=${encodeURIComponent(task.id)}`}>{task.id}</HashLink>,
                METRICS[task.metric].name,
                specLabel(spec),
                task.deviceId,
                <StatusBadge value={task.status} kind="task" />,
                reportCell(task)
              ];
            })}
          />
        ) : <Empty text="该盘号不存在检测任务" />}
      </Panel>
      <div className="grid cols-3">
        {METRIC_ORDER.map(key => {
          const metricRows = rows.filter(record => record.metric === key);
          if (metricRows.length) {
            return <MetricMiniCard key={key} metricId={key} records={metricRows} />;
          }
          const waiting = tasks.some(task => task.metric === key);
          return (
            <Panel key={key} core title={METRICS[key].name}>
              <Empty text={waiting ? "等待量测数据" : "本盘未关联该项检测"} />
            </Panel>
          );
        })}
      </div>
      <Panel core table={alarms.length > 0} title="过程异常">
        {alarms.length ? (
          <DataTable
            headers={["事件编号", "检测项目", "发生时间", "原始记录", "处置状态", "操作"]}
            rows={alarms.map(alarm => [
              alarm.id,
              METRICS[alarm.metric].name,
              alarm.createdAt,
              <Button onClick={() => setRecordId(alarm.recordId)}>{alarm.recordId}</Button>,
              <StatusBadge value={alarm.status} />,
              <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>查看处置</HashLink>
            ])}
          />
        ) : <Empty text="本盘号暂无过程超限事件" />}
      </Panel>
      <Panel core table={page.items.length > 0} title="完整检测记录">
        {page.items.length ? (
          <HistoryRecordTable
            records={page.items}
            tasks={state.tasks}
            specs={state.specs}
            display={state.settings.metricDisplay}
            onView={setRecordId}
          />
        ) : <Empty text="当前条件下没有检测记录" />}
        <Pagination pageKey="trace" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <RecordDrawer store={store} user={user} recordId={recordId} open={Boolean(recordId)} onClose={() => setRecordId(null)} />
    </>
  );
}
