import { useMemo, useState } from "react";
import { useSyncExternalStore } from "react";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { Alarm, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { HashLink } from "../../ui/HashLink";
import { InspectionFigure } from "../../ui/InspectionFigure";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { TrendChart } from "../../ui/TrendChart";
import { toast } from "../../ui/Toast";
import { date, fmt, metricFmt, ruleLabel } from "../../ui/format";
import { MetaItem } from "../present";
import { MissingRecord } from "../quality/MissingRecord";

export function AlarmPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [reviewOpen, setReviewOpen] = useState(false);
  const alarm = params.has("id") ? state.alarms.find(item => item.id === (params.get("id") || "")) : state.alarms[0];
  const record = alarm ? state.records.find(item => item.id === alarm.recordId) : undefined;
  const task = alarm ? state.tasks.find(item => item.id === alarm.taskId) : undefined;
  const trendRecords = useMemo(() => {
    const taskId = alarm?.taskId;
    if (!taskId) return [];
    return state.records.filter(item => item.taskId === taskId).sort((left, right) => left.time.localeCompare(right.time));
  }, [alarm?.taskId, state.records]);

  if (!alarm) return <MissingRecord title="暂无报警事件" back="alarms" />;
  if (!record) return <MissingRecord title="关联量测记录不存在" back="alarms" />;

  const metric = METRICS[alarm.metric];

  function openReview() {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    setReviewOpen(true);
  }

  return (
    <>
      <PageTitle
        title="报警详情与处置"
        subtitle="每一次复核都与原始量测记录、当时规则和处理人关联。"
        actions={
          <>
            <HashLink route="alarms">返回报警列表</HashLink>
            <Button primary icon="clipboard-check" onClick={openReview}>
              {alarm.status === "resolved" ? "补充处置记录" : "复核与处置"}
            </Button>
          </>
        }
      />
      <Panel core title={`${metric.name}超限`}>
        <div className="detail-grid">
          <MetaItem label="报警编号">{alarm.id}</MetaItem>
          <MetaItem label="事件时间">{date(alarm.createdAt)}</MetaItem>
          <MetaItem label="盘号 / 工单">
            <HashLink route={`trace?reel=${encodeURIComponent(record.reelId)}`}>{record.reelId}</HashLink>
            <div className="small muted">{record.workOrder}</div>
          </MetaItem>
          <MetaItem label="关联任务">
            <HashLink route={`task?id=${encodeURIComponent(alarm.taskId)}`}>{alarm.taskId}</HashLink>
          </MetaItem>
          <MetaItem label="原始超限值">
            <strong className="text-red" style={{ fontSize: 28 }}>
              {metricFmt(record.value, alarm.metric, state.settings.metricDisplay)}
              <small> {metric.unit}</small>
            </strong>
          </MetaItem>
          <MetaItem label="当时判定规则">
            {ruleLabel(metric, record.ruleSnapshot)}
            <div className="small muted">{record.ruleSnapshot?.version}</div>
          </MetaItem>
          <MetaItem label="米数位置">{fmt(record.meter, 1)} m</MetaItem>
          <MetaItem label="当前状态">
            <Badge tone={alarm.active ? "red" : "green"}>{alarm.active ? "数值仍超限" : "数值已恢复"}</Badge>
            {" "}
            <StatusBadge value={alarm.status} kind="alarm" />
          </MetaItem>
        </div>
      </Panel>
      <div className="split">
        <Panel core title="事件对应趋势" tools={<span className="small muted">原始点：{date(record.time)}</span>}>
          <TrendChart metric={metric} records={trendRecords} height={275} />
        </Panel>
        <Panel core title="对应量测图像" tools={<span className="muted small">演示素材 · 非现场图像</span>}>
          <InspectionFigure record={record} />
        </Panel>
      </div>
      <div className="split">
        <Panel core title="处置时间线">
          {alarm.history.length ? (
            <div className="stack">
              {alarm.history.map((entry, index) => (
                <div key={`${entry.time}-${index}`} style={{ borderLeft: "2px solid #dce8f7", padding: "4px 0 15px 20px" }}>
                  <div className="row">
                    <strong>{entry.actor || "质量管理员"}</strong>
                    <StatusBadge value={entry.status} kind="alarm" />
                    <span className="spacer" />
                    <span className="small muted">{date(entry.time)}</span>
                  </div>
                  <p>{entry.note || "记录报警状态变化"}</p>
                </div>
              ))}
            </div>
          ) : <Empty text="尚无人工处置记录" />}
        </Panel>
        <Panel core title="数据与证据">
          <div className="detail-grid">
            <MetaItem label="原始记录">{record.id}</MetaItem>
            <MetaItem label="执行设备">{record.deviceId}</MetaItem>
            <MetaItem label="数据有效性">
              <Badge tone={record.validity === "valid" ? "blue" : "gray"}>{record.validity === "valid" ? "有效数据" : "无效数据"}</Badge>
            </MetaItem>
            <MetaItem label="MES 状态">
              <StatusBadge value={record.mesStatus} kind="mes" />
            </MetaItem>
            <MetaItem label="任务执行状态">
              <StatusBadge value={task?.status || ""} kind="task" />
            </MetaItem>
            <MetaItem label="原始记录保留">
              <Badge tone="green">保留，不覆盖</Badge>
            </MetaItem>
          </div>
          <div style={{ marginTop: 20 }}>
            <Note tone={alarm.status === "resolved" ? "green" : "amber"}>
              {alarm.status === "resolved"
                ? "该事件已完成人工处理。原始超限值及后续补充记录继续保留。"
                : "完成复核后再填写处置结论。当前数值恢复不会自动修改此事件的处理状态。"}
            </Note>
          </div>
        </Panel>
      </div>
      <ReviewModal store={store} user={user} alarm={alarm} open={reviewOpen} onClose={() => setReviewOpen(false)} />
    </>
  );
}

function ReviewModal({
  store,
  user,
  alarm,
  open,
  onClose
}: {
  store: InspectionStore;
  user: SessionUser;
  alarm: Alarm;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      title="报警复核与处置"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        store.updateAlarm(alarm.id, {
          status: String(data.get("status") || ""),
          note: String(data.get("note") || "").trim(),
          actor: String(data.get("actor") || "").trim()
        });
        toast("处置已保存，原始超限记录保留。");
      }}
    >
      <Note tone="amber">原始测量值和当时判定规则保持不变。请记录实际复核依据及处理结果。</Note>
      <Field label="处理状态">
        <Select
          name="status"
          value={alarm.status === "resolved" ? "resolved" : "processing"}
          options={[["processing", "处理中"], ["resolved", "已处理"]]}
        />
      </Field>
      <Field label="复核 / 处理结论">
        <textarea name="note" rows={4} required placeholder="例如：检查铜带张力，调整工艺后复测；记录复核依据。" aria-label="复核 / 处理结论" defaultValue="" />
      </Field>
      <Field label="处置人">
        <TextInput name="actor" value={user.name || "质量管理员"} placeholder="填写处置人" required />
      </Field>
    </Modal>
  );
}
