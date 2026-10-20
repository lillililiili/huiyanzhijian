import { useState } from "react";
import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { DENY_ADMIN, isAdmin } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { Device, MetricId, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { date } from "../../ui/format";
import { MetaItem } from "../present";

const METRIC_FILTER = [["", "全部三项检测"], ...Object.values(METRICS).map(metric => [metric.id, metric.short] as const)] as const;
const METRIC_OPTIONS = Object.values(METRICS).map(metric => [metric.id, metric.short] as const);

function matchedDevices(devices: readonly Device[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return devices.filter(device => {
    const text = [device.id, device.name, device.line].join(" ").toLowerCase();
    return (!filters.metric || device.metric === filters.metric)
      && (!filters.status || device.status === filters.status)
      && (!keyword || text.includes(keyword));
  });
}

export function DevicesPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.devices ?? {};
  const devices = matchedDevices(state.devices, filters);
  const [editing, setEditing] = useState<Device | null>(null);
  const [adding, setAdding] = useState(false);

  function openAdd() {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setEditing(null);
    setAdding(true);
  }

  function openEdit(device: Device) {
    if (!isAdmin(user)) {
      toast(DENY_ADMIN);
      return;
    }
    setAdding(false);
    setEditing(device);
  }

  return (
    <>
      <PageTitle
        title="设备档案"
        subtitle="按独立工位管理三类检测设备、连接状态与关联任务。"
        actions={<Button primary icon="plus" onClick={openAdd}>新增设备</Button>}
      />
      <FilterForm id="devices">
        {current => (
          <>
            <Field label="设备 / 产线">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入设备编号、名称或产线" />
            </Field>
            <Field label="设备类型">
              <Select name="metric" value={current.metric || ""} options={METRIC_FILTER} />
            </Field>
            <Field label="连接状态">
              <Select name="status" value={current.status || ""} options={[["", "全部状态"], ["online", "在线"], ["offline", "离线"]]} />
            </Field>
          </>
        )}
      </FilterForm>
      <div className="grid cols-3">
        {devices.length ? devices.map(device => {
          const metric = METRICS[device.metric];
          const tasks = state.tasks.filter(task => task.deviceId === device.id);
          const current = tasks.find(task => task.status === "running");
          const online = device.status === "online";
          return (
            <Panel
              key={device.id}
              core
              title={device.name}
              tools={<Badge tone={online ? "green" : "gray"}>{online ? "在线" : "离线"}</Badge>}
            >
              <div className="row" style={{ gap: 28, marginBottom: 24 }}>
                <img src={`assets/images/device-${device.metric}.png`} alt={`${device.name}设备外观参考`} style={{ width: 110, height: 175, objectFit: "contain" }} />
                <div>
                  <p className="muted small">{metric.name}</p>
                  <h2>{device.id}</h2>
                  <p>{device.line || "独立检测工位"}</p>
                  <Badge tone={online ? "green" : "gray"}>{online ? "设备在线" : "设备离线"}</Badge>
                </div>
              </div>
              <div className="detail-grid">
                <MetaItem label="数据来源">{device.source || "设备自动采集"}</MetaItem>
                <MetaItem label="最近连接">{date(device.lastSeen)}</MetaItem>
                <MetaItem label="校准 / 检查日期">{device.calibration || "未设置"}</MetaItem>
                <MetaItem label="关联任务">{tasks.length} 项</MetaItem>
              </div>
              <div style={{ marginTop: 20 }}>
                {current ? <Note>{`正在执行 ${current.id}`}</Note> : <Note tone="gray">当前无执行中的检测任务</Note>}
              </div>
              <div className="toolbar">
                <Button icon="edit" onClick={() => openEdit(device)}>编辑档案</Button>
                <HashLink route={`detection?metric=${device.metric}`}>查看检测</HashLink>
              </div>
            </Panel>
          );
        }) : <Empty text="没有符合条件的设备" />}
      </div>
      <Note>设备外观参考产品手册。不同检测对象与任务分别关联；此原型不表示三类设备一定安装在同一条生产线上。</Note>
      <DeviceEditor
        store={store}
        device={adding ? null : editing}
        open={adding || editing !== null}
        onClose={() => { setAdding(false); setEditing(null); }}
      />
    </>
  );
}

function DeviceEditor({ store, device, open, onClose }: { store: InspectionStore; device: Device | null; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const bound = Boolean(device && state.records.some(record => record.deviceId === device.id));
  const metric = (device?.metric || "dg") as MetricId;

  return (
    <Modal
      title={device ? "编辑设备档案" : "新增检测设备"}
      open={open}
      onClose={onClose}
      onSubmit={data => {
        store.saveDevice({
          id: data.get("id"),
          name: data.get("name"),
          metric: data.get("metric"),
          line: data.get("line"),
          calibration: data.get("calibration"),
          status: data.get("status"),
          update: Boolean(device)
        });
        toast("设备档案已保存。");
      }}
    >
      <Field label="设备编号">
        <TextInput name="id" value={device?.id || ""} placeholder="例如 HY-DG-02" required readOnly={Boolean(device)} maxLength={40} pattern="[A-Za-z0-9_-]+" />
      </Field>
      <Field label="设备名称">
        <TextInput name="name" value={device?.name || ""} placeholder="填写设备名称" required />
      </Field>
      <Field label="检测类型">
        {bound && device ? (
          <>
            <input readOnly defaultValue={METRICS[device.metric].name} aria-label="检测类型" />
            <input type="hidden" name="metric" defaultValue={device.metric} />
          </>
        ) : (
          <Select name="metric" value={metric} options={METRIC_OPTIONS} />
        )}
      </Field>
      <Field label="产线 / 工位">
        <TextInput name="line" value={device?.line || ""} placeholder="填写独立工位或产线" required />
      </Field>
      <Field label="校准 / 检查日期">
        <TextInput name="calibration" type="date" value={device?.calibration?.slice(0, 10) || ""} aria-label="校准 / 检查日期" />
      </Field>
      <Field label="连接状态（模拟）">
        <Select name="status" value={device?.status || "online"} options={[["online", "在线"], ["offline", "离线"]]} />
      </Field>
      <Note>已有测量记录的设备不能修改检测类型。连接状态仅控制本地演示。</Note>
    </Modal>
  );
}
