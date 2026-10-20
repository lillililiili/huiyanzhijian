import { useState } from "react";
import { useSyncExternalStore } from "react";
import { navigate } from "../../app/hashRoute";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, SessionUser, Spec } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Empty } from "../../ui/Empty";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm, useViewFilters } from "../../ui/FilterForm";
import { HashLink } from "../../ui/HashLink";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { ruleLabel } from "../../ui/format";
import { MetricHero } from "../present";
import { refuseReadonly } from "../writeGuard";

const VOLTAGES = [35, 66, 110, 220] as const;

export function SpecsPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const filters = useViewFilters("specs");
  const [editor, setEditor] = useState<string | null>(null);
  const rows = state.specs.filter(spec => (
    (!filters.query || spec.id.toLowerCase().includes(filters.query.toLowerCase()))
    && (!filters.voltage || String(spec.voltage) === filters.voltage)
    && (!filters.area || String(spec.area) === filters.area)
    && (!filters.enabled || String(spec.enabled) === filters.enabled)
  ));
  const requested = params.get("id");
  const selected = (requested ? state.specs.find(spec => spec.id === requested) : undefined) || rows[0];
  const areas = Array.from(new Set(state.specs.map(spec => spec.area))).sort((a, b) => a - b);

  function openEditor(id: string) {
    if (refuseReadonly(user)) return;
    setEditor(id);
  }

  return (
    <>
      <PageTitle
        title="高压电缆产品规格档案"
        subtitle="仅管理35–220kV高压电缆；检测项目按实际屏蔽结构和工序配置。"
        actions={<Button primary icon="plus" onClick={() => openEditor("")}>新增规格</Button>}
      />
      <FilterForm id="specs">
        {current => (
          <>
            <Field label="规格编号">
              <TextInput name="query" value={current.query || ""} placeholder="输入规格编号" />
            </Field>
            <Field label="电压等级">
              <Select name="voltage" value={current.voltage || ""} options={[["", "35 / 66 / 110 / 220kV"], ...VOLTAGES.map(voltage => [voltage, `${voltage}kV`] as const)]} />
            </Field>
            <Field label="导体截面积">
              <Select name="area" value={current.area || ""} options={[["", "全部截面积"], ...areas.map(area => [area, `${area}mm²`] as const)]} />
            </Field>
            <Field label="启用状态">
              <Select name="enabled" value={current.enabled || ""} options={[["", "全部状态"], ["true", "启用"], ["false", "停用"]]} />
            </Field>
          </>
        )}
      </FilterForm>
      <div className="split">
        <Panel core table={rows.length > 0} title="规格列表" tools={<span className="muted small">{rows.length} 项规格</span>}>
          {rows.length ? (
            <DataTable
              headers={["规格编号", "电压等级", "芯数 × 截面积", "屏蔽结构", "适用检测项目", "状态", "操作"]}
              rows={rows.map(spec => [
                <HashLink route={`specs?id=${encodeURIComponent(spec.id)}`}>{spec.id}</HashLink>,
                `${spec.voltage}kV`,
                `${spec.cores || 1}×${spec.area}mm²`,
                spec.structure === "tape" ? "铜带屏蔽" : "铜丝屏蔽",
                spec.metrics.map(metric => METRICS[metric].short).join(" / "),
                <Badge tone={spec.enabled ? "green" : "gray"}>{spec.enabled ? "启用" : "停用"}</Badge>,
                <Button onClick={() => openEditor(spec.id)}>编辑</Button>
              ])}
            />
          ) : <Empty text="没有匹配的规格" />}
        </Panel>
        <Panel core title="选中规格详情">
          {selected ? <SpecDetail spec={selected} /> : <Empty text="请选择产品规格" />}
        </Panel>
      </div>
      <Panel core table title="三项检测规则与适用关系" tools={<span className="muted small">阈值为演示规则 · 适用性按规格配置</span>}>
        <DataTable
          headers={["检测项目", "演示规则版本", "量测指标", "演示阈值", "当前规格适用性"]}
          rows={Object.values(METRICS).map(metric => {
            const recipe = state.recipes.find(item => item.metric === metric.id && item.enabled);
            const applicable = Boolean(selected?.metrics.includes(metric.id));
            return [
              metric.name,
              recipe?.id || "—",
              metric.short,
              ruleLabel(metric, recipe),
              <Badge tone={applicable ? "green" : "gray"}>{applicable ? "本规格适用" : "本规格不适用"}</Badge>
            ];
          })}
        />
      </Panel>
      <p className="muted small">本页为产品规格管理原型，不表示单台检测硬件覆盖全部规格；实际适用范围需结合设备量程与工艺确认。</p>
      <SpecEditor store={store} specId={editor} onClose={() => setEditor(null)} />
    </>
  );
}

function SpecDetail({ spec }: { spec: Spec }) {
  return (
    <>
      <div className="row">
        <strong className="text-blue">{spec.id}</strong>
        <div className="spacer" />
        <Badge tone={spec.enabled ? "green" : "gray"}>{spec.enabled ? "启用" : "停用"}</Badge>
      </div>
      <div className="core-spec-hero">
        <MetricHero value={spec.voltage} unit={`kV　${spec.cores || 1}×${spec.area}mm²`} />
      </div>
      <div className="key-value"><span>检测对象</span><span>高压电缆</span></div>
      <div className="key-value"><span>屏蔽结构</span><span>{spec.structure === "tape" ? "铜带屏蔽" : "铜丝屏蔽"}</span></div>
      <div className="key-value"><span>产品类型</span><span>交联聚乙烯绝缘电缆</span></div>
      <div className="key-value"><span>客户规格代号</span><span>{spec.customerCode || `HV-${spec.voltage}-${spec.area}`}</span></div>
      <p className="muted">本规格适用项目</p>
      <div className="toolbar">
        {spec.metrics.map(metric => <Badge key={metric} tone="blue">{METRICS[metric].name}</Badge>)}
      </div>
      <p className="muted small">检测项目按照屏蔽结构与生产工序配置，不默认全部适用。</p>
    </>
  );
}

function SpecEditor({ store, specId, onClose }: { store: InspectionStore; specId: string | null; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const current = specId ? state.specs.find(spec => spec.id === specId) : undefined;
  const draft = current ?? { id: "", voltage: 35, area: 400, cores: 1, structure: "tape" as const, metrics: ["dg", "by"] as MetricId[], enabled: true };

  return (
    <Modal
      title={current ? "编辑产品规格" : "新增产品规格"}
      open={specId !== null}
      onClose={onClose}
      onSubmit={data => {
        const metrics = data.getAll("metrics").map(item => String(item));
        const saved = store.saveSpec({
          id: data.get("id"),
          voltage: data.get("voltage"),
          area: data.get("area"),
          cores: data.get("cores"),
          structure: data.get("structure"),
          metrics,
          enabled: data.get("enabled"),
          update: Boolean(current)
        });
        toast("产品规格已保存");
        navigate(`specs?id=${encodeURIComponent(saved.id)}`);
      }}
    >
      <div className="grid cols-2" key={current?.id || "new"}>
        <Field label="规格编号">
          <TextInput name="id" value={draft.id} required readOnly={Boolean(current)} />
        </Field>
        <Field label="电压等级">
          <Select name="voltage" value={draft.voltage} options={VOLTAGES.map(voltage => [voltage, `${voltage}kV`] as const)} />
        </Field>
        <Field label="导体截面积 / mm²">
          <TextInput name="area" type="number" value={draft.area} required min="1" step="1" />
        </Field>
        <Field label="芯数">
          <TextInput name="cores" type="number" value={draft.cores} required min="1" max="10" step="1" />
        </Field>
        <Field label="屏蔽结构">
          <Select name="structure" value={draft.structure} options={[["tape", "铜带屏蔽"], ["wire", "铜丝屏蔽"]]} />
        </Field>
        <Field label="启用状态">
          <Select name="enabled" value={String(draft.enabled)} options={[["true", "启用"], ["false", "停用"]]} />
        </Field>
      </div>
      <div className="field">
        <label>适用检测项目</label>
        <div className="stack" style={{ gap: 12 }}>
          {Object.values(METRICS).map(metric => (
            <label className="checkbox" key={metric.id}>
              <input type="checkbox" name="metrics" value={metric.id} defaultChecked={draft.metrics.includes(metric.id)} />
              {metric.name}
            </label>
          ))}
        </div>
      </div>
      <Note>铜带屏蔽可配置搭盖率；铜丝屏蔽可配置相邻铜丝间隙。不圆度可独立配置。至少选一个项目。</Note>
    </Modal>
  );
}
