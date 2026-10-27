import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import { isMetricId, METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { Report, SessionUser } from "../../domain/types";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Kpi } from "../../ui/Kpi";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Pagination, usePagination } from "../../ui/Pagination";
import { Panel } from "../../ui/Panel";
import { StatusBadge } from "../../ui/StatusBadge";
import { toast } from "../../ui/Toast";
import { date } from "../../ui/format";

function filteredReports(reports: readonly Report[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return reports.filter(report => {
    const reel = report.snapshot?.task?.reelId;
    const text = [report.id, report.taskId, reel].join(" ").toLowerCase();
    return (!filters.kind || report.kind === filters.kind) && (!keyword || text.includes(keyword));
  }).sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)));
}

export function ReportsPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.reports ?? {};
  const [createOpen, setCreateOpen] = useState(false);
  const rows = filteredReports(state.reports, filters);
  const page = usePagination(rows, "reports", 8, state.settings.pageSize);
  const stage = state.reports.filter(report => report.kind === "stage").length;
  const finalCount = state.reports.filter(report => report.kind === "final").length;

  function openCreate() {
    // Prototype permit() toasts DENY_WRITE before the dialog. createReport still denies "core" in the store.
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    if (!store.getState().tasks.length) {
      toast("请先创建检测任务。");
      return;
    }
    setCreateOpen(true);
  }

  return (
    <>
      <PageTitle
        title="质量报告管理"
        subtitle="按任务生成可追溯报告快照；运行中任务仅生成阶段报告。"
        actions={<Button primary icon="file-plus" onClick={openCreate}>生成质量报告</Button>}
      />
      <div className="grid cols-3">
        <Kpi label="报告总数" value={state.reports.length} note="每份报告保留生成时的数据快照" icon="file-text" />
        <Kpi label="阶段报告" value={stage} note="任务尚未结束，不给出最终质量结论" icon="clock" tone="amber" />
        <Kpi label="最终报告" value={finalCount} note="仅针对已完成检测任务" icon="shield-check" tone="green" />
      </div>
      <FilterForm id="reports">
        {current => (
          <>
            <Field label="报告 / 任务 / 盘号">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入报告编号、任务或盘号" />
            </Field>
            <Field label="报告类型">
              <Select
                name="kind"
                value={current.kind || ""}
                options={[["", "全部类型"], ["stage", "阶段报告"], ["final", "最终报告"]]}
              />
            </Field>
          </>
        )}
      </FilterForm>
      <Panel core table={page.items.length > 0} title="报告记录" tools={<span className="muted small">{rows.length} 份报告</span>}>
        <DataTable
          headers={["报告编号", "关联任务 / 盘号", "检测项目", "报告类型", "有效 / 超限记录", "生成时间", "操作"]}
          rows={page.items.map(report => {
            const task = report.snapshot?.task;
            const summary = report.snapshot?.stats ?? store.stats(report.snapshot?.records ?? []);
            const metric = task && isMetricId(task.metric) ? METRICS[task.metric] : undefined;
            return [
              <HashLink key={report.id} route={`report?id=${encodeURIComponent(report.id)}`}>{report.id}</HashLink>,
              <>
                {task?.id || report.taskId}
                <div className="small muted">{task?.reelId}</div>
              </>,
              metric?.name || "—",
              <StatusBadge value={report.kind} />,
              <>{summary.valid} / <span className="text-red">{summary.fail}</span></>,
              date(report.createdAt),
              <HashLink route={`report?id=${encodeURIComponent(report.id)}`}>预览 / 导出</HashLink>
            ];
          })}
        />
        <Pagination pageKey="reports" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note>报告快照生成后保持不变。后续测量、报警处置或模板修改需要重新生成报告，以保留审计链路。</Note>
      <CreateReportModal store={store} open={createOpen} onClose={() => setCreateOpen(false)} />
    </>
  );
}

function CreateReportModal({ store, open, onClose }: { store: InspectionStore; open: boolean; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const tasks = state.tasks;
  return (
    <Modal
      title="生成质量报告"
      open={open}
      submitLabel="生成报告"
      onClose={onClose}
      onSubmit={data => {
        const report = store.createReport(String(data.get("taskId") || ""));
        navigate(`report?id=${encodeURIComponent(report.id)}`);
        toast("报告快照已生成。");
      }}
    >
      <Note>系统根据任务实际状态自动生成阶段或最终报告，并保留当前记录、规则与报警处置快照。</Note>
      <Field label="关联检测任务">
        <Select
          name="taskId"
          value={tasks[0]?.id || ""}
          options={tasks.map(task => [
            task.id,
            `${task.id} · ${METRICS[task.metric].short} · ${task.status === "completed" ? "已完成 / 最终报告" : "未结束 / 阶段报告"}`
          ] as const)}
        />
      </Field>
    </Modal>
  );
}
