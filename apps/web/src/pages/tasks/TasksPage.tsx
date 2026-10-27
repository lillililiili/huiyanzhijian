import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { isMetricId, METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm, useViewFilters } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Kpi } from "../../ui/Kpi";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { Pagination, usePagination } from "../../ui/Pagination";
import { toast } from "../../ui/Toast";
import { specLabel, timeOnly } from "../present";
import { refuseReadonly } from "../writeGuard";
import { taskSyncLabel } from "./taskSync";

export function TasksPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const filters = useViewFilters("tasks");
  const [creating, setCreating] = useState(false);
  const rows = state.tasks.filter(task => (
    (!filters.query || `${task.id} ${task.reelId} ${task.workOrder}`.toLowerCase().includes(filters.query.toLowerCase()))
    && (!filters.metric || task.metric === filters.metric)
    && (!filters.status || task.status === filters.status)
    && (!filters.date || String(task.startAt || "").startsWith(filters.date))
  ));
  const page = usePagination(rows, "tasks", 8, state.settings.pageSize);
  const running = state.tasks.filter(task => task.status === "running").length;
  const completed = state.tasks.filter(task => task.status === "completed").length;
  const unresolved = state.alarms.filter(alarm => alarm.status !== "resolved").length;

  return (
    <>
      <PageTitle
        title="检测任务列表"
        subtitle="按工单、盘号、检测项目管理任务；任务执行与 MES 同步状态分别展示。"
        actions={<Button primary icon="plus" onClick={() => { if (!refuseReadonly(user)) setCreating(true); }}>新建检测任务</Button>}
      />
      <FilterForm id="tasks">
        {current => (
          <>
            <Field label="工单 / 盘号">
              <TextInput name="query" value={current.query || ""} placeholder="输入工单号或盘号" />
            </Field>
            <Field label="检测项目">
              <Select name="metric" value={current.metric || ""} options={[["", "全部检测项目"], ...Object.values(METRICS).map(metric => [metric.id, metric.name] as const)]} />
            </Field>
            <Field label="任务状态">
              <Select name="status" value={current.status || ""} options={[["", "全部状态"], ["pending", "待开始"], ["running", "检测中"], ["completed", "已完成"]]} />
            </Field>
            <Field label="日期">
              <TextInput name="date" type="date" value={current.date || ""} />
            </Field>
          </>
        )}
      </FilterForm>
      <div className="grid cols-4">
        <Kpi label="今日任务总数" value={state.tasks.length} note="仅三类检测任务" icon="clipboard" />
        <Kpi label="检测中" value={running} note="当前正在执行的任务" icon="player-play" />
        <Kpi label="已完成" value={completed} note="完成状态不替代质量结论" icon="check" tone="green" />
        <Kpi label="待复核过程异常" value={unresolved} note="独立于任务执行状态" icon="bell" tone="amber" />
      </div>
      <Panel
        core
        table={rows.length > 0}
        title="任务记录"
        tools={<span className="muted small">共 {rows.length} 项 · 当前显示 {page.items.length} 项</span>}
      >
        {rows.length ? (
          <>
            <DataTable
              headers={["任务编号", "盘号", "电压等级", "电缆规格", "检测项目", "执行设备", "执行状态", "MES状态", "开始时间", "操作"]}
              rows={page.items.map(task => {
                const spec = state.specs.find(item => item.id === task.specId);
                const label = specLabel(spec);
                const cable = label.includes(" · ") ? label.split(" · ")[1] : "—";
                const sync = taskSyncLabel(task, state.records);
                return [
                  <HashLink route={`task?id=${encodeURIComponent(task.id)}`}>{task.id}</HashLink>,
                  <HashLink route={`trace?reel=${encodeURIComponent(task.reelId)}`}>{task.reelId}</HashLink>,
                  `${spec?.voltage ?? "—"}kV`,
                  cable,
                  METRICS[task.metric].name,
                  task.deviceId,
                  <StatusBadge value={task.status} kind="task" />,
                  <Badge tone={sync.tone}>{sync.text}</Badge>,
                  timeOnly(task.startAt),
                  <HashLink route={`task?id=${encodeURIComponent(task.id)}`}>查看</HashLink>
                ];
              })}
            />
            <Pagination pageKey="tasks" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
          </>
        ) : <Empty text="没有匹配的检测任务" />}
      </Panel>
      <Note>每个任务只关联实际适用的检测项目，不默认每一种规格都同时开展三项检测。</Note>
      <TaskCreateModal store={store} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function TaskCreateModal({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const specs = state.specs.filter(spec => spec.enabled);
  const [specId, setSpecId] = useState(specs[0]?.id ?? "");
  const [metric, setMetric] = useState<MetricId>("dg");
  const [stamp] = useState(() => Date.now().toString().slice(-10));
  const spec = specs.find(item => item.id === specId) ?? specs[0];
  const metricIds = (spec?.metrics ?? []).filter(isMetricId);
  const activeMetric = metricIds.includes(metric) ? metric : metricIds[0] ?? "dg";
  const devices = state.devices.filter(device => device.metric === activeMetric);
  const recipes = state.recipes.filter(recipe => recipe.enabled && recipe.metric === activeMetric);

  return (
    <Modal
      title="新建检测任务"
      open={open}
      onClose={onClose}
      onSubmit={data => {
        const chosen = String(data.get("metric") || "");
        const task = store.createTask({
          workOrder: data.get("workOrder"),
          reelId: data.get("reelId"),
          specId: String(data.get("specId") || ""),
          metric: chosen,
          deviceId: String(data.get("deviceId") || ""),
          recipeId: String(data.get("recipeId") || ""),
          plannedLength: Number(data.get("plannedLength"))
        });
        toast("检测任务已创建");
        navigate(`task?id=${encodeURIComponent(task.id)}`);
      }}
    >
      <div className="grid cols-2">
        <Field label="工单号">
          <TextInput name="workOrder" value={`WO${stamp}`} required />
        </Field>
        <Field label="盘号">
          <TextInput name="reelId" value={`P${stamp}`} required />
        </Field>
        <Field label="产品规格">
          <Select
            name="specId"
            value={spec?.id || ""}
            options={specs.map(item => [item.id, `${item.id} · ${specLabel(item)}`] as const)}
            onChange={event => {
              setSpecId(event.target.value);
              const next = specs.find(item => item.id === event.target.value);
              const first = next?.metrics.find(isMetricId);
              if (first) setMetric(first);
            }}
          />
        </Field>
        <Field label="检测项目">
          <Select
            key={`metric-${spec?.id || "none"}`}
            name="metric"
            value={activeMetric}
            options={metricIds.map(id => [id, METRICS[id].name] as const)}
            onChange={event => { if (isMetricId(event.target.value)) setMetric(event.target.value); }}
          />
        </Field>
        <Field label="执行设备">
          <Select key={`device-${activeMetric}`} name="deviceId" value={devices[0]?.id || ""} options={devices.map(device => [device.id, `${device.id} · ${METRICS[device.metric].short}`] as const)} />
        </Field>
        <Field label="检测配方">
          <Select key={`recipe-${activeMetric}`} name="recipeId" value={recipes[0]?.id || ""} options={recipes.map(recipe => [recipe.id, `${recipe.name} · ${recipe.version}`] as const)} />
        </Field>
        <Field label="计划检测长度 / m">
          <TextInput name="plannedLength" type="number" value="2000" required min="0.1" step="0.1" />
        </Field>
      </div>
      <Note>规格、检测项目、设备与配方必须匹配。创建后可在任务详情开始检测；设备同一时间仅执行一个任务。</Note>
    </Modal>
  );
}
