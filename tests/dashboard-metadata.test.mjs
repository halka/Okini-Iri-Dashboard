import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

// Run the actual dashboard module with a minimal DOM and controlled network timing.
function dashboard() {
  const elements = new Map();
  const controls = new Map();
  const pending = [];
  function element() {
    const listeners = new Map();
    return {
      value: "", textContent: "", innerHTML: "", dataset: {}, disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(name, handler) { listeners.set(name, handler); },
      emit(name) { listeners.get(name)?.({ currentTarget: this, target: this }); },
      querySelector() { return element(); }, querySelectorAll() { return []; },
      setAttribute() {}, removeAttribute() {}, toggleAttribute() {}, focus() {},
      showModal() {}, reset() {}
    };
  }
  const byId = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const control = name => {
    if (!controls.has(name)) controls.set(name, element());
    return controls.get(name);
  };
  const modules = {
    "../lib/text-encoding": {},
    "./lib/api-client": {
      requestBookmarks: async () => [],
      requestJson: path => path === "/api/metadata"
        ? new Promise(resolve => pending.push(resolve))
        : Promise.resolve({ tags: [] })
    },
    "./lib/dom": { byId, formControl: (_form, name) => control(name) },
    "./lib/format": {
      hasUrlCredentials: () => false, faviconMarkup: () => "", setupFaviconFallbacks() {},
      escapeHtml: value => value, escapeAttribute: value => value
    },
    "./lib/i18n-controller": { I18nController: class { locale = "en"; t(key) { return key; } apply() {} } },
    "./lib/structured-preview": {},
    "./lib/theme-controller": { ThemeController: class { media = { addEventListener() {} }; current() { return "light"; } apply() {} } }
  };
  const context = vm.createContext({
    exports: {}, require: name => modules[name], URLSearchParams, AbortController, DOMException,
    document: { documentElement: { dataset: {} }, querySelector: () => null },
    window: { clearTimeout() {}, setTimeout: () => 1, addEventListener() {} }, requestAnimationFrame: callback => callback()
  });
  const source = readFileSync(new URL("../src/scripts/dashboard.ts", import.meta.url), "utf8");
  vm.runInContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context);
  return { context, byId, control, pending };
}

test("a stale metadata result cannot replace the URL typed during its request", async () => {
  const app = dashboard();
  app.control("url").value = "https://old.example/";
  const request = vm.runInContext("fillMetadata(true)", app.context);
  app.control("url").value = "https://new.example/";
  app.control("url").emit("input");
  app.pending.shift()({ metadata: { url: "https://old.example/", title: "Old", description: "Old", faviconUrl: "" } });
  await request;
  assert.equal(app.control("url").value, "https://new.example/");
  assert.equal(app.control("title").value, "");
});

test("an old request cannot re-enable Fetch while a newer request is pending", async () => {
  const app = dashboard();
  app.control("url").value = "https://old.example/";
  const first = vm.runInContext("fillMetadata(true)", app.context);
  app.control("url").value = "https://new.example/";
  const second = vm.runInContext("fillMetadata(true)", app.context);
  app.pending.shift()({ metadata: { url: "https://old.example/", title: "Old", description: "", faviconUrl: "" } });
  await first;
  assert.equal(app.byId("fetchMetadataButton").disabled, true);
  app.pending.shift()({ metadata: { url: "https://new.example/", title: "New", description: "", faviconUrl: "" } });
  await second;
  assert.equal(app.byId("fetchMetadataButton").disabled, false);
  assert.equal(app.control("title").value, "New");
});
