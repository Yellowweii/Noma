const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup(storage = new Map(), blocked = false) {
  let user = "alice";
  const source = ts.transpileModule(readFileSync(join(__dirname, "homeSnapshot.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = {
    exports: {}, require: () => ({ getUserId: () => user }),
    window: { sessionStorage: {
      getItem: key => { if (blocked) throw new Error("disabled"); return storage.get(key) ?? null; },
      setItem: (key, value) => { if (blocked) throw new Error("disabled"); storage.set(key, value); },
      removeItem: key => storage.delete(key),
    } },
  };
  vm.runInNewContext(source, context);
  return { ...context.exports, storage, user: id => { user = id; } };
}
const online = { status: { configured: true, ha_reachable: true }, devices: [
  { entity_id: "light.main", name: "主灯", domain: "light", state: "off", room: "客厅", area_id: "living", device_id: "lamp" },
] };

test("home snapshot survives a module reload with room and device grouping intact", () => {
  const app = setup();
  app.writeHomeSnapshot(() => online);
  const reloaded = setup(app.storage);
  const cache = reloaded.readHomeSnapshot();
  assert.equal(cache.status.ha_reachable, true);
  assert.equal(cache.devices[0].room, "客厅");
  assert.equal(cache.devices[0].device_id, "lamp");
  reloaded.writeHomeSnapshot(previous => ({ ...previous, devices: previous.devices.map(device => ({ ...device, state: "on" })) }));
  assert.equal(setup(app.storage).readHomeSnapshot().devices[0].state, "on");
});

test("home caches stay isolated between accounts and reject late writes after a switch", () => {
  const app = setup();
  app.writeHomeSnapshot(() => online);
  app.user("bob");
  assert.equal(app.readHomeSnapshot(), undefined);
  app.writeHomeSnapshot(() => ({ ...online, devices: [] }), "alice");
  assert.equal(app.readHomeSnapshot("alice").devices.length, 1);
  app.user("alice");
  app.clearHomeSnapshot();
  assert.equal(app.readHomeSnapshot(), undefined);
  assert.equal(setup(app.storage).readHomeSnapshot(), undefined);
});

test("expired or malformed persisted home data falls back to a live read", () => {
  const app = setup();
  app.writeHomeSnapshot(() => online);
  const [key, raw] = [...app.storage][0];
  const value = JSON.parse(raw);
  app.storage.set(key, JSON.stringify({ ...value, savedAt: Date.now() - 86400001 }));
  assert.equal(setup(app.storage).readHomeSnapshot(), undefined);
  app.storage.set(key, JSON.stringify({ ...value, devices: [null] }));
  assert.equal(setup(app.storage).readHomeSnapshot(), undefined);
  app.storage.set(key, "{broken");
  assert.equal(setup(app.storage).readHomeSnapshot(), undefined);
});

test("blocked storage preserves in-memory caching and explicit disconnection replaces old devices", () => {
  const app = setup(new Map(), true);
  app.writeHomeSnapshot(() => online);
  assert.equal(app.readHomeSnapshot().devices.length, 1);
  app.writeHomeSnapshot(() => ({ status: { configured: true, ha_reachable: false }, devices: [] }));
  assert.equal(app.readHomeSnapshot().status.ha_reachable, false);
  assert.equal(app.readHomeSnapshot().devices.length, 0);
});
