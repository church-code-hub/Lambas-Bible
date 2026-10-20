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

test("offline name lookup and selected sync batches preserve queue order", () => {
  const browserContext = vm.createContext({
    window: {},
    navigator: {},
    sessionStorage: { getItem: () => "" },
    localStorage: { getItem: () => null },
  });
  for (const script of ["app-state.js", "app-i18n.js", "app-offline.js"]) {
    vm.runInContext(
      fs.readFileSync(path.join(frontendRoot, "js", script), "utf8"),
      browserContext,
      { filename: script },
    );
  }
  vm.runInContext("currentLang = 'en'", browserContext);

  const result = vm.runInContext(`(() => {
    const account = "admin@example.com";
    const queue = [
      { eventId: "scan-1", type: "scan", queuedBy: account },
      { eventId: "scan-2", type: "scan", queuedBy: account },
      { eventId: "add-1", type: "add_student", queuedBy: account },
      { eventId: "scan-3", type: "scan", queuedBy: account },
    ];
    const roster = [
      { id: "001", name: "Attendee One" },
      { id: "002", name: "Attendee Two" },
    ];
    return {
      foundName: findCachedPersonName([{ id: "001", name: "Attendee One" }], "001"),
      missingName: findCachedPersonName([{ id: "1", name: "Attendee One" }], "unknown"),
      exactCachedSearch: searchCachedRoster(roster, "Attendee One"),
      fuzzyCachedSearch: searchCachedRoster(roster, "Attendee On"),
      individualLater: getOfflineSyncBatch(queue, "scan-2", "", account),
      individualFirst: getOfflineSyncBatch(queue, "scan-1", "", account),
      scanGroup: getOfflineSyncBatch(queue, "", "scan", account),
      addGroupBlocked: getOfflineSyncBatch(queue, "", "add_student", account),
      addDescription: offlineEventDescription({
        type: "add_student", name: "New Attendee", attendIfOpen: false,
      }),
    };
  })()`, browserContext);

  assert.equal(result.foundName, "Attendee One");
  assert.equal(result.missingName, "");
  assert.equal(result.exactCachedSearch.status, "exact_match");
  assert.equal(result.exactCachedSearch.id, "001");
  assert.equal(result.fuzzyCachedSearch.status, "suggestions");
  assert.deepEqual(Array.from(result.fuzzyCachedSearch.matches, (person) => person.id), ["001"]);
  assert.equal(result.individualLater, null);
  assert.deepEqual(Array.from(result.individualFirst, (event) => event.eventId), ["scan-1"]);
  assert.deepEqual(Array.from(result.scanGroup, (event) => event.eventId), ["scan-1", "scan-2"]);
  assert.equal(result.addGroupBlocked, null);
  assert.match(result.addDescription, /New Attendee/);
  assert.match(result.addDescription, /Do not mark attendance/);
});
