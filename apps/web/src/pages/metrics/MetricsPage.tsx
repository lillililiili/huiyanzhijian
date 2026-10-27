import { useState } from "react";
import { useSyncExternalStore } from "react";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, Recipe, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Field, Select } from "../../ui/Field";
import { HashLink } from "../../ui/HashLink";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { metricFmt, ruleLabel } from "../../ui/format";
import { MetaItem } from "../present";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];

const DEFAULT_DESCRIPTION: Record<MetricId, string> = {
  dg: "铜带屏蔽工序的金属屏蔽搭盖率。搭盖宽度与节距为辅助量测。",
  jx: "以相邻铜丝间隙的平均值对照上限。保留每条原始量测记录。",
  by: "不圆度为设备输入结果；双向外径仅作为辅助数据，不推算全周截面。"
};

const CONSTRAINTS: string[][] = [
  ["金属屏蔽搭盖率", "%", "不低于控制下限", "铜带屏蔽", "以记录绑定的规则快照进行判定"],
  ["铜丝屏蔽相邻铜丝间隙", "mm", "不高于控制上限", "铜丝屏蔽", "平均间隙判定，原始分项间隙保留"],
  ["电缆不圆度", "%", "不高于控制上限", "按规格与工序配置", "直接采用设备不圆度结果，不编造计算公式"]
];

function displayRow(display: unknown, id: string): { decimals?: number; description?: string } {
  if (!display || typeof display !== "object") return {};
  const row = (display as Record<string, unknown>)[id];
  if (!row || typeof row !== "object") return {};
  return row as { decimals?: number; description?: string };
}

function latestRecipe(recipes: readonly Recipe[], id: MetricId) {
  return recipes.filter(recipe => recipe.metric === id && recipe.enabled !== false).at(-1) || recipes.find(recipe => recipe.metric === id);
}

export function MetricsPage({ store, user }: { store: InspectionStore; user: SessionUser }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const [metricId, setMetricId] = useState<MetricId | null>(null);
  const display = state.settings.metricDisplay;

  function openSettings(id: MetricId) {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    setMetricId(id);
  }

  return (
    <>
      <PageTitle title="三项检测指标配置" subtitle="维护三项检测的展示精度与说明；控制阈值由版本化配方管理。" />
      <div className="grid cols-3">
        {METRIC_ORDER.map(id => {
          const metric = METRICS[id];
          const recipe = latestRecipe(state.recipes, id);
          const config = displayRow(display, id);
          const latest = store.stats(store.currentRecords(id)).last;
          const decimals = config.decimals === undefined ? 2 : config.decimals;
          return (
            <Panel key={id} core title={metric.name} tools={<Badge tone="blue">固定检测项目</Badge>}>
              <div className="row" style={{ gap: 20, alignItems: "center" }}>
                <img src={`assets/images/metric-${id}.png`} alt={`${metric.short}专题图标`} style={{ width: 84, height: 84, objectFit: "contain", borderRadius: 16 }} />
                <div>
                  <div className="small muted">当前显示示例</div>
                  <strong style={{ fontSize: 30 }}>{metricFmt(latest?.value, id, display)}</strong>
                  {" "}
                  <span className="muted">{metric.unit}</span>
                </div>
              </div>
              <div className="detail-grid" style={{ marginTop: 25 }}>
                <MetaItem label="指标编码">{id.toUpperCase()}</MetaItem>
                <MetaItem label="显示精度">{decimals} 位小数</MetaItem>
                <MetaItem label="当前控制规则">{ruleLabel(metric, recipe)}</MetaItem>
                <MetaItem label="启用规则版本">{recipe?.version || "—"}</MetaItem>
              </div>
              <p className="small muted" style={{ minHeight: 45, marginTop: 24 }}>{config.description || DEFAULT_DESCRIPTION[id]}</p>
              <div className="toolbar">
                <Button icon="settings" onClick={() => openSettings(id)}>显示设置</Button>
                <HashLink route={`recipes?metric=${id}`}>查看配方</HashLink>
              </div>
            </Panel>
          );
        })}
      </div>
      <Panel core table title="指标使用约束">
        <DataTable headers={["检测项目", "单位", "阈值方向", "适用结构", "数据来源与判定"]} rows={CONSTRAINTS} />
      </Panel>
      <Note>平台仅包含以上三项检测。显示精度仅影响读数展示，不改变原始值、判定结果或历史报告。</Note>
      <MetricEditor store={store} metricId={metricId} onClose={() => setMetricId(null)} />
    </>
  );
}

function MetricEditor({ store, metricId, onClose }: { store: InspectionStore; metricId: MetricId | null; onClose: () => void }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const metric = metricId ? METRICS[metricId] : METRICS.dg;
  const config = metricId ? displayRow(state.settings.metricDisplay, metricId) : {};
  const decimals = config.decimals === undefined ? 2 : config.decimals;

  return (
    <Modal
      title={`${metric.short} · 显示设置`}
      open={metricId !== null}
      onClose={onClose}
      onSubmit={data => {
        if (!metricId) return;
        store.saveMetricDisplay(metricId, { decimals: Number(data.get("decimals")), description: data.get("description") });
        toast("显示设置已保存。");
      }}
    >
      <div key={metricId || "closed"}>
        <Field label="小数位数">
          <Select
            name="decimals"
            value={decimals}
            options={[[0, "0 位"], [1, "1 位"], [2, "2 位"], [3, "3 位"], [4, "4 位"]]}
          />
        </Field>
        <Field label="指标说明">
          <textarea name="description" rows={4} placeholder="记录指标展示与辅助数据说明" aria-label="指标说明" defaultValue={config.description || ""} />
        </Field>
        <Note>阈值判定始终使用原始精度。修改规则请前往“配方与判定规则”。</Note>
      </div>
    </Modal>
  );
}
