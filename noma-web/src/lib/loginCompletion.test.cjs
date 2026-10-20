const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function setup({ dashboard = false, token = null, method = "google", sessionReady = false } = {}) {
  const session = deferred();
  const profile = deferred();
  const calls = [];
  const navigations = [];
  const states = [];
  const refs = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effect;
  const react = {
    Suspense: "suspense",
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = initial;
      return [states[index], value => { states[index] = value; }];
    },
    useRef: initial => refs[refIndex++] ??= { current: initial },
    useEffect: callback => { effect = callback; },
    useCallback: callback => callback,
  };
  const modules = {
    react, "react/jsx-runtime": require("react/jsx-runtime"), "next/link": "link",
    "next/navigation": {
      useRouter: () => ({ replace: path => navigations.push(path), prefetch: () => {} }),
      usePathname: () => "/agent",
      useSearchParams: () => new URLSearchParams({ method, next: "/memory/recent" }),
    },
    "@/components/login/LoginEnteringScreen": { LoginEnteringScreen: "sync-screen" },
    "@/components/layout/ResizableDashboardShell": { ResizableDashboardShell: "shell" },
    "@/components/layout/HAConnectionMonitor": { HAConnectionMonitor: "monitor" },
    "@/contexts/ChatSessionContext": { ChatSessionProvider: "chats" },
    "@/contexts/UserContext": { UserProvider: "user" },
    "@/lib/activeSessionStorage": { prepareFreshLoginLanding: () => calls.push("fresh-chat") },
    "@/lib/safeNext": { safeNextPath: value => value || "/agent" },
    "@/lib/api": {
      getAccessToken: () => token,
      bootstrapSession: () => {
        calls.push("session");
        return session.promise.then(ok => { if (ok) token = "local-session-marker"; return ok; });
      },
      api: { getMe: () => { calls.push("profile"); return profile.promise; } },
    },
  };
  const context = {
    exports: {}, require: name => { assert(name in modules, name); return modules[name]; },
    window: { location: { search: "" } },
    requestAnimationFrame: callback => queueMicrotask(callback),
  };
  const filename = dashboard ? "../app/(dashboard)/DashboardContent.tsx" : "../app/login/complete/page.tsx";
  const source = ts.transpileModule(readFileSync(join(__dirname, filename), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, context);
  const component = dashboard ? context.exports.DashboardContent : context.exports.default().props.children.type;
  return {
    render: () => { stateIndex = refIndex = 0; return component({ children: "content", sessionReady }); },
    mount: () => effect(), calls, navigations, session, profile, token: () => token,
  };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test("Public Google completion keeps session and account recovery inside the synchronization screen", async () => {
  const page = setup();
  assert.equal(page.render().props.activeStep, 2);
  page.mount();
  assert.deepEqual(page.calls, ["session"]);
  assert.deepEqual(page.navigations, []);
  page.session.resolve(true);
  await flush();
  assert.deepEqual(page.calls, ["session", "profile"]);
  assert.equal(page.render().props.activeStep, 2);
  assert.deepEqual(page.navigations, []);
  page.profile.resolve({ user_id: "test-user" });
  await flush();
  assert.deepEqual(page.calls, ["session", "profile", "fresh-chat"]);
  assert.deepEqual(page.navigations, ["/memory/recent"]);
  assert.equal(page.render().props.activeStep, 4);

  const dashboard = setup({ dashboard: true, token: page.token() });
  assert.equal(dashboard.render().type, "user");
  dashboard.mount();
  assert.deepEqual(dashboard.calls, []);
});

test("failed Public session recovery does not finish synchronization or open the application", async () => {
  const page = setup();
  page.render();
  page.mount();
  page.session.resolve(false);
  await flush();
  assert.deepEqual(page.calls, ["session"]);
  assert.deepEqual(page.navigations, []);
  assert.notEqual(page.render().type, "sync-screen");
});

test("OTP completion preserves the original destination and does not reset Google chat state", async () => {
  const page = setup({ method: "phone" });
  page.render();
  page.mount();
  page.session.resolve(true);
  page.profile.resolve({ user_id: "test-user" });
  await flush();
  assert.deepEqual(page.calls, ["session", "profile"]);
  assert.deepEqual(page.navigations, ["/memory/recent"]);
});

test("direct Public application visits use the same synchronization UI until their session is ready", async () => {
  const page = setup({ dashboard: true });
  const loading = page.render();
  assert.equal(loading.type, "sync-screen");
  assert.equal(loading.props.activeStep, 2);
  page.mount();
  page.session.resolve(true);
  await flush();
  assert.equal(page.render().type, "user");
  assert.deepEqual(page.calls, ["session"]);
});


test("the gateway-validated Google destination opens the application without a second synchronization page", async () => {
  const page = setup({ dashboard: true, sessionReady: true });
  assert.equal(page.render().type, "user");
  page.mount();
  assert.deepEqual(page.calls, ["session"]);
  assert.equal(page.render().type, "user");
  page.session.resolve(true);
  await flush();
  assert.equal(page.render().type, "user");
  assert.deepEqual(page.navigations, []);
});

test("a temporary sync failure keeps a gateway-validated application open", async () => {
  const page = setup({ dashboard: true, sessionReady: true });
  assert.equal(page.render().type, "user");
  page.mount();
  page.session.reject(new Error("gateway temporarily unavailable"));
  await flush();
  assert.equal(page.render().type, "user");
  assert.deepEqual(page.navigations, []);
});

test("an invalid background session still returns the protected application to login", async () => {
  const page = setup({ dashboard: true, sessionReady: true });
  page.render();
  page.mount();
  page.session.resolve(false);
  await flush();
  assert.deepEqual(page.navigations, ["/login?next=%2Fagent"]);
});


test("direct Google landing clears the previous account's conversation once, while later refreshes restore normally", () => {
  const storedId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  const cookies = new Map([["noma.freshLogin", "1"], ["noma.newChatIntent", "1"]]);
  const storage = new Map([["noma.activeSessionId", storedId]]);
  const document = {
    get cookie() { return [...cookies].map(([key, value]) => `${key}=${value}`).join("; "); },
    set cookie(value) {
      const [pair] = value.split(";");
      const [key, content] = pair.split("=");
      if (/max-age=0(?:;|$)/i.test(value)) cookies.delete(key);
      else cookies.set(key, content);
    },
  };
  const modules = {};
  const window = { location: { pathname: "/agent" }, localStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: key => storage.delete(key),
  } };
  function loadModule(name) {
    const context = { exports: {}, window, document, require: key => modules[key] };
    vm.runInNewContext(ts.transpileModule(readFileSync(join(__dirname, name), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText, context);
    return context.exports;
  }
  modules["@/lib/activeSessionStorage"] = loadModule("activeSessionStorage.ts");
  modules["@/lib/chatRoutes"] = { parseLegacyAgentSessionId: () => null };
  modules["@/lib/sessionMessageCache"] = {};
  const bootstrap = loadModule("chatSessionBootstrap.ts");
  assert.equal(bootstrap.readRestorableSessionId(), null);
  assert.equal(storage.has("noma.activeSessionId"), false);
  assert.equal(cookies.has("noma.freshLogin"), false);
  assert.equal(cookies.get("noma.newChatIntent"), "1");
  storage.set("noma.activeSessionId", storedId);
  assert.equal(bootstrap.readRestorableSessionId(), storedId);
});
