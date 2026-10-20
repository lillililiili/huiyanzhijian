import assert from "node:assert/strict";
import test from "node:test";
import { memoryPersistence } from "../persistence/memoryPersistence";
import { detectionContext, detectionRows } from "./detectionWindow";
import { createStore, type InspectionStore } from "./store";

function store() {
  return createStore({ persistence: memoryPersistence() });
}

function replaceRunningDg(source: InspectionStore) {
  source.completeTask("T20261009001");
  const recipe = source.getState().recipes.find(item => item.metric === "dg" && item.enabled);
  assert.ok(recipe);
  const task = source.createTask({
    workOrder: "WO-REGRESSION",
    reelId: "P-REGRESSION",
    specId: "SP035-400",
    metric: "dg",
    deviceId: "HY-DG-01",
    recipeId: recipe.id,
    plannedLength: 1000
  });
  source.startTask(task.id);
  return task;
}

test("the default dg window is the current task's own 30 rows", () => {
  const source = store();
  const context = detectionContext(source.getState(), new URLSearchParams("metric=dg"));
  assert.equal(context.task?.id, "T20261009001");
  assert.equal(context.records.length, 30);
  assert.ok(context.records.every(record => record.taskId === "T20261009001"));
  assert.equal(context.records.at(-1)?.value, 12.36);
  const end = context.records.at(-1)?.time || "";
  assert.ok(context.records.every(record => record.time <= end));
});

test("an empty running task does not keep the previous 12.36 window", () => {
  const source = store();
  const task = replaceRunningDg(source);
  const context = detectionContext(source.getState(), new URLSearchParams("metric=dg"));
  assert.equal(context.task?.id, task.id);
  assert.equal(context.records.length, 0);
  assert.equal(detectionRows(source.getState().records, task).some(record => record.value === 12.36), false);
  const explicit = detectionContext(source.getState(), new URLSearchParams("metric=dg&task=T20261009001"));
  assert.equal(explicit.task?.id, "T20261009001");
  assert.equal(explicit.records.length, 30);
});

test("one new sample stays on that task and an unknown metric still resolves dg", () => {
  const source = store();
  const task = replaceRunningDg(source);
  source.advanceTask(task.id);
  const selected = detectionContext(source.getState(), new URLSearchParams(`metric=dg&task=${task.id}`));
  assert.equal(selected.records.length, 1);
  assert.equal(selected.records[0].taskId, task.id);
  const unknown = detectionContext(source.getState(), new URLSearchParams("metric=foo"));
  assert.equal(unknown.metric.id, "dg");
  assert.equal(unknown.task?.id, task.id);
  assert.equal(unknown.missing, false);
});

test("a missing task is empty and a blank task parameter falls back", () => {
  const source = store();
  const missing = detectionContext(source.getState(), new URLSearchParams("task=NO-SUCH-TASK"));
  assert.equal(missing.missing, true);
  assert.equal(missing.task, null);
  assert.equal(missing.records.length, 0);
  const blank = detectionContext(source.getState(), new URLSearchParams("metric=jx&task="));
  assert.equal(blank.missing, false);
  assert.equal(blank.task?.metric, "jx");
  assert.equal(blank.task?.status, "running");
});
