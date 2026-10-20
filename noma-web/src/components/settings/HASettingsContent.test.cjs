const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const connectedAt = "2026-10-20T07:34:00Z";
function setup({ configured = false, name = "我的家", failName = false, cached = false } = {}) {
  let status = { ha_authorized: configured, ha_configured: configured, ha_url: "http://host.docker.internal:8123", home_name: name, last_connected_at: connectedAt };
  let reachable = true;
  let configureWait, refreshWait, configureError;
  let snapshot = cached ? { connection: { authorized:true, prepared:true, local_url:status.ha_url, home_name:name, last_connected_at:connectedAt }, connected:true, lastConnectedAt:connectedAt } : null;
  let stateIndex = 0, refIndex = 0, effectIndex = 0;
  const states = [], refs = [], effects = [], requests = [], storage = new Map();
  const react = {
    useState: initial => {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === "function" ? value(states[index]) : value; }];
    },
    useRef: initial => refs[refIndex++] ??= { current: initial },
    useEffect: callback => { effects[effectIndex++] = callback; },
    useSyncExternalStore: (_subscribe, read) => read(),
  };
  const modules = {
    react, "react/jsx-runtime": require("react/jsx-runtime"),
    "lucide-react": { ChevronDown:"chevron", ExternalLink:"external-link", Eye:"eye", EyeOff:"eye-off", Home:"home-icon", Loader2:"loader" },
    "@/components/settings/SettingsContentLayout": { SettingsContentLayout:"settings-layout" },
    "@/components/ui/FloatingTip": { FloatingTip:"floating-tip" },
    "@/lib/haConnectionSnapshot": {
      subscribeHAConnectionSnapshot: () => () => {},
      readHAConnectionSnapshot: () => snapshot,
      beginHAConnectionUpdate: () => () => {},
      writeHAConnectionSnapshot: (connection, connected) => { snapshot = { ...snapshot, connection, connected }; return snapshot; },
      refreshHAConnectionSnapshot: async () => {
        if (refreshWait) await refreshWait;
        snapshot = { connection: { authorized:status.ha_authorized, prepared:status.ha_configured, local_url:status.ha_url, home_name:status.home_name, last_connected_at:connectedAt }, connected:reachable, lastConnectedAt:connectedAt };
        return snapshot;
      },
    },
  };
  const context = {
    exports:{}, require: name => { assert(name in modules, name); return modules[name]; },
    Event: class { constructor(type) { this.type = type; } },
    window: { localStorage:{ setItem:(key,value) => storage.set(key,value) }, dispatchEvent:() => {} },
    fetch: async (url, options = {}) => {
      requests.push({ url, ...options });
      let body;
      if (url === "/api/local/status") body = status;
      else if (url === "/api/local/ha/defaults") body = { ha_url:"http://localhost:8123" };
      else if (url === "/api/local/ha/configure") {
        if (configureWait) await configureWait;
        if (configureError) return { ok:false, json:async () => ({ error:configureError }) };
        reachable = true; status = { ...status, ha_authorized:true, ha_configured:true }; body = status;
      }
      else if (url === "/api/local/ha/name") {
        if (failName) return { ok:false, json:async () => ({error:"无法保存家庭名称"}) };
        status = { ...status, ...JSON.parse(options.body) }; body = { ok:true, home_name:status.home_name };
      } else throw new Error(`Unexpected route: ${url}`);
      return { ok:true, json:async () => body };
    },
  };
  const source = ts.transpileModule(readFileSync(join(__dirname,"HASettingsContent.tsx"),"utf8"), {
    compilerOptions:{ module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX, target:ts.ScriptTarget.ES2022, esModuleInterop:true },
  }).outputText;
  vm.runInNewContext(source, context);
  return {
    render:() => { stateIndex = refIndex = effectIndex = 0; const root = context.exports.HASettingsContent(); return root.type(root.props); },
    mount:() => effects[0](), requests, storage,
    sync:() => effects[1](),
    rename:name => { snapshot = { ...snapshot, connection:{ ...snapshot.connection, home_name:name } }; },
    offline:() => { reachable = false; snapshot = { ...snapshot, connected:false }; },
    online:() => { reachable = true; snapshot = { ...snapshot, connected:true }; },
    pauseConfigure:() => { let resume; configureWait = new Promise(resolve => { resume = resolve; }); return resume; },
    pauseRefresh:() => { let resume; refreshWait = new Promise(resolve => { resume = resolve; }); return resume; },
    failConfigure:message => { configureError = message; },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree == null || typeof tree === "boolean") return "";
  if (typeof tree !== "object") return String(tree);
  return text(tree.props?.children);
}
const input = (tree,id) => nodes(tree).find(node => node.type === "input" && node.props.id === id);
const button = (tree,label) => nodes(tree).find(node => node.type === "button" && text(node) === label);

test("successful HA connection replaces the credential form with the connected summary", async () => {
  const app = setup();
  assert.match(text(app.render()), /正在检查连接状态/);
  app.mount(); await flush();
  let tree = app.render();
  const token = input(tree,"ha-token");
  assert(token);
  token.props.ref.current = { value:"test-only-ha-token" };
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault(){} });
  await flush();
  tree = app.render();
  assert.match(text(tree), /已连接上次连接/);
  assert.equal(input(tree,"ha-token"), undefined);
  assert.equal(input(tree,"ha-url"), undefined);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"我的家");
  assert.equal(button(tree,"保存").props.disabled,true);
  assert.equal(nodes(tree).find(node => node.type === "time").props.dateTime,connectedAt);
  assert.equal(token.props.ref.current.value, "");
  assert.equal(app.requests.find(request => request.url.endsWith("/configure")).credentials,"same-origin");
});

test("reconnection keeps a spinner until success and shows the summary before a background refresh completes", async () => {
  const app = setup({ configured:true, cached:true });
  app.render(); app.mount(); await flush();
  app.offline();
  let tree = app.render();
  const submit = nodes(tree).find(node => node.type === "form").props.onSubmit;
  const resumeConfigure = app.pauseConfigure();
  const resumeRefresh = app.pauseRefresh();
  const connecting = submit({ preventDefault(){} });
  for (let i = 0; i < 3; i++) {
    tree = app.render();
    const pendingButton = nodes(tree).find(node => node.type === "button" && node.props.type === "submit");
    assert.equal(pendingButton.props.disabled,true);
    assert.equal(pendingButton.props["aria-busy"],true);
    assert.equal(pendingButton.props["aria-label"],"正在连接");
    assert.equal(text(pendingButton),"");
    assert(nodes(pendingButton).some(node => node.type === "loader"));
    assert.doesNotMatch(text(tree),/保存并检测|连接中/);
    await flush();
  }
  // A second submit while pending must not send another write request.
  await submit({ preventDefault(){} });
  assert.equal(app.requests.filter(request => request.url.endsWith("/configure")).length,1);
  resumeConfigure(); await connecting;
  tree = app.render();
  assert.match(text(tree),/已连接上次连接/);
  assert.equal(input(tree,"ha-token"),undefined);
  assert.doesNotMatch(text(tree),/保存并检测|正在检查连接状态/);
  resumeRefresh(); await flush();
  assert.match(text(app.render()),/已连接上次连接/);
});

test("a failed connection restores the connect button and allows a retry", async () => {
  const app = setup();
  app.render(); app.mount(); await flush();
  app.failConfigure("无法连接 HA，请检查本地网络及地址");
  let tree = app.render();
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault(){} });
  tree = app.render();
  assert.match(text(tree),/无法连接 HA/);
  assert.equal(button(tree,"连接").props.disabled,false);
  assert.equal(button(tree,"连接").props["aria-busy"],false);
  app.failConfigure(null);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({ preventDefault(){} });
  assert.match(text(app.render()),/已连接上次连接/);
});

test("home name save only sends the name and updates the saved summary", async () => {
  const app = setup({ configured:true });
  app.render(); app.mount(); await flush();
  let tree = app.render();
  input(tree,"ha-saved-home-name").props.onChange({ target:{value:"  我们的家  "} });
  tree = app.render();
  assert.equal(button(tree,"保存").props.disabled,false);
  nodes(tree).find(node => node.type === "form").props.onSubmit({preventDefault(){}});
  await flush();
  tree = app.render();
  const request = app.requests.find(request => request.url.endsWith("/name"));
  assert.deepEqual(JSON.parse(request.body), {home_name:"我们的家"});
  assert.equal(input(tree,"ha-saved-home-name").props.value,"我们的家");
  assert.equal(button(tree,"保存").props.disabled,true);
  assert.equal(app.storage.get("noma-ha-home-name"),"我们的家");
  assert.equal(nodes(tree).find(node => node.type === "floating-tip").props.open,true);
});

test("monitor disconnection switches the connected summary directly to the connection form", async () => {
  const app = setup({ configured:true, name:"我们的家" });
  app.render(); app.mount(); await flush();
  let tree = app.render();
  assert.match(text(tree), /已连接/);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"我们的家");
  assert.equal(input(tree,"ha-token"), undefined);
  app.offline();
  tree = app.render();
  assert.doesNotMatch(text(tree), /连接暂不可用/);
  assert(input(tree,"ha-token"));
  assert.equal(input(tree,"ha-token").props.placeholder,"留空则保持现有令牌");
  assert.equal(input(tree,"ha-url").props.value,"http://host.docker.internal:8123");
  assert.equal(input(tree,"ha-saved-home-name"),undefined);
  const writesBefore = app.requests.filter(request => request.method === "POST").length;
  assert.equal(writesBefore,0);
  await nodes(tree).find(node => node.type === "form").props.onSubmit({preventDefault(){}});
  await flush();
  tree = app.render();
  assert.match(text(tree),/已连接/);
  assert.equal(input(tree,"ha-token"),undefined);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"我们的家");
  const reconnect = app.requests.find(request => request.url.endsWith("/configure"));
  assert.deepEqual(JSON.parse(reconnect.body),{});
});

test("failed home name save preserves the unsaved input and reports failure", async () => {
  const app = setup({ configured:true, failName:true });
  app.render(); app.mount(); await flush();
  let tree = app.render();
  input(tree,"ha-saved-home-name").props.onChange({target:{value:"新家"}});
  tree = app.render();
  nodes(tree).find(node => node.type === "form").props.onSubmit({preventDefault(){}});
  await flush();
  tree = app.render();
  assert.match(text(tree), /无法保存家庭名称/);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"新家");
  assert.equal(button(tree,"保存").props.disabled,false);
  assert.equal(app.storage.get("noma-ha-home-name"),"我的家");
});

test("cached settings render immediately and background status changes preserve an edited name", async () => {
  const app = setup({ configured:true, cached:true, name:"我们的家" });
  let tree = app.render();
  assert.match(text(tree), /已连接/);
  assert.doesNotMatch(text(tree), /正在检查/);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"我们的家");
  input(tree,"ha-saved-home-name").props.onChange({target:{value:"正在编辑的家"}});
  app.mount(); await flush();
  app.offline(); app.render(); app.sync();
  tree = app.render();
  assert(input(tree,"ha-token"));
  assert.equal(input(tree,"ha-saved-home-name"),undefined);
  app.online(); app.render(); app.sync();
  tree = app.render();
  assert.match(text(tree),/已连接/);
  assert.equal(input(tree,"ha-saved-home-name").props.value,"正在编辑的家");
  assert.equal(button(tree,"保存").props.disabled,false);
});

test("background cache changes update an untouched household name", () => {
  const app = setup({ configured:true, cached:true });
  app.render();
  app.rename("另一端保存的家"); app.render(); app.sync();
  const tree = app.render();
  assert.equal(input(tree,"ha-saved-home-name").props.value,"另一端保存的家");
  assert.equal(button(tree,"保存").props.disabled,true);
});

test("cached disconnected settings open the connection form without a loading screen", () => {
  const app = setup({configured:true,cached:true});
  app.offline();
  const tree = app.render();
  assert(input(tree,"ha-token"));
  assert.equal(input(tree,"ha-url").props.value,"http://host.docker.internal:8123");
  assert.equal(input(tree,"ha-saved-home-name"),undefined);
  assert.doesNotMatch(text(tree),/连接暂不可用|正在检查连接状态/);
  assert.equal(app.requests.length,0);
});
