import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Button } from "./Button";
import { Drawer } from "./Drawer";
import { Field, Select, TextInput } from "./Field";
import { HashLink } from "./HashLink";
import { Icon } from "./Icon";
import { directIconNames, iconFileName, iconMap } from "./iconMap";
import { Modal } from "./Modal";
import { Note } from "./Note";
import { ToastViewport } from "./Toast";

const here = path.dirname(fileURLToPath(import.meta.url));
const iconDir = path.resolve(here, "../../public/assets/icons");
const sourceDir = path.resolve(here, "../../../../慧眼智检-原生原型/assets/icons");

test("icon markup uses a mask url and stays free of inline svg", () => {
  const html = renderToStaticMarkup(createElement(Icon, { name: "shield", size: 27 }));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /shield-check\.svg/);
  assert.match(html, /width:27px/);
  assert.equal(html.includes("<svg"), false);
  assert.equal(iconFileName("shield"), "shield-check");
  assert.equal(iconFileName("box"), "box");
  assert.equal(iconFileName("../secret"), "activity");
});

test("button and hash link keep real controls without a global action", () => {
  const button = renderToStaticMarkup(createElement(Button, { primary: true, icon: "check", disabled: true, children: "保存" }));
  assert.match(button, /class="btn primary"/);
  assert.match(button, /type="button"/);
  assert.match(button, /disabled=""/);
  assert.match(button, /check\.svg/);
  assert.match(button, /width:17px/);
  assert.equal(button.includes("data-action"), false);
  assert.equal(button.includes("<svg"), false);

  const link = renderToStaticMarkup(createElement(HashLink, { route: "task?id=T1", children: "<img alt=\"x\">" }));
  assert.match(link, /href="#task\?id=T1"/);
  assert.match(link, /&lt;img alt=&quot;x&quot;&gt;/);
  assert.equal(link.includes("<img"), false);
});

test("field, note, and toast match the prototype markup", () => {
  const form = renderToStaticMarkup(createElement(Field, {
    label: "处理状态",
    children: createElement(Select, { name: "status", value: "resolved", options: [["processing", "处理中"], ["resolved", "已处理"]] })
  }));
  assert.match(form, /class="field"/);
  assert.match(form, /处理状态/);
  assert.match(form, /aria-label="status"/);
  assert.match(form, /<option value="resolved" selected="">已处理<\/option>/);
  const decimals = renderToStaticMarkup(createElement(Select, {
    name: "decimals",
    value: 2,
    options: [[0, "0 位"], [2, "2 位"]]
  }));
  assert.match(decimals, /<option value="2" selected="">2 位<\/option>/);

  const input = renderToStaticMarkup(createElement(TextInput, { name: "actor", value: "质量管理员", placeholder: "填写处置人" }));
  assert.match(input, /aria-label="填写处置人"/);
  assert.match(input, /value="质量管理员"/);
  assert.match(input, /name="actor"/);

  const note = renderToStaticMarkup(createElement(Note, { children: "当前会话仅用于演示" }));
  assert.match(note, /class="note blue"/);
  assert.match(note, /shield-check\.svg/);
  assert.match(note, /当前会话仅用于演示/);

  const toast = renderToStaticMarkup(createElement(ToastViewport));
  assert.match(toast, /id="toast-root"/);
  assert.equal(toast.includes("role=\"status\""), false);
});

test("closed dialogs render nothing", () => {
  const modal = renderToStaticMarkup(createElement(Modal, {
    title: "联系管理员",
    open: false,
    onClose: () => undefined,
    onSubmit: () => undefined,
    children: "正文"
  }));
  const drawer = renderToStaticMarkup(createElement(Drawer, {
    title: "当前账户",
    open: false,
    onClose: () => undefined,
    children: "正文"
  }));
  assert.equal(modal, "");
  assert.equal(drawer, "");
});

test("copied icons are the used set and match the prototype bytes", () => {
  const expected = [...new Set([...Object.values(iconMap), ...directIconNames])].sort();
  const actual = readdirSync(iconDir).filter(name => name.endsWith(".svg")).map(name => name.slice(0, -4)).sort();
  assert.deepEqual(actual, expected);
  for (const name of expected) {
    const source = readFileSync(path.join(sourceDir, `${name}.svg`));
    const copy = readFileSync(path.join(iconDir, `${name}.svg`));
    assert.equal(createHash("sha256").update(source).digest("hex"), createHash("sha256").update(copy).digest("hex"), name);
  }
});
