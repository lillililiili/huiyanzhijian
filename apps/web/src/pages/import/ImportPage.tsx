import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import {
  assertImportRowCount,
  assertImportSize,
  buildImportTemplate,
  parseImportCsv,
  toImportPayload,
  validateImportRows
} from "../../domain/csv";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { ImportResult, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Drawer } from "../../ui/Drawer";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { Icon } from "../../ui/Icon";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { notifyFailure, toast } from "../../ui/Toast";
import { downloadFile } from "../../ui/download";
import { fmt, metricFmt } from "../../ui/format";
import { refuseReadonly } from "../writeGuard";
import { getImportPreview, setImportPreview, subscribeImportPreview } from "./importPreview";

export function ImportPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const preview = useSyncExternalStore(subscribeImportPreview, getImportPreview, getImportPreview);
  const [manualOpen, setManualOpen] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const passed = preview ? preview.rows.filter(row => row.errors.length === 0) : [];

  function taskMetric(taskId: string) {
    return store.getState().tasks.find(task => task.id === taskId)?.metric;
  }

  async function readFile() {
    const input = document.querySelector<HTMLInputElement>("#core-import-file");
    const file = input?.files?.[0];
    try {
      if (!file) throw new Error("请先选择 CSV 文件");
      assertImportSize(file.size);
      const rows = parseImportCsv(await file.text());
      assertImportRowCount(rows.length);
      setImportPreview({ name: file.name, rows: validateImportRows(rows, taskMetric) });
      toast("文件校验完成，请查看预览");
    } catch (error) {
      notifyFailure(error);
    }
  }

  function downloadTemplate() {
    const tasks = store.getState().tasks;
    const task = tasks.find(item => item.status === "running") || tasks[0];
    if (!task) return;
    downloadFile("慧眼智检-检测数据导入模板.csv", buildImportTemplate(task), "text/csv;charset=utf-8");
  }

  function savePassed() {
    if (refuseReadonly(user)) return;
    const current = getImportPreview();
    try {
      if (!current) throw new Error("暂无待保存的记录");
      const accepted = current.rows.filter(row => row.errors.length === 0);
      if (!accepted.length) throw new Error("没有校验通过的记录，请修正后重新导入");
      assertImportRowCount(accepted.length);
      const result = store.importRecords(accepted.map(row => toImportPayload(row)));
      toast(`已保存 ${result.count} 条记录${result.errors.length ? `，${result.errors.length} 条被拒绝` : ""}`);
      if (result.errors.length) setImportResult(result);
      setImportPreview(null);
    } catch (error) {
      notifyFailure(error);
    }
  }

  return (
    <>
      <PageTitle title="数据导入与补录" subtitle="校验数据结构、任务关联与量测有效性；原始记录保留来源，补录操作可追溯。" />
      <div className="split">
        <Panel core title="批量导入">
          <div className="upload-zone">
            <div className="stat-icon blue" style={{ margin: "0 auto" }}>
              <Icon name="upload" size={30} />
            </div>
            <h3>导入检测数据 CSV</h3>
            <p className="muted">先校验，再保存；仅接受三项检测记录，并绑定已存在的任务。</p>
            <input id="core-import-file" type="file" accept=".csv,text/csv" aria-label="选择检测记录 CSV 文件" />
            <div className="toolbar" style={{ justifyContent: "center", marginTop: 18 }}>
              <Button primary icon="upload" onClick={() => { void readFile(); }}>读取并校验文件</Button>
              <Button icon="download" onClick={downloadTemplate}>下载 CSV 模板</Button>
            </div>
          </div>
        </Panel>
        <Panel core title="人工补录">
          <p className="muted">用于补充单条有效量测或标记缺失数据。补录来源和操作日志自动保留。</p>
          <Button primary icon="plus" onClick={() => { if (!refuseReadonly(user)) setManualOpen(true); }}>新增一条补录</Button>
          <div className="key-value" style={{ marginTop: 24 }}><span>允许的检测项目</span><span>搭盖率 / 铜丝间隙 / 不圆度</span></div>
          <div className="key-value"><span>关联方式</span><span>任务 → 盘号 / 工单 / 设备</span></div>
          <div className="key-value"><span>历史规则</span><span>使用任务冻结的规则快照</span></div>
          <div className="key-value"><span>MES同步</span><span>补录后待同步，可在同步监控重试</span></div>
        </Panel>
      </div>
      <Panel core table={Boolean(preview)} title="导入校验预览">
        {preview ? (
          <>
            <div className="row" style={{ marginBottom: 18 }}>
              <Badge tone="blue">{`${preview.rows.length} 条待导入`}</Badge>
              <Badge tone="green">{`${passed.length} 条通过`}</Badge>
              <Badge tone={preview.rows.length === passed.length ? "gray" : "red"}>{`${preview.rows.length - passed.length} 条错误`}</Badge>
              <span className="muted small">{preview.name}</span>
              <div className="spacer" />
              <Button primary icon="check" onClick={savePassed}>保存校验通过的记录</Button>
              <Button onClick={() => setImportPreview(null)}>清空</Button>
            </div>
            <DataTable
              headers={["CSV行", "关联任务", "检测项目", "时间", "米数 / m", "实测值", "校验结果"]}
              rows={preview.rows.slice(0, 100).map(row => [
                row._row,
                row.taskId,
                row.metric,
                row.time,
                fmt(row.meter, 1),
                metricFmt(row.value, row.metric),
                row.errors.length ? <span className="text-red">{row.errors.join("；")}</span> : <Badge tone="green">可导入</Badge>
              ])}
            />
            {preview.rows.length > 100 ? <Note>预览仅展示前100行；保存处理全部校验通过的记录。</Note> : null}
          </>
        ) : <Empty text="选择 CSV 文件或新增补录，校验结果将在这里展示" />}
      </Panel>
      <Note>无效或缺失量测以“无效数据”保存，实测值不替换为 0，不参与阈值与统计计算。导入不覆盖已有原始记录。</Note>
      <Modal
        title="补录检测数据"
        open={manualOpen}
        submitLabel="校验并预览"
        onClose={() => setManualOpen(false)}
        onSubmit={data => {
          const raw = String(data.get("time") || "").replace("T", " ");
          const time = raw.length === 16 ? `${raw}:00` : raw;
          const checked = validateImportRows([{
            _row: 1,
            fields: {
              taskId: String(data.get("taskId") || ""),
              metric: String(data.get("metric") || ""),
              time,
              meter: String(data.get("meter") || ""),
              value: String(data.get("value") || ""),
              validity: String(data.get("validity") || "valid")
            }
          }], taskMetric);
          if (checked[0].errors.length) throw new Error(checked[0].errors.join("；"));
          setImportPreview({ name: "人工补录", rows: checked });
          toast("补录已校验，请在预览中保存");
          navigate("import");
        }}
      >
        <div className="grid cols-2">
          <Field label="关联任务">
            <Select name="taskId" value={state.tasks[0]?.id || ""} options={state.tasks.map(task => [task.id, `${task.id} · ${METRICS[task.metric].short}`] as const)} />
          </Field>
          <Field label="检测项目">
            <Select name="metric" value="dg" options={Object.values(METRICS).map(metric => [metric.id, metric.name] as const)} />
          </Field>
          <Field label="记录时间">
            <TextInput name="time" type="datetime-local" value="2026-10-09T14:31" step="1" required />
          </Field>
          <Field label="米数位置 / m">
            <TextInput name="meter" type="number" value="1240" min="0" step="0.1" required />
          </Field>
          <Field label="实测值（无效数据可留空）">
            <TextInput name="value" type="number" step="0.01" min="0" value="" />
          </Field>
          <Field label="数据有效性">
            <Select name="validity" value="valid" options={[["valid", "有效数据"], ["invalid", "无效 / 缺失数据"]]} />
          </Field>
        </div>
        <Note>选择的检测项目须与任务一致，单位随项目确定：搭盖率 %、铜丝间隙 mm、不圆度 %。</Note>
      </Modal>
      <Drawer title="导入结果" open={importResult !== null} onClose={() => setImportResult(null)}>
        {importResult ? (
          <>
            <Note tone="amber">{`成功 ${importResult.count} 条，失败 ${importResult.errors.length} 条。`}</Note>
            <ul>
              {importResult.errors.map(error => (
                <li key={`${error.row}-${error.line}`}>提交序号 {error.row} · line {error.line} · {error.message}</li>
              ))}
            </ul>
          </>
        ) : null}
      </Drawer>
    </>
  );
}
