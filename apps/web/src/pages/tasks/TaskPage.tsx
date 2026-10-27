import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { SessionUser, Task } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { downloadRecords } from "../../ui/download";
import { Empty } from "../../ui/Empty";
import { HashLink } from "../../ui/HashLink";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { notifyFailure, toast } from "../../ui/Toast";
import { fmt, metricFmt, ruleLabel, thresholdText } from "../../ui/format";
import { MetaItem, MetricHero, latestRecord, specLabel, timeOnly } from "../present";
import { refuseReadonly } from "../writeGuard";
import { executionEvents } from "./executionLog";

export function TaskPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [completeOpen, setCompleteOpen] = useState(false);
  const requested = params.get("id");
  const found = requested ? state.tasks.find(item => item.id === requested) ?? null : state.tasks[0] ?? null;

  if (!found) {
    return (
      <>
        <PageTitle title="检测任务详情" subtitle="该任务不存在，或已从本地演示数据移除。" actions={<HashLink route="tasks">返回任务列表</HashLink>} />
        <Empty text="任务不存在" />
      </>
    );
  }

  const task = found;
  const metric = METRICS[task.metric];
  const rows = state.records.filter(record => record.taskId === task.id).slice().sort((a, b) => a.time.localeCompare(b.time));
  const summary = store.stats(rows);
  const last = latestRecord(rows);
  const alarms = state.alarms.filter(alarm => alarm.taskId === task.id);
  const pending = alarms.filter(alarm => alarm.status !== "resolved");
  const spec = state.specs.find(item => item.id === task.specId);
  const progress = Math.min(100, task.plannedLength ? Number(task.measuredLength) / Number(task.plannedLength) * 100 : 0);
  const confirmed = rows.filter(record => record.mesStatus === "confirmed").length;
  const received = rows.filter(record => record.platformStatus === "received").length;
  const events = executionEvents(state, task);
  const windowValue = metric.id === "dg" ? summary.min : summary.max;
  const unresolved = pending[0];

  function run(work: () => void, success: string) {
    if (refuseReadonly(user)) return;
    try {
      work();
      toast(success);
    } catch (error) {
      notifyFailure(error);
    }
  }

  function openReport() {
    if (refuseReadonly(user)) return;
    try {
      const report = store.createReport(task.id);
      navigate(`report?id=${encodeURIComponent(report.id)}`);
    } catch (error) {
      notifyFailure(error);
    }
  }

  const reportAction = task.status === "completed" && unresolved
    ? <HashLink route={`alarm?id=${encodeURIComponent(unresolved.id)}`}>先复核异常</HashLink>
    : <Button icon="file-text" onClick={openReport}>{task.status === "completed" ? "生成最终报告" : "预览阶段报告"}</Button>;

  return (
    <>
      <PageTitle
        title="检测任务详情"
        subtitle="单次检测任务的执行记录、过程结果与 MES 同步状态。"
        actions={
          <>
            {task.status === "pending" ? <Button primary icon="player-play" onClick={() => run(() => { store.startTask(task.id); }, "任务已开始，可模拟采集下一条记录")}>开始检测</Button> : null}
            {task.status === "running" ? (
              <>
                <Button primary icon="plus" onClick={() => run(() => { store.advanceTask(task.id); }, "已采集并保存一条模拟检测记录")}>采集下一条</Button>
                <Button onClick={() => { if (!refuseReadonly(user)) setCompleteOpen(true); }}>结束检测</Button>
              </>
            ) : null}
            <HashLink route="tasks">返回任务列表</HashLink>
            {task.status === "pending" ? null : reportAction}
          </>
        }
      />
      <Panel core className="task-summary" title="">
        <div className="row">
          <div className="stat-icon blue"><Icon name="clipboard" /></div>
          <div>
            <h2 style={{ margin: "0 0 5px" }}>{task.id}</h2>
            <span className="muted small">{metric.name} · {task.deviceId}</span>
          </div>
          <StatusBadge value={task.status} kind="task" />
          <div className="spacer" />
          {pending.length
            ? <Badge tone="amber">过程存在超限 · 待复核 {pending.length} 项</Badge>
            : <Badge tone="green">{alarms.length ? "历史超限已处理" : "暂无过程超限"}</Badge>}
        </div>
        <div className="detail-grid" style={{ marginTop: 22, paddingTop: 18, borderTop: "1px solid var(--line)" }}>
          <MetaItem label="工单号">{task.workOrder}</MetaItem>
          <MetaItem label="盘号"><HashLink route={`trace?reel=${encodeURIComponent(task.reelId)}`}>{task.reelId}</HashLink></MetaItem>
          <MetaItem label="高压电缆规格">{specLabel(spec)}</MetaItem>
          <MetaItem label="执行设备">{task.deviceId}</MetaItem>
          <MetaItem label="检测项目">{metric.name}</MetaItem>
          <MetaItem label="规则版本">{`${task.ruleSnapshot.id || task.recipeId} · ${ruleLabel(metric, task.ruleSnapshot)}`}</MetaItem>
          <MetaItem label="开始时间">{task.startAt || "尚未开始"}</MetaItem>
          <MetaItem label="结束时间">{task.endAt || "—"}</MetaItem>
        </div>
      </Panel>
      <div className="split">
        <Panel core title="任务执行进度">
          <div className="steps">
            {["已创建", "已分配", "检测中", "已完成"].map((label, index) => {
              const done = task.status === "completed" || index < (task.status === "running" ? 3 : 2);
              const marked = task.status === "completed" || index < (task.status === "running" ? 2 : 1);
              const detail = index === 2
                ? (task.startAt ? `${timeOnly(task.startAt)}开始` : "等待开始")
                : index === 3
                  ? (task.endAt ? timeOnly(task.endAt) : "尚未结束")
                  : "已记录";
              return (
                <div className={done ? "step done" : "step"} key={label}>
                  <span>{marked ? "✓" : index + 1}</span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </div>
              );
            })}
          </div>
          <div className="row">
            <span className="muted">累计计米进度</span>
            <div className="spacer" />
            <strong className="text-blue">{fmt(task.measuredLength, 1)} / {fmt(task.plannedLength, 1)} m</strong>
          </div>
          <div className="progress"><span style={{ width: `${progress}%` }} /></div>
          <p className="muted small">{fmt(progress, 1)}% · 按本任务计划长度计算</p>
        </Panel>
        <Panel core title="关联检测结果" tools={<HashLink route={`detection?metric=${task.metric}&task=${encodeURIComponent(task.id)}`}>进入实时检测 →</HashLink>}>
          <div className="grid cols-3 core-result-grid">
            <MetaItem label={`最新${metric.short}`}>
              <MetricHero value={metricFmt(last?.value, metric.id, state.settings.metricDisplay)} unit={metric.unit} />
              {last ? <StatusBadge value={last.judgement} /> : <Badge tone="gray">待采集</Badge>}
            </MetaItem>
            <MetaItem label={metric.id === "dg" ? "控制下限" : "控制上限"}>
              <MetricHero value={thresholdText(task.ruleSnapshot.threshold)} unit={metric.unit} />
              <span className="small muted">{ruleLabel(metric, task.ruleSnapshot)}</span>
            </MetaItem>
            <MetaItem label={metric.id === "dg" ? "本窗口最小值" : "本窗口最大值"}>
              <MetricHero value={metricFmt(windowValue, metric.id, state.settings.metricDisplay)} unit={metric.unit} tone={summary.fail ? "text-red" : ""} />
              <span className="small muted">原始记录保留</span>
            </MetaItem>
          </div>
          <Note tone={task.status === "completed" && !pending.length ? "green" : "amber"}>
            {task.status === "completed"
              ? (pending.length ? "任务已结束；请先完成异常复核，再生成最终报告。" : "任务已结束，可生成最终报告。")
              : "任务未结束，最终质量结论尚未生成。"}
          </Note>
        </Panel>
      </div>
      <div className="grid cols-3">
        <Panel core title="执行日志">
          <DataTable headers={["时间", "记录内容", "执行主体"]} rows={events.map(event => [timeOnly(event.time), event.text, event.actor])} />
        </Panel>
        <Panel core title="关联异常">
          {alarms.length ? alarms.map((alarm, index) => {
            const record = state.records.find(item => item.id === alarm.recordId);
            return (
              <div key={alarm.id}>
                {index > 0 ? <hr /> : null}
                <div className="stack" style={{ gap: 10 }}>
                  <div className="row">
                    <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>{metric.short}{metric.id === "dg" ? "低于控制下限" : "超过控制上限"}</HashLink>
                    <StatusBadge value={alarm.status} />
                  </div>
                  <div className="muted small">{timeOnly(record?.time)} · 米数位置 {fmt(record?.meter, 1)} m</div>
                  <MetricHero value={metricFmt(record?.value, metric.id, state.settings.metricDisplay)} unit={metric.unit} tone="text-red" />
                  <span className="muted small">当前值恢复正常，不自动关闭历史异常。</span>
                </div>
              </div>
            );
          }) : <Empty text="本任务暂无超限事件" />}
        </Panel>
        <Panel core title="数据与 MES 同步">
          <div className="key-value"><span>本任务有效记录</span><span>{summary.valid} 条</span></div>
          <div className="key-value"><span>平台已接收</span><span>{received} / {rows.length}</span></div>
          <div className="key-value"><span>MES已确认</span><span className="text-green">{confirmed} / {rows.length}</span></div>
          <div className="key-value">
            <span>最终质量报告</span>
            {task.status === "completed"
              ? (pending.length ? <Badge tone="amber">待异常复核</Badge> : <Badge tone="green">可生成</Badge>)
              : <Badge tone="gray">待任务完成</Badge>}
          </div>
          <div className="row" style={{ marginTop: 20 }}>
            <Button icon="download" onClick={() => downloadRecords(rows, `${task.id}-检测明细.csv`)}>导出阶段数据明细.csv</Button>
            <HashLink route="sync">查看同步</HashLink>
          </div>
        </Panel>
      </div>
      <CompleteModal store={store} task={task} open={completeOpen} onClose={() => setCompleteOpen(false)} />
    </>
  );
}

function CompleteModal({ store, task, open, onClose }: { store: InspectionStore; task: Task; open: boolean; onClose: () => void }) {
  return (
    <Modal title="结束本次检测" open={open} submitLabel="确认结束" onClose={onClose} onSubmit={() => {
      store.completeTask(task.id);
      toast("任务已完成，质量结论仍按原始记录及复核状态呈现");
    }}>
      <Note tone="amber">{`任务 ${task.id} 已检测 ${fmt(task.measuredLength, 1)} / ${fmt(task.plannedLength, 1)} m。结束后保留实际检测长度、全部超限和同步记录。`}</Note>
      <p>完成任务不会自动关闭待复核报警，也不会将超限判定改为合格。</p>
    </Modal>
  );
}
