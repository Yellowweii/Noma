const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup({ fail = true, authFailure = false } = {}) {
  const states = [], refs = [], hooks = [], listeners = new Map(), requests = [];
  let stateIndex, refIndex, hookIndex;
  let failed = fail;
  const pendingEffects = [];
  const session = id => ({ session_id: id, title: id, updated_at: "2026-10-20T00:00:00Z" });
  const router = { replace() {}, push() {} };
  const noop = () => {};
  const changedHook = (callback, deps, effect) => {
    const index = hookIndex++;
    const previous = hooks[index];
    if (!previous || deps.some((value, index) => !Object.is(value, previous.deps[index]))) {
      const next = { callback, deps, cleanup: previous?.cleanup };
      hooks[index] = next;
      if (effect) pendingEffects.push(() => { next.cleanup?.(); next.cleanup = callback(); });
    }
    return hooks[index].callback;
  };
  const modules = {
    react: {
      createContext: () => ({ Provider: "provider" }),
      useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
      },
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useCallback: (callback, deps) => changedHook(callback, deps, false),
      useEffect: (callback, deps) => changedHook(callback, deps, true),
      useLayoutEffect: (callback, deps) => changedHook(callback, deps, true),
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/navigation": { usePathname: () => "/agent", useRouter: () => router },
    "@/lib/api": {
      getAccessToken: () => authFailure && failed ? null : "test-session-marker",
      bootstrapSession: async () => { failed = false; throw new Error("gateway restarting"); },
      api: {
        listChatSessionPage: async cursor => {
          requests.push(cursor || "first");
          if (failed) { failed = false; throw new Error("gateway restarting"); }
          return cursor ? { sessions: [session("older")] } : { sessions: [session("recent")], next_cursor: "cursor-next" };
        },
        createChatSession: async () => session("new-session"),
      },
    },
    "@/lib/activeSessionStorage": {
      readNewChatIntent: () => false, readStoredActiveSessionId: () => null,
      writeStoredActiveSessionId: noop,
    },
    "@/lib/chatRoutes": { AGENT_PATH: "/agent", parseLegacyAgentSessionId: () => null },
    "@/lib/chatSessionBootstrap": {
      createBootstrapPendingSessionState: () => ({ sessionId: "pending:test", needsPendingBootstrap: true }),
      readRestorableSessionId: () => null,
    },
    "@/lib/sessionMessageCache": {
      getSessionSnapshot: () => null, invalidateSessionSnapshot: noop,
      isPendingSessionId: id => id.startsWith("pending:"), prefetchSessionMessages: noop,
    },
    "@/lib/utils": { sortChatSessions: sessions => sessions },
  };
  const context = {
    exports: {}, require: name => { assert(name in modules, name); return modules[name]; },
    window: { addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name) },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(join(__dirname, "ChatSessionContext.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, context);
  const render = () => {
    stateIndex = refIndex = hookIndex = 0;
    const value = context.exports.ChatSessionProvider({}).props.value;
    while (pendingEffects.length) pendingEffects.shift()();
    return value;
  };
  return { render, requests, trigger: name => listeners.get(name)() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

for (const trigger of ["button", "focus", "online"]) {
  test(`sidebar recovers failed initial history load via ${trigger}`, async () => {
    const app = setup();
    app.render(); await flush();
    let state = app.render();
    assert.equal(state.sessions.length, 0);
    assert.match(state.sessionLoadError, /重试/);
    if (trigger === "button") await state.loadMoreSessions();
    else app.trigger(trigger);
    app.render(); await flush();
    state = app.render();
    assert(state.sessions.some(item => item.session_id === "recent"));
    assert.equal(state.sessionLoadError, "");
    assert.equal(state.hasMoreSessions, true);
    await state.loadMoreSessions(); await flush();
    state = app.render();
    assert(state.sessions.some(item => item.session_id === "older"));
    assert.equal(state.hasMoreSessions, false);
    assert.deepEqual(app.requests, ["first", "first", "cursor-next"]);
  });
}

test("sidebar retries temporary login bootstrap failure without losing cloud history", async () => {
  const app = setup({ authFailure: true });
  app.render(); await flush();
  assert.match(app.render().sessionLoadError, /重试/);
  app.trigger("focus");
  app.render(); await flush();
  assert(app.render().sessions.some(item => item.session_id === "recent"));
});

test("successful sidebar initialization keeps pagination when the window regains focus", async () => {
  const app = setup({ fail: false });
  app.render(); await flush();
  app.render();
  app.trigger("focus");
  app.render(); await flush();
  assert.deepEqual(app.requests, ["first"]);
  await app.render().loadMoreSessions();
  assert.deepEqual(app.requests, ["first", "cursor-next"]);
});
