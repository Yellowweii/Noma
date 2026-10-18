const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const online = { available: true, prepared: true, authorized: true, connection_id: "household", ha_reachable: true, can_authorize: true };
const offline = { ...online, ha_reachable: false, can_authorize: false, frpc_online: false };

function setup() {
  let connection = online;
  let status = { configured: true, ha_reachable: true };
  let home;
  const storage = new Map();
  const timers = new Map();
  let timerId = 0;
  const api = {
    getHAConnection: async () => connection,
    getHomeStatus: async () => {
      if (status instanceof Error) throw status;
      return status;
    },
  };
  const mocks = {
    "./api": { api },
    "./auth": { getUserId: () => "user", bootstrapSession: async () => true },
    "./homeSnapshot": { writeHomeSnapshot: update => { home = update(home); } },
  };
  const context = {
    exports: {}, require: name => mocks[name],
    window: { localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } },
    setTimeout: callback => { timers.set(++timerId, callback); return timerId; },
    clearTimeout: id => timers.delete(id),
  };
  const source = ts.transpileModule(readFileSync(join(__dirname, "haConnectionSnapshot.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, context);
  const store = context.exports;
  store.writeHAConnectionSnapshot(online, true, true);
  return { store, api, timers, home: () => home, connection: value => { connection = value; }, status: value => { status = value; } };
}

test("a stopped tunnel overrides a conflicting successful home response", async () => {
  const app = setup();
  const lastConnectedAt = app.store.readHAConnectionSnapshot().lastConnectedAt;
  app.connection(offline);
  const snapshot = await app.store.refreshHAConnectionSnapshot();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.lastConnectedAt, lastConnectedAt);
  assert.equal(app.home().status.ha_reachable, false);
  assert.equal(app.home().devices.length, 0);
});

test("a stopped tunnel clears cached success when the home request fails", async () => {
  const app = setup();
  app.connection(offline);
  app.status(new Error("home request timed out"));
  const snapshot = await app.store.refreshHAConnectionSnapshot();
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.connection.authorized, true);
  assert.equal(app.home().status.ha_reachable, false);
});

test("monitor detects disconnection and recovery without remounting the settings page", async () => {
  const app = setup();
  let notifications = 0;
  const unsubscribe = app.store.subscribeHAConnectionSnapshot(() => notifications++);
  const stop = app.store.startHAConnectionMonitor("user");
  async function tick() {
    const [id, callback] = app.timers.entries().next().value;
    app.timers.delete(id);
    await callback();
  }
  app.connection(offline);
  await tick();
  assert.equal(app.store.readHAConnectionSnapshot().connected, false);
  app.connection(online);
  await tick();
  assert.equal(app.store.readHAConnectionSnapshot().connected, true);
  assert.equal(notifications, 2);
  unsubscribe();
  stop();
  assert.equal(app.timers.size, 0);
});

test("unconfirmed transport errors preserve the last verified result", async () => {
  const app = setup();
  app.api.getHAConnection = async () => { throw new Error("network error"); };
  app.status(new Error("network error"));
  await assert.rejects(app.store.refreshHAConnectionSnapshot(), /network error/);
  assert.equal(app.store.readHAConnectionSnapshot().connected, true);
});

test("a stale refresh cannot overwrite a name saved while the request was running", async () => {
  const app = setup();
  let resolve;
  app.api.getHAConnection = () => new Promise(accept => { resolve = accept; });
  const refreshing = app.store.refreshHAConnectionSnapshot();
  const finish = app.store.beginHAConnectionUpdate();
  app.store.writeHAConnectionSnapshot({ ...online, home_name: "新名称" }, true);
  finish();
  resolve(offline);
  await refreshing;
  assert.equal(app.store.readHAConnectionSnapshot().connection.home_name, "新名称");
  assert.equal(app.store.readHAConnectionSnapshot().connected, true);
});
