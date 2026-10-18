import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import type { Device } from "@/types";
import { controlDeviceOptimistically, optimisticDevice, retainLightSettings } from "./home-device-control";
import { deviceDetails, hasDetailControls, isWhiteLight, lightBrightnessPct, lightColorHex, lightColorParams, whiteLightParams } from "./home-devices";

beforeEach(() => {
  mock.method(globalThis, "setTimeout", ((callback: () => void) => {
    queueMicrotask(callback);
    return 0;
  }) as unknown as typeof setTimeout);
});
afterEach(() => mock.restoreAll());

function device(domain = "light", overrides: Partial<Device> = {}): Device {
  return {
    id: `${domain}.test`, entity_id: `${domain}.test`, name: "测试设备", domain,
    state: "off", attributes: { brightness: 64 }, last_updated: "2026-10-16T00:00:00Z", ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline; });
  return { promise, resolve, reject };
}

test("updates visible device state before the control response, then rolls back a rejected command", async () => {
  const before = device();
  const response = deferred<{ ok: boolean }>();
  const updates: Device[] = [];
  let readCount = 0;
  const result = controlDeviceOptimistically(before, "turn_on", undefined, {
    controlDevice: () => response.promise,
    listDevices: async () => { readCount++; return []; },
  }, next => updates.push(next));

  assert.equal(updates.length, 1);
  assert.equal(updates[0].state, "on");
  assert.equal(before.state, "off");
  assert.equal(readCount, 0);
  response.reject(new Error("HA unavailable"));
  assert.equal(await result, "failed");
  assert.equal(updates.at(-1), before);
  assert.equal(readCount, 0);
});

test("treats an explicit negative acknowledgment as a failure and restores all previous attributes", async () => {
  const before = device();
  const updates: Device[] = [];
  const result = await controlDeviceOptimistically(before, "turn_on", { brightness_pct: 80 }, {
    controlDevice: async () => ({ ok: false }), listDevices: async () => [],
  }, next => updates.push(next));
  assert.equal(updates[0].attributes?.brightness, 204);
  assert.equal(result, "failed");
  assert.equal(updates.at(-1), before);
  assert.equal(before.attributes?.brightness, 64);
});

test("retains the optimistic value while reading back, then uses the actual HA state", async () => {
  const before = device();
  const readBack = deferred<Device[]>();
  const confirmed = device("light", { state: "on", attributes: { brightness: 204 } });
  const updates: Device[] = [];
  const result = controlDeviceOptimistically(before, "turn_on", { brightness_pct: 80 }, {
    controlDevice: async () => ({ ok: true }), listDevices: () => readBack.promise,
  }, next => updates.push(next));
  await Promise.resolve();
  assert.equal(updates.length, 1);
  assert.equal(updates[0].attributes?.brightness, 204);
  readBack.resolve([confirmed]);
  assert.equal(await result, "confirmed");
  assert.equal(updates.at(-1), confirmed);
});

test("does not undo an accepted command when only the follow-up read fails", async () => {
  const updates: Device[] = [];
  const result = await controlDeviceOptimistically(device(), "turn_on", undefined, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => { throw new Error("read timeout"); },
  }, next => updates.push(next));
  assert.equal(result, "unconfirmed");
  assert.equal(updates.length, 1);
  assert.equal(updates[0].state, "on");
});

test("keeps an accepted command unconfirmed when the device is absent from the response", async () => {
  const updates: Device[] = [];
  assert.equal(await controlDeviceOptimistically(device(), "turn_on", undefined, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [],
  }, next => updates.push(next)), "unconfirmed");
  assert.equal(updates.length, 1);
});

test("does not overwrite the optimistic switch with a stale read before HA reports the target state", async () => {
  const before = device();
  const confirmed = { ...before, state: "on" };
  const updates: Device[] = [];
  let reads = 0;
  const result = await controlDeviceOptimistically(before, "turn_on", undefined, {
    controlDevice: async () => ({ ok: true }),
    listDevices: async () => [++reads < 3 ? before : confirmed],
  }, next => updates.push(next));
  assert.equal(result, "confirmed");
  assert.equal(reads, 3);
  assert.deepEqual(updates.map(item => item.state), ["on", "on"]);
  assert.equal(updates.at(-1), confirmed);
});

test("an accepted command whose target is never reported stays unconfirmed after bounded retries", async () => {
  const before = device();
  const updates: Device[] = [];
  let reads = 0;
  const result = await controlDeviceOptimistically(before, "turn_on", undefined, {
    controlDevice: async () => ({ ok: true }),
    listDevices: async () => { reads++; return [before]; },
  }, next => updates.push(next));
  assert.equal(result, "unconfirmed");
  assert.equal(reads, 4);
  assert.deepEqual(updates.map(item => item.state), ["on", "off"]);
});

test("waits for turn-off feedback and confirms zero brightness as off even if HA retains the previous brightness", async () => {
  for (const [action, params] of [["turn_off", undefined], ["turn_on", { brightness_pct: 0 }]] as const) {
    const before = device("light", { state: "on" });
    const confirmed = { ...before, state: "off" };
    const updates: Device[] = [];
    let reads = 0;
    assert.equal(await controlDeviceOptimistically(before, action, params, {
      controlDevice: async () => ({ ok: true }),
      listDevices: async () => [++reads === 1 ? before : confirmed],
    }, next => updates.push(next)), "confirmed");
    assert.equal(reads, 2);
    assert.deepEqual(updates.map(item => item.state), ["off", "off"]);
  }
});

test("waits for the adjusted attribute even when the device is already on", async () => {
  const before = device("light", { state: "on" });
  const confirmed = { ...before, attributes: { brightness: 203 } };
  const updates: Device[] = [];
  let reads = 0;
  const result = await controlDeviceOptimistically(before, "turn_on", { brightness_pct: 80 }, {
    controlDevice: async () => ({ ok: true }),
    listDevices: async () => [++reads === 1 ? before : confirmed],
  }, next => updates.push(next));
  assert.equal(result, "confirmed");
  assert.equal(reads, 2);
  assert.deepEqual(updates.map(item => item.attributes?.brightness), [204, 203]);
});

test("retries a read failure without resending an accepted command", async () => {
  const confirmed = device("switch", { state: "on" });
  let commands = 0;
  let reads = 0;
  const result = await controlDeviceOptimistically(device("switch"), "turn_on", undefined, {
    controlDevice: async () => { commands++; return { ok: true }; },
    listDevices: async () => {
      if (++reads === 1) throw new Error("temporary read failure");
      return [confirmed];
    },
  }, () => {});
  assert.equal(result, "confirmed");
  assert.equal(commands, 1);
  assert.equal(reads, 2);
});

test("accepts completed cover movement and the actual climate mode after powering on", async () => {
  for (const [domain, action, state] of [
    ["cover", "open_cover", "open"], ["cover", "close_cover", "closed"], ["climate", "turn_on", "heat"],
  ]) {
    const confirmed = device(domain, { state });
    assert.equal(await controlDeviceOptimistically(device(domain), action, undefined, {
      controlDevice: async () => ({ ok: true }), listDevices: async () => [confirmed],
    }, () => {}), "confirmed", `${domain}.${action}`);
  }
});

test("rolling back one device does not undo a simultaneous successful operation on another", async () => {
  const light = device();
  const fan = device("fan");
  const lightResponse = deferred<{ ok: boolean }>();
  const fanResponse = deferred<{ ok: boolean }>();
  const confirmedFan = { ...fan, state: "on" };
  let devices = [light, fan];
  const update = (next: Device) => { devices = devices.map(item => item.entity_id === next.entity_id ? next : item); };
  const lightResult = controlDeviceOptimistically(light, "turn_on", undefined, {
    controlDevice: () => lightResponse.promise, listDevices: async () => [],
  }, update);
  const fanResult = controlDeviceOptimistically(fan, "turn_on", undefined, {
    controlDevice: () => fanResponse.promise, listDevices: async () => [light, confirmedFan],
  }, update);
  assert.deepEqual(devices.map(item => item.state), ["on", "on"]);
  fanResponse.resolve({ ok: true });
  assert.equal(await fanResult, "confirmed");
  lightResponse.reject(new Error("light unavailable"));
  assert.equal(await lightResult, "failed");
  assert.deepEqual(devices.map(item => item.state), ["off", "on"]);
  assert.equal(devices[1], confirmedFan);
});

test("a failed subsequent adjustment restores the preceding successful value", async () => {
  const before = device("climate", { state: "cool", attributes: { temperature: 24 } });
  let current = before;
  const update = (next: Device) => { current = next; };
  const confirmed = { ...before, attributes: { temperature: 25 } };
  await controlDeviceOptimistically(current, "set_temperature", { temperature: 25 }, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [confirmed],
  }, update);
  const result = await controlDeviceOptimistically(current, "set_temperature", { temperature: 26 }, {
    controlDevice: async () => { throw new Error("second command failed"); }, listDevices: async () => [],
  }, update);
  assert.equal(result, "failed");
  assert.equal(current, confirmed);
  assert.equal(current.attributes?.temperature, 25);
});

test("predicts device controls without mutating the previous snapshot or device metadata", () => {
  const cases: [string, string, Record<string, unknown>, string, Record<string, unknown>][] = [
    ["switch", "turn_on", {}, "on", {}],
    ["input_boolean", "turn_off", {}, "off", {}],
    ["light", "turn_on", { brightness_pct: 0 }, "off", { brightness: 0 }],
    ["climate", "set_hvac_mode", { hvac_mode: "heat" }, "heat", {}],
    ["climate", "set_temperature", { temperature: 26 }, "off", { temperature: 26 }],
    ["climate", "set_fan_mode", { fan_mode: "high" }, "off", { fan_mode: "high" }],
    ["cover", "open_cover", {}, "opening", {}],
    ["cover", "close_cover", {}, "closing", {}],
    ["cover", "set_cover_position", { position: 70 }, "open", { current_position: 70 }],
    ["cover", "set_cover_position", { position: 0 }, "closed", { current_position: 0 }],
    ["media_player", "media_play", {}, "playing", {}],
    ["media_player", "media_pause", {}, "paused", {}],
    ["media_player", "volume_set", { volume_level: 0.3 }, "off", { volume_level: 0.3 }],
    ["fan", "set_percentage", { percentage: 75 }, "on", { percentage: 75 }],
    ["fan", "set_preset_mode", { preset_mode: "auto" }, "off", { preset_mode: "auto" }],
    ["humidifier", "set_humidity", { humidity: 55 }, "off", { humidity: 55 }],
    ["humidifier", "set_mode", { mode: "auto" }, "off", { mode: "auto" }],
    ["vacuum", "start", {}, "cleaning", {}],
    ["vacuum", "return_to_base", {}, "returning", {}],
  ];
  for (const [domain, action, params, state, attributes] of cases) {
    const before = device(domain, { room: "客厅", area_id: "living-room" });
    const original = structuredClone(before);
    const predicted = optimisticDevice(before, action, params);
    assert.equal(predicted.state, state, `${domain}.${action}`);
    for (const [key, value] of Object.entries(attributes)) assert.equal(predicted.attributes?.[key], value, `${domain}.${action}.${key}`);
    assert.equal(predicted.room, before.room);
    assert.equal(predicted.area_id, before.area_id);
    assert.deepEqual(before, original);
  }
});

test("does not invent track information for a next-track command", () => {
  const before = device("media_player", { state: "playing", attributes: { media_title: "当前歌曲" } });
  assert.deepEqual(optimisticDevice(before, "media_next_track"), before);
});

test("color controls are additive to brightness and remain hidden for lights without color capability", () => {
  const light = device("light", { supported_actions: ["turn_on", "turn_off"] });
  assert.equal(hasDetailControls(light), false);
  assert.equal(hasDetailControls({ ...light, action_params: { turn_on: ["brightness_pct"] } }), true);
  assert.equal(hasDetailControls({ ...light, action_params: { turn_on: ["rgb_color"] } }), true);
  assert.equal(hasDetailControls({ ...light, action_params: { turn_on: ["brightness_pct", "rgb_color"] } }), true);
});

test("formats reported RGB colors without treating missing or invalid feedback as a known color", () => {
  assert.equal(lightColorHex(device("light", { attributes: { rgb_color: [255, 128, 0] } })), "#ff8000");
  for (const rgb_color of [undefined, null, [], [255, 0], [256, 0, 0], [-1, 0, 0], [NaN, 0, 0], ["255", 0, 0]]) {
    assert.equal(lightColorHex(device("light", { attributes: { rgb_color } })), undefined);
  }
});

test("predicts a color change without altering brightness, capabilities, or the previous RGB snapshot", () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, rgb_color: [255, 0, 0] } });
  const rgb = [0, 255, 0];
  const next = optimisticDevice(before, "turn_on", { rgb_color: rgb });
  assert.deepEqual(next.attributes?.rgb_color, [0, 255, 0]);
  assert.notEqual(next.attributes?.rgb_color, rgb);
  assert.equal(next.attributes?.brightness, 160);
  assert.deepEqual(before.attributes?.rgb_color, [255, 0, 0]);
});

test("waits for new color feedback even when the light was already on and accepts a separately decoded RGB array", async () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, rgb_color: [255, 0, 0] } });
  const confirmed = { ...before, attributes: { ...before.attributes, rgb_color: [0, 255, 0], color_mode: "rgb" } };
  const updates: Device[] = [];
  let reads = 0;
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgb_color: [0, 255, 0] }, {
    controlDevice: async (_id, action, params) => {
      assert.equal(action, "turn_on");
      assert.deepEqual(params, { rgb_color: [0, 255, 0] });
      return { ok: true };
    },
    listDevices: async () => [++reads === 1 ? before : confirmed],
  }, next => updates.push(next)), "confirmed");
  assert.equal(reads, 2);
  assert.equal(updates.at(-1), confirmed);
  assert.equal(updates[0].attributes?.brightness, 160);
});

test("accepts HA RGB intensity normalization and rounding while keeping brightness separate", async () => {
  const before = device("light", { state: "on", attributes: { brightness: 64, rgb_color: [0, 0, 255] } });
  const confirmed = { ...before, attributes: { brightness: 64, rgb_color: [255, 128, 65] } };
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgb_color: [128, 64, 32] }, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [confirmed],
  }, () => {}), "confirmed");
});

test("restores the previous color and brightness when a color command fails", async () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, rgb_color: [255, 0, 0] } });
  const updates: Device[] = [];
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgb_color: [0, 0, 255] }, {
    controlDevice: async () => ({ ok: false }), listDevices: async () => [],
  }, next => updates.push(next)), "failed");
  assert.equal(updates.at(-1), before);
});

test("does not confirm a color command when HA keeps reporting the previous color", async () => {
  const before = device("light", { state: "on", attributes: { rgb_color: [255, 0, 0] } });
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgb_color: [0, 255, 0] }, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [before],
  }, () => {}), "unconfirmed");
});

test("retains the last light settings when off feedback clears them, without changing the off state", () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, rgb_color: [255, 100, 0] } });
  const off = device("light", { attributes: { brightness: null, rgb_color: null, supported_color_modes: ["rgb"] } });
  const cached = retainLightSettings(off, before);
  assert.equal(cached.state, "off");
  assert.equal(cached.attributes?.brightness, 160);
  assert.deepEqual(cached.attributes?.rgb_color, [255, 100, 0]);
  assert.deepEqual(cached.attributes?.supported_color_modes, ["rgb"]);
  assert.equal(off.attributes?.brightness, null);
  assert.equal(off.attributes?.rgb_color, null);
});

test("off refreshes cannot replace the last settings with zero brightness or an off-state color", () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, rgb_color: [255, 100, 0] } });
  const off = device("light", { attributes: { brightness: 0, rgb_color: [0, 0, 0] } });
  const cached = retainLightSettings(off, before);
  assert.equal(cached.attributes?.brightness, 160);
  assert.deepEqual(cached.attributes?.rgb_color, [255, 100, 0]);
  assert.deepEqual(retainLightSettings(off, cached).attributes, cached.attributes);
});

test("fresh on-state settings replace the cache, and caches never cross device boundaries", () => {
  const before = device("light", { attributes: { brightness: 160, rgb_color: [255, 0, 0] } });
  const actual = device("light", { state: "on", attributes: { brightness: 220, rgb_color: [0, 0, 255] } });
  assert.equal(retainLightSettings(actual, before), actual);
  const another = { ...before, entity_id: "light.other", attributes: { brightness: null } };
  assert.equal(retainLightSettings(another, before), another);
  const fan = device("fan", { attributes: { brightness: null } });
  assert.equal(retainLightSettings(fan, fan), fan);
});

test("turning off retains settings and the next power-on displays them before any response", async () => {
  let current = device("light", { state: "on", attributes: { brightness: 180, rgb_color: [0, 100, 255] } });
  const update = (next: Device) => { current = next; };
  assert.equal(await controlDeviceOptimistically(current, "turn_off", undefined, {
    controlDevice: async () => ({ ok: true }),
    listDevices: async () => [device("light", { attributes: { brightness: null, rgb_color: null } })],
  }, update), "confirmed");
  assert.equal(current.state, "off");
  assert.equal(current.attributes?.brightness, 180);
  const response = deferred<{ ok: boolean }>();
  const result = controlDeviceOptimistically(current, "turn_on", undefined, {
    controlDevice: () => response.promise,
    listDevices: async () => [device("light", { state: "on", attributes: { brightness: null, rgb_color: null } })],
  }, update);
  assert.equal(current.state, "on");
  assert.equal(current.attributes?.brightness, 180);
  assert.deepEqual(current.attributes?.rgb_color, [0, 100, 255]);
  response.resolve({ ok: true });
  assert.equal(await result, "confirmed");
  assert.equal(current.attributes?.brightness, 180);
  assert.deepEqual(current.attributes?.rgb_color, [0, 100, 255]);
});

test("a failed power-on restores the off snapshot and its cached light settings", async () => {
  const before = device("light", { attributes: { brightness: 180, rgb_color: [0, 100, 255] } });
  const updates: Device[] = [];
  assert.equal(await controlDeviceOptimistically(before, "turn_on", undefined, {
    controlDevice: async () => ({ ok: false }), listDevices: async () => [],
  }, next => updates.push(next)), "failed");
  assert.equal(updates[0].state, "on");
  assert.equal(updates.at(-1), before);
});

test("zero brightness stays visibly zero after off confirmation and refresh, while power-on restores the cached brightness", async () => {
  const before = device("light", {
    state: "on", attributes: { brightness: 153 },
    supported_actions: ["turn_on", "turn_off"], action_params: { turn_on: ["brightness_pct"] },
  });
  let current = before;
  const visible: (number | undefined)[] = [];
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { brightness_pct: 0 }, {
    controlDevice: async () => ({ ok: true }),
    listDevices: async () => [{ ...before, state: "off" }],
  }, next => { current = next; visible.push(lightBrightnessPct(next)); }), "confirmed");
  assert.deepEqual(visible, [0, 0]);
  current = retainLightSettings({ ...before, state: "off", attributes: { brightness: null } }, current);
  assert.equal(lightBrightnessPct(current), 0);
  assert.deepEqual(deviceDetails(current), []);
  const reopened = optimisticDevice(current, "turn_on");
  assert.equal(lightBrightnessPct(reopened), 60);
  assert.deepEqual(deviceDetails(reopened), ["亮度 60%"]);
  assert.equal(current.attributes?.brightness, 153);
});

test("unknown brightness remains absent while off and a failed zero adjustment restores the previous display", async () => {
  assert.equal(lightBrightnessPct(device("light", { attributes: { brightness: null } })), undefined);
  const before = device("light", { state: "on", attributes: { brightness: 153 } });
  let current = before;
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { brightness_pct: 0 }, {
    controlDevice: async () => ({ ok: false }), listDevices: async () => [],
  }, next => { current = next; }), "failed");
  assert.equal(current.state, "on");
  assert.equal(lightBrightnessPct(current), 60);
});

test("native white uses W channels with all RGB channels off, and plain RGB lights get no white button", () => {
  for (const [field, channels] of [["rgbw_color", [0, 0, 0, 255]], ["rgbww_color", [0, 0, 0, 255, 0]]] as const) {
    const bulb = device("light", { supported_actions: ["turn_on"], action_params: { turn_on: [field, "rgb_color"] } });
    assert.deepEqual(whiteLightParams(bulb), { [field]: [...channels] });
    assert.deepEqual(lightColorParams(bulb, [255, 0, 0]), { [field]: [255, 0, 0, ...channels.slice(3).map(() => 0)] });
  }
  assert.equal(whiteLightParams(device("light", { supported_actions: ["turn_on"], action_params: { turn_on: ["rgb_color"] } })), undefined);
});

test("dedicated white preserves brightness and white defaults to the highest supported color temperature", () => {
  const white = device("light", { attributes: { brightness: 160 }, supported_actions: ["turn_on"], action_params: { turn_on: ["white"] } });
  assert.deepEqual(whiteLightParams(white), { white: 160 });
  const temperature = { ...white, action_params: { turn_on: ["color_temp_kelvin"] }, attributes: { min_color_temp_kelvin: 4500, max_color_temp_kelvin: 6500 } };
  assert.deepEqual(whiteLightParams(temperature), { color_temp_kelvin: 6500 });
  assert.deepEqual(whiteLightParams({ ...temperature, action_params: { turn_on: ["color_temp_kelvin", "rgbww_color"] } }), { color_temp_kelvin: 6500 });
});

test("switching to native white waits for real channel feedback while preserving the overall brightness", async () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, color_mode: "rgbw", rgbw_color: [255, 0, 0, 0] } });
  const actual = { ...before, attributes: { brightness: 160, color_mode: "rgbw", rgbw_color: [0, 0, 0, 255] } };
  const updates: Device[] = [];
  let reads = 0;
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgbw_color: [0, 0, 0, 255] }, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [++reads === 1 ? before : actual],
  }, next => updates.push(next)), "confirmed");
  assert.equal(reads, 2);
  assert.equal(isWhiteLight(updates[0]), true);
  assert.equal(updates[0].attributes?.brightness, 160);
  assert.equal(isWhiteLight(updates.at(-1)!), true);
  assert.equal(lightColorHex(actual), "#ffffff");
});

test("native white failure restores the preceding color, and stale colored feedback is never confirmed as white", async () => {
  const before = device("light", { state: "on", attributes: { brightness: 160, color_mode: "rgbw", rgbw_color: [255, 0, 0, 0] } });
  let current = before;
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgbw_color: [0, 0, 0, 255] }, {
    controlDevice: async () => ({ ok: false }), listDevices: async () => [],
  }, next => { current = next; }), "failed");
  assert.equal(current, before);
  assert.equal(await controlDeviceOptimistically(before, "turn_on", { rgbw_color: [0, 0, 0, 255] }, {
    controlDevice: async () => ({ ok: true }), listDevices: async () => [before],
  }, () => {}), "unconfirmed");
});

test("power-off and read-back preserve native white settings, and selecting a color turns white channels off", () => {
  const white = device("light", { state: "on", attributes: { brightness: 160, color_mode: "rgbw", rgbw_color: [0, 0, 0, 255] },
    supported_actions: ["turn_on"], action_params: { turn_on: ["rgb_color", "rgbw_color"] } });
  const off = retainLightSettings({ ...white, state: "off", attributes: { brightness: null, color_mode: null, rgbw_color: null } }, white);
  assert.equal(isWhiteLight(optimisticDevice(off, "turn_on")), true);
  const color = optimisticDevice(white, "turn_on", lightColorParams(white, [0, 255, 0]));
  assert.equal(isWhiteLight(color), false);
  assert.equal(lightColorHex(color), "#00ff00");
  assert.equal(color.attributes?.brightness, 160);
});

test("white confirms the highest supported color temperature only after HA reports that target", async () => {
  const before = device("light", { state: "on", attributes: {
    brightness: 160, color_mode: "color_temp", color_temp_kelvin: 3000, max_color_temp_kelvin: 6500,
  }, supported_actions: ["turn_on"], action_params: { turn_on: ["color_temp_kelvin"] } });
  const actual = { ...before, attributes: { ...before.attributes, color_temp_kelvin: 6500 } };
  const updates: Device[] = [];
  let reads = 0;
  assert.equal(await controlDeviceOptimistically(before, "turn_on", whiteLightParams(before), {
    controlDevice: async (_id, _action, params) => {
      assert.deepEqual(params, { color_temp_kelvin: 6500 });
      return { ok: true };
    }, listDevices: async () => [++reads === 1 ? before : actual],
  }, next => updates.push(next)), "confirmed");
  assert.equal(reads, 2);
  assert.equal(updates[0].attributes?.color_temp_kelvin, 6500);
  assert.equal(updates.at(-1)?.attributes?.brightness, 160);
});
