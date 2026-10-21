const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

class ApiError extends Error {}

function setup(sendMessage) {
  const states = [], refs = [], updates = [], requests = [];
  let stateIndex = 0, refIndex = 0;
  const noop = () => {};
  const modules = {
    react: {
      useState: initial => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
        return [states[index], value => updates.push(() => {
          states[index] = typeof value === "function" ? value(states[index]) : value;
        })];
      },
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useCallback: callback => callback,
      useEffect: noop, useLayoutEffect: noop,
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "next/link": { __esModule: true, default: "link" },
    "lucide-react": { ArrowUp: "arrow", Loader2: "loader", Mic: "mic", Square: "square" },
    "@/lib/api": { ApiError, api: {
      sendMessage: async (...args) => { requests.push(args); await sendMessage(...args); },
    } },
    "@/contexts/ChatSessionContext": { useChatSessions: () => ({
      sessions: [], activeSessionId: "session-test", initialSessionResolved: true,
      newChatIntent: true, resolveSessionId: async id => id,
      finishNewChatIntent: noop, touchSession: noop,
      updateSessionTitle: noop, refreshSessions: async () => {},
    }) },
    "@/lib/sessionMessageCache": {
      getInitialSessionViewState: () => ({ messages: [], sessionReady: true, sessionNotFound: false }),
      isPendingSessionId: () => false,
    },
    "@/lib/activeSessionStorage": {},
    "@/lib/useSpeechToText": { useSpeechToText: () => ({}) },
    "@/lib/utils": { cn: (...args) => args.filter(Boolean).join(" ") },
    "./agent-responsive.module.css": { __esModule: true, default: {} },
  };
  const context = {
    exports: {}, AbortController, DOMException,
    require: name => {
      if (name.startsWith("@/components/")) return new Proxy({}, { get: (_target, key) => key });
      assert(name in modules, name);
      return modules[name];
    },
  };
  const source = ts.transpileModule(readFileSync(join(__dirname, "AgentChatPage.tsx"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, context);
  const render = () => {
    while (updates.length) updates.shift()();
    stateIndex = refIndex = 0;
    return context.exports.AgentChatPage({});
  };
  return {
    render, requests,
    send: async () => {
      nodes(render()).find(node => node.type === "textarea").props.onChange({ target: { value: "哈喽，你好啊！" } });
      await nodes(render()).find(node => node.props["aria-label"] === "发送消息").props.onClick();
    },
  };
}

function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
const replies = app => nodes(app.render()).filter(node => node.type === "MarkdownMessage");
const meta = { type: "meta", data: { message_id: "user-real", assistant_message_id: "assistant-real" } };
const token = content => ({ type: "token", content });

for (const [name, events] of [
  ["server IDs before reply", [meta, token("你好"), token("！")]],
  ["server IDs after first token", [token("你好"), meta, token("！")]],
  ["reply without server IDs", [token("你好"), token("！")]],
  ["repeated metadata", [meta, meta, token("你好！")]],
]) {
  test(`chat renders ${name} with batched React updates`, async () => {
    const app = setup(async (_session, _content, onEvent) => {
      for (const event of events) onEvent(event);
      onEvent({ type: "done" });
    });
    await app.send();
    assert.equal(replies(app).length, 1);
    assert.equal(replies(app)[0].props.content, "你好！");
    if (events.includes(meta)) assert(nodes(app.render()).some(node => node.props.id === "msg-assistant-real"));
    assert.equal(app.requests.length, 1);
  });
}

test("chat displays request errors after the server assigns reply IDs", async () => {
  const app = setup(async (_session, _content, onEvent) => {
    onEvent(meta);
    throw new ApiError("云端暂时不可用");
  });
  await app.send();
  assert.match(replies(app)[0].props.content, /云端暂时不可用/);
});

for (const partial of ["", "部分回复"]) {
  test(`stopping after reply metadata ${partial ? "preserves partial text" : "removes the empty reply"}`, async () => {
    const app = setup(async (_session, _content, onEvent) => {
      onEvent(meta);
      if (partial) onEvent(token(partial));
      throw new DOMException("Stopped", "AbortError");
    });
    await app.send();
    assert.deepEqual(replies(app).map(node => node.props.content), partial ? [partial] : []);
  });
}

test("regeneration renders the replacement reply under its new server ID", async () => {
  let turn = 0;
  const app = setup(async (_session, _content, onEvent) => {
    turn++;
    onEvent({ ...meta, data: { ...meta.data, assistant_message_id: `assistant-${turn}` } });
    onEvent(token(`回复 ${turn}`));
  });
  await app.send();
  nodes(app.render()).find(node => node.type === "AssistantMessageActions").props.onRegenerate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(replies(app).length, 1);
  assert.equal(replies(app)[0].props.content, "回复 2");
  assert.equal(app.requests[1][4].replaceAssistantId, "assistant-1");
});
