import { useState } from "react";
import { useSyncExternalStore } from "react";
import { getViewSnapshot, subscribeView } from "../../app/viewState";
import { canWrite, DENY_WRITE } from "../../auth/permissions";
import { METRICS } from "../../domain/metrics";
import type { InspectionStore } from "../../domain/store";
import type { MetricId, Recipe, SessionUser } from "../../domain/types";
import { Badge } from "../../ui/Badge";
import { Button } from "../../ui/Button";
import { DataTable } from "../../ui/DataTable";
import { Field, Select, TextInput } from "../../ui/Field";
import { FilterForm } from "../../ui/FilterForm";
import { Kpi } from "../../ui/Kpi";
import { Modal } from "../../ui/Modal";
import { Note } from "../../ui/Note";
import { PageTitle } from "../../ui/PageTitle";
import { Pagination, usePagination } from "../../ui/Pagination";
import { Panel } from "../../ui/Panel";
import { toast } from "../../ui/Toast";
import { ruleLabel } from "../../ui/format";

const METRIC_ORDER: MetricId[] = ["dg", "jx", "by"];

function latestRecipe(recipes: readonly Recipe[], id: MetricId) {
  return recipes.filter(recipe => recipe.metric === id && recipe.enabled !== false).at(-1) || recipes.find(recipe => recipe.metric === id);
}

function activeRecipes(recipes: readonly Recipe[]) {
  return METRIC_ORDER.flatMap(id => {
    const recipe = latestRecipe(recipes, id);
    return recipe ? [recipe] : [];
  });
}

export function RecipesPage({ store, user, params }: { store: InspectionStore; user: SessionUser; params: URLSearchParams }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const view = useSyncExternalStore(subscribeView, getViewSnapshot, getViewSnapshot);
  const storedFilters = view.filters.recipes;
  // Empty stored metric is falsy, so ?metric= still applies. History does not do this.
  const chosen = storedFilters?.metric || params.get("metric") || "";
  const metricKey = `metric:${storedFilters ? "stored" : "open"}:${chosen}:${view.revision}`;
  const [editor, setEditor] = useState<null | { kind: "new" } | { kind: "edit"; id: string }>(null);
  const rows = state.recipes.filter(recipe => !chosen || recipe.metric === chosen).slice().reverse();
  const page = usePagination(rows, "recipes", 8, state.settings.pageSize);

  function openNew() {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    if (!activeRecipes(store.getState().recipes).length) {
      toast("未找到基础配方。");
      return;
    }
    setEditor({ kind: "new" });
  }

  function openEdit(id: string) {
    if (!canWrite(user)) {
      toast(DENY_WRITE);
      return;
    }
    const recipes = store.getState().recipes;
    if (!recipes.some(recipe => recipe.id === id)) {
      if (!activeRecipes(recipes).length) {
        toast("未找到基础配方。");
        return;
      }
      setEditor({ kind: "new" });
      return;
    }
    setEditor({ kind: "edit", id });
  }

  return (
    <>
      <PageTitle
        title="配方与判定规则"
        subtitle="每次修改生成新版本；历史任务与记录保留当时的规则快照。"
        actions={<Button primary icon="plus" onClick={openNew}>创建配方新版本</Button>}
      />
      <FilterForm id="recipes">
        {() => (
          <Field label="检测项目">
            <Select
              key={metricKey}
              name="metric"
              value={chosen}
              options={[["", "全部三项检测"], ...Object.values(METRICS).map(metric => [metric.id, metric.short] as const)]}
            />
          </Field>
        )}
      </FilterForm>
      <div className="grid cols-3">
        {METRIC_ORDER.map(id => {
          const metric = METRICS[id];
          const recipe = latestRecipe(state.recipes, id);
          return (
            <Kpi
              key={id}
              label={`${metric.short} · 当前规则`}
              value={ruleLabel(metric, recipe)}
              note={recipe ? `${recipe.version} · ${recipe.name}` : "未配置"}
              icon={metric.icon || "adjustments"}
              tone={id === "by" ? "green" : "blue"}
            />
          );
        })}
      </div>
      <Panel core table={page.items.length > 0} title="规则版本记录">
        <DataTable
          headers={["配方名称", "检测项目", "规则版本", "控制阈值", "版本状态", "关联任务", "操作"]}
          rows={page.items.map(recipe => {
            const metric = METRICS[recipe.metric];
            const current = recipe.enabled !== false;
            const linked = state.tasks.filter(task => task.recipeId === recipe.id).length;
            return [
              recipe.name || `${metric.short}规则`,
              metric.name,
              recipe.version,
              <strong key={recipe.id}>{ruleLabel(metric, recipe)}</strong>,
              <Badge key={`${recipe.id}-state`} tone={current ? "green" : "gray"}>{current ? "当前版本" : "历史版本"}</Badge>,
              `${linked} 项`,
              <Button key={`${recipe.id}-edit`} onClick={() => openEdit(recipe.id)}>派生新版本</Button>
            ];
          })}
        />
        <Pagination pageKey="recipes" total={page.total} page={page.page} pages={page.pages} pageSize={page.pageSize} />
      </Panel>
      <Note tone="amber">边界值等于阈值时符合规则。新版本用于后续创建的任务；进行中的任务、已完成任务、报警与报告不追溯改判。</Note>
      {editor ? <RecipeEditor store={store} mode={editor} onClose={() => setEditor(null)} /> : null}
    </>
  );
}

function RecipeEditor({
  store,
  mode,
  onClose
}: {
  store: InspectionStore;
  mode: { kind: "new" } | { kind: "edit"; id: string };
  onClose: () => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const active = activeRecipes(state.recipes);
  const existing = mode.kind === "edit" ? state.recipes.find(recipe => recipe.id === mode.id) : undefined;
  const fallback = existing || active[0];
  const [baseId, setBaseId] = useState(fallback?.id || "");
  const chosen = state.recipes.find(recipe => recipe.id === baseId) || fallback;
  if (!chosen) return null;
  const metric = METRICS[chosen.metric];
  const bound = chosen.operator === ">=" ? "下限" : "上限";

  return (
    <Modal
      title="创建配方新版本"
      open
      submitLabel="创建新版本"
      onClose={onClose}
      onSubmit={data => {
        const base = store.recipe(String(data.get("baseId") || ""));
        if (!base) throw new Error("所选基础配方不存在。");
        const threshold = Number(data.get("threshold"));
        const unit = METRICS[base.metric].unit;
        if (!Number.isFinite(threshold) || threshold < 0 || (unit === "%" && threshold > 100)) {
          throw new Error("百分比阈值须在 0–100 范围，间隙阈值须为非负数。");
        }
        const note = String(data.get("note") || "").trim();
        store.reviseRecipe(base.id, {
          name: String(data.get("name") || "").trim(),
          threshold,
          operator: base.operator,
          description: note,
          enabled: true
        });
        toast("新版本已创建，历史规则保持不变。");
      }}
    >
      {existing ? (
        <>
          <input type="hidden" name="baseId" value={existing.id} />
          <Note>{`${METRICS[existing.metric].name} · 基于 ${existing.version} 派生`}</Note>
        </>
      ) : (
        <Field label="基于已有配方">
          <Select
            name="baseId"
            value={chosen.id}
            options={active.map(recipe => [recipe.id, `${METRICS[recipe.metric].name} · ${recipe.version}`] as const)}
            onChange={event => setBaseId(event.target.value)}
          />
        </Field>
      )}
      <Field label="新版本名称">
        <TextInput key={`${chosen.id}-name`} name="name" value={chosen.name || `${metric.short}控制规则`} placeholder="填写配方名称" required />
      </Field>
      <Field label={`控制阈值 / ${metric.unit}（${bound}）`}>
        <TextInput key={`${chosen.id}-threshold`} name="threshold" type="number" value={chosen.threshold} placeholder="输入非负数值" required step="any" />
      </Field>
      <Field label="变更说明">
        <textarea name="note" rows={4} required placeholder="记录本次规则变更依据" aria-label="变更说明" defaultValue="" />
      </Field>
      <Note tone="amber">阈值单位和比较方向由所选检测项目固定。新版本不会覆盖任何历史记录。</Note>
    </Modal>
  );
}
