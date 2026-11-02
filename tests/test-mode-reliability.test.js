const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const frontend = path.join(__dirname, "..", "TestMode", "Frontend");
const views = fs.readFileSync(
  path.join(frontend, "js", "app-views.js"),
  "utf8",
);
const core = fs.readFileSync(
  path.join(frontend, "js", "app-core.js"),
  "utf8",
);
const offline = fs.readFileSync(
  path.join(frontend, "js", "app-offline.js"),
  "utf8",
);
const auth = fs.readFileSync(
  path.join(frontend, "js", "app-auth.js"),
  "utf8",
);
const html = fs.readFileSync(path.join(frontend, "index.html"), "utf8");
const styles = fs.readFileSync(
  path.join(frontend, "css", "03-feedback.css"),
  "utf8",
);

function createElement() {
  return {
    children: [],
    listeners: {},
    dataset: {},
    attributes: {},
    style: { setProperty() {} },
    classList: { add() {}, remove() {} },
    append(...elements) {
      elements.forEach((element) => {
        element.parentElement = this;
        this.children.push(element);
      });
    },
    appendChild(element) {
      this.append(element);
    },
    remove() {
      if (!this.parentElement) return;
      this.parentElement.children = this.parentElement.children.filter(
        (element) => element !== this,
      );
    },
    addEventListener(type, handler) {
      this.listeners[type] = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
}

function loadToastFunction() {
  const source = views.match(
    /function showToast\(message, type = "error", duration = 5000\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(source, "showToast should be available");
  const container = createElement();
  Object.defineProperty(container, "firstElementChild", {
    get() {
      return this.children[0];
    },
  });
  const context = vm.createContext({
    document: {
      getElementById: () => container,
      createElement,
    },
    translations: { en: { dismissNotification: "Dismiss notification" } },
    currentLang: "en",
    translateText: (message) => message,
    setTimeout() {},
  });
  vm.runInContext(source, context);
  return { showToast: context.showToast, container };
}

test("toast dismiss button and both swipe directions remove the toast", () => {
  const { showToast, container } = loadToastFunction();
  const closeable = showToast("Message", "info");
  assert.equal(closeable.children[1].attributes["aria-label"], "Dismiss notification");
  closeable.children[1].listeners.click();
  assert.equal(container.children.includes(closeable), false);

  const swipedLeft = showToast("Left swipe");
  swipedLeft.listeners.pointerdown({
    target: { closest: () => null },
    clientX: 180,
    clientY: 20,
  });
  swipedLeft.listeners.pointerup({ clientX: 90, clientY: 22 });
  assert.equal(container.children.includes(swipedLeft), false);

  const swipedRight = showToast("Right swipe");
  swipedRight.listeners.pointerdown({
    target: { closest: () => null },
    clientX: 80,
    clientY: 20,
  });
  swipedRight.listeners.pointerup({ clientX: 170, clientY: 22 });
  assert.equal(container.children.includes(swipedRight), false);
});

test("toast stack stays bounded and notification dismissals persist", () => {
  const { showToast, container } = loadToastFunction();
  for (let index = 0; index < 6; index++) showToast(`Message ${index}`);
  assert.equal(container.children.length, 4);
  assert.match(views, /function dismissAppNotification\(key\)/);
  assert.match(views, /localStorage\.setItem\("app_notifications_v1", JSON\.stringify\(notifications\)\)/);
  assert.match(views, /dismissAppNotification\(item\.key\)/);
  assert.match(views, /pointerup/);
  assert.match(views, /dismiss\.className = "notification-dismiss"/);
  assert.match(styles, /\.notification-dismiss:focus-visible/);
});

test("language changes update toast text without removing its dismiss control", () => {
  assert.match(
    core,
    /querySelectorAll\("\.toast\[data-message\]"\)[\s\S]*?querySelector\("\.toast-message"\)[\s\S]*?message\.textContent = translateText\(el\.dataset\.message\)/,
  );
});

test("offline startup clears cached reads but preserves queued attendance and sync credentials", async () => {
  const source = auth.match(
    /async function clearTestModeCachedReadData\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(source, "cached read cleanup should be available");

  const data = {
    events: new Map([["pending-event", { id: "pending-event" }]]),
    roster: new Map([["roster-entry", { id: "roster-entry" }]]),
    apiCache: new Map([["cached-response", { value: "private" }]]),
    metadata: new Map([
      ["roster", { key: "roster" }],
      ["syncCredentials", { key: "syncCredentials", token: "retained" }],
    ]),
  };
  const storeNames = Object.keys(data);
  const database = {
    objectStoreNames: {
      contains: (name) => storeNames.includes(name),
    },
    transaction(names) {
      const transaction = {
        objectStore(name) {
          assert.ok(names.includes(name), `unexpected transaction store: ${name}`);
          return {
            clear: () => data[name].clear(),
            delete: (key) => data[name].delete(key),
          };
        },
      };
      queueMicrotask(() => transaction.oncomplete());
      return transaction;
    },
    close() {},
  };
  const context = vm.createContext({
    window: { indexedDB: {} },
    openOfflineDatabase: async () => database,
    console,
  });
  vm.runInContext(source, context);

  await context.clearTestModeCachedReadData();

  assert.equal(data.events.has("pending-event"), true);
  assert.equal(data.roster.size, 0);
  assert.equal(data.apiCache.size, 0);
  assert.equal(data.metadata.has("roster"), false);
  assert.equal(data.metadata.get("syncCredentials").token, "retained");
});

test("connectivity banner distinguishes offline from an unreachable app backend", () => {
  assert.match(html, /id="connectionStatusBanner"[\s\S]*?aria-live="polite"/);
  assert.match(offline, /!navigator\.onLine[\s\S]*?translations\[currentLang\]\.offlineMsg/);
  assert.match(offline, /backendReachabilityState === false[\s\S]*?backendUnavailableMsg/);
  assert.match(core, /backendReachabilityState = false/);
  assert.match(core, /backendReachabilityState = true/);
  assert.match(core, /!navigator\.onLine \|\| backendReachabilityState === false/);
});

test("startup dismisses after initialization instead of using a fixed wait", () => {
  assert.doesNotMatch(auth, /setTimeout\(dismissStartupScreen,\s*1050\)/);
  assert.match(auth, /showView\("loginView", false\);\s*dismissStartupScreen\(\)/);
  assert.match(auth, /transitionend/);
  assert.match(auth, /setTimeout\(finish, 350\)/);
});

test("startup screen remains visible through its exit transition", () => {
  const source = auth.match(
    /function dismissStartupScreen\(\) \{[\s\S]*?\n\}/,
  )?.[0];
  assert.ok(source);
  let transitionHandler;
  const startupScreen = {
    hidden: false,
    attributes: {},
    classList: { add() {} },
    addEventListener(type, handler) {
      if (type === "transitionend") transitionHandler = handler;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };
  const context = vm.createContext({
    document: { getElementById: () => startupScreen },
    window: {
      requestAnimationFrame: (callback) => callback(),
      setTimeout: () => 1,
      clearTimeout() {},
    },
  });
  vm.runInContext(source, context);

  context.dismissStartupScreen();
  assert.equal(startupScreen.hidden, false);
  transitionHandler({ target: startupScreen, propertyName: "opacity" });
  assert.equal(startupScreen.hidden, true);
  assert.equal(startupScreen.attributes["aria-hidden"], "true");
});

test("Test Mode uses supplied video and does not cache the media file", () => {
  assert.match(html, /<video[\s\S]*?controls[\s\S]*?preload="metadata"[\s\S]*?<source src="Assets\/video\.mp4"/);
  assert.match(html, /data-design="current"/);
  const serviceWorker = fs.readFileSync(
    path.join(frontend, "sw.js"),
    "utf8",
  );
  assert.match(serviceWorker, /requestUrl\.pathname === videoPath[\s\S]*?event\.respondWith\(fetch\(request\)\)/);
  assert.doesNotMatch(
    serviceWorker.match(/const APP_SHELL = \[([\s\S]*?)\];/)?.[1] || "",
    /Assets\/video\.mp4/,
  );
  assert.equal(fs.existsSync(path.join(frontend, "Assets", "video.mp4")), true);
});
