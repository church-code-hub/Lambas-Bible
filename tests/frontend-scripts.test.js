const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontendRoot = path.join(__dirname, "..", "Frontend");
const scriptOrder = [
  "app-state.js",
  "app-i18n.js",
  "app-core.js",
  "app-offline.js",
  "app-views.js",
  "app-auth.js",
  "app-scanner-search.js",
  "app-cards-admin.js",
];

test("loads frontend scripts in dependency order as classic scripts and precaches each file", () => {
  const html = fs.readFileSync(path.join(frontendRoot, "index.html"), "utf8");
  const serviceWorker = fs.readFileSync(path.join(frontendRoot, "sw.js"), "utf8");
  const loadedScripts = Array.from(
    html.matchAll(/<script\b([^>]*?)src="\.\/js\/(app-[^"]+\.js)(?:\?[^"]*)?"([^>]*)><\/script>/g),
  );

  assert.deepEqual(
    loadedScripts.map((match) => match[2]),
    scriptOrder,
    "script order must preserve shared globals and deferred initialization",
  );
  for (const [, before, script, after] of loadedScripts) {
    assert.doesNotMatch(`${before} ${after}`, /\b(?:async|defer|type\s*=\s*["']module)/i);
    assert.equal(fs.existsSync(path.join(frontendRoot, "js", script)), true);
    assert.equal(serviceWorker.includes(`"./js/${script}?v=`), true);
  }
  assert.equal(fs.existsSync(path.join(frontendRoot, "js", "app.js")), false);
});

test("split classic scripts retain shared state and inline-handler functions", () => {
  const browserContext = vm.createContext({
    window: { LAMBAS_CONFIG: {}, addEventListener() {} },
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
  });

  for (const script of scriptOrder) {
    const source = fs.readFileSync(path.join(frontendRoot, "js", script), "utf8");
    vm.runInContext(source, browserContext, { filename: script });
  }

  assert.equal(vm.runInContext("typeof translations", browserContext), "object");
  assert.equal(vm.runInContext("typeof currentUser", browserContext), "object");
  assert.equal(vm.runInContext("typeof executeSearch", browserContext), "function");
  assert.equal(vm.runInContext("typeof openAppSettings", browserContext), "function");
  assert.equal(vm.runInContext("typeof saveScheduleSettings", browserContext), "function");
});
