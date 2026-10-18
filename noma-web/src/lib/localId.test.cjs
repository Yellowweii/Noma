const assert = require("node:assert/strict");
const { test } = require("node:test");
const { localUUID } = require("./localId.ts");

test("LAN HTTP fallback still creates IDs accepted by existing session storage", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, value: { getRandomValues(bytes) { bytes.fill(21); return bytes; } } });
  try { assert.match(localUUID(), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/); }
  finally { if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor); else delete globalThis.crypto; }
});
