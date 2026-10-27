import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { escapeCsvCell } from "../../domain/csv";
import type { InspectionStore } from "../../domain/store";
import type { Audit, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Field, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Pagination, usePagination } from "../../ui/Pagination";
import { Panel } from "../../ui/Panel";
import { downloadFile } from "../../ui/download";
import { date } from "../../ui/format";

function auditTime(value: unknown) {
  return date(value);
}

function filteredAudits(audits: readonly Audit[], filters: Record<string, string>) {
  const keyword = (filters.keyword || "").toLowerCase();
  return audits.filter(item => {
    const text = [item.action, item.detail, item.actor].join(" ").toLowerCase();
    const day = String(item.time || "").slice(0, 10);
    return (!keyword || text.includes(keyword))
      && (!filters.from || day >= filters.from)
      && (!filters.to || day <= filters.to);
  }).slice().sort((left, right) => String(right.time).localeCompare(String(left.time)));
}

function auditCsv(rows: readonly Audit[]) {
  const header = ["时间", "操作人", "操作类型", "操作内容", "记录编号"];
  const body = rows.map(item => [auditTime(item.time), item.actor || "系统", item.action, item.detail, item.id]);
  return `\uFEFF${[header, ...body].map(line => line.map(cell => escapeCsvCell(cell)).join(",")).join("\r\n")}`;
}

export function AuditPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const filters = view.filters.audit ?? {};
  const rows = filteredAudits(state.audits, filters);
  const page = usePagination(rows, "audit", 10, state.settings.pageSize);
  void user;

  function exportRows() {
    const current = getViewSnapshot().filters.audit ?? {};
    downloadFile("慧眼智检-操作审计.csv", auditCsv(filteredAudits(store.getState().audits, current)), "text/csv;charset=utf-8");
  }

  return (
    <>
      <PageTitle
        title="操作审计"
        subtitle="追溯任务、配方、复核、报告与系统配置的本地操作。"
        actions={<Button icon="download" onClick={exportRows}>导出审计记录</Button>}
      />
      <FilterForm id="audit">
        {current => (
          <>
            <Field label="操作 / 操作人">
              <TextInput name="keyword" value={current.keyword || ""} placeholder="输入动作、内容或操作人" />
            </Field>
            <Field label="开始日期">
              <TextInput name="from" type="date" value={current.from || ""} aria-label="开始日期" />
            </Field>
            <Field label="结束日期">
              <TextInput name="to" type="date" value={current.to || ""} aria-label="结束日期" />
            </Field>
          </>
        )}
      </FilterForm>
      <Panel core table={page.items.length > 0} title="审计日志" tools={<span className="muted small">查询结果 {rows.length} 条</span>}>
        <DataTable
          headers={["时间", "操作人", "操作类型", "操作内容", "记录编号"]}
          rows={page.items.map(item => [
            auditTime(item.time),
            item.actor || "系统",
            <Badge tone="blue">{item.action || "系统操作"}</Badge>,
            item.detail,
            <span className="small muted">{item.id}</span>
          ])}
        />
        <Pagination pageKey="audit" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note>审计记录保存在当前浏览器。恢复初始演示数据会重置本地记录，不影响项目源码与图片素材。</Note>
    </>
  );
}
