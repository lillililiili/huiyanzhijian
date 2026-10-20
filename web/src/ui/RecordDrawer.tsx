import { useEffect, useRef, type ReactNode } from "react";
import { useSyncExternalStore } from "react";
import { DENY_RECORD_RETRY, canWrite } from "../auth/permissions";
import { METRICS } from "../domain/metrics";
import type { InspectionStore } from "../domain/store";
import type { SessionUser } from "../domain/types";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { HashLink } from "./HashLink";
import { InspectionFigure } from "./InspectionFigure";
import { Note } from "./Note";
import { StatusBadge } from "./StatusBadge";
import { notifyFailure, toast } from "./Toast";
import { downloadRecords } from "./download";
import { fmt } from "./format";

export function RecordDrawer({
  store,
  recordId,
  user,
  open,
  onClose
}: {
  store: InspectionStore;
  recordId: string | null;
  user: SessionUser | null;
  open: boolean;
  onClose: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const record = open && recordId ? state.records.find(item => item.id === recordId) : undefined;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open || !recordId || record) return;
    toast("记录不存在");
    onCloseRef.current();
  }, [open, record, recordId]);

  if (!open || !record) return null;
  const current = record;
  const metric = METRICS[current.metric];
  const alarm = state.alarms.find(item => item.recordId === current.id);
  const fields: Array<[string, ReactNode]> = [
    ["记录编号", record.id],
    ["检测项目", metric.name],
    ["任务编号", <HashLink route={`task?id=${encodeURIComponent(record.taskId)}`}>{record.taskId}</HashLink>],
    ["工单 / 盘号", <>
      <HashLink route={`trace?reel=${encodeURIComponent(record.reelId)}`}>{record.reelId}</HashLink>
      <br />
      {record.workOrder}
    </>],
    ["设备 / 采集时间", <>
      {record.deviceId}
      <br />
      {record.time}
    </>],
    ["米数位置", `${fmt(record.meter, 1)} m`],
    ["实测值", `${fmt(record.value)} ${metric.unit}`],
    ["数据有效性", <StatusBadge value={record.validity} />],
    ["数值判定", <StatusBadge value={record.judgement} />],
    ["规则快照", <>
      {record.ruleSnapshot.id}
      <br />
      {record.ruleSnapshot.operator === ">=" ? "≥" : "≤"} {record.ruleSnapshot.threshold} {metric.unit}
    </>],
    ["平台接收", <StatusBadge value={record.platformStatus} />],
    ["MES状态", <StatusBadge value={record.mesStatus} />]
  ];

  function retry() {
    if (!canWrite(user)) {
      toast(DENY_RECORD_RETRY);
      return;
    }
    try {
      store.retrySync([current.id]);
      toast("已执行模拟MES重试");
    } catch (error) {
      notifyFailure(error);
    }
  }

  return (
    <Drawer title="检测记录详情" open={open} onClose={onClose}>
      <InspectionFigure record={record} />
      <div className="detail-grid">
        {fields.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <Note tone={alarm ? "amber" : "green"}>
        {alarm
          ? `关联报警 ${alarm.id} · ${alarm.active ? "尚未恢复" : "量测已恢复"} · ${alarm.status === "resolved" ? "人工已处理" : "仍待人工复核"}`
          : "本条记录无关联超限事件"}
      </Note>
      <div className="actions">
        {alarm ? <HashLink route={`alarm?id=${encodeURIComponent(alarm.id)}`}>查看报警与处置</HashLink> : null}
        <Button icon="download" onClick={() => downloadRecords([record], `检测记录-${record.id}.csv`)}>导出此条记录</Button>
        {record.mesStatus !== "confirmed" ? <Button primary icon="refresh" onClick={retry}>模拟MES重试</Button> : null}
      </div>
    </Drawer>
  );
}
