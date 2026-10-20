const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup({ path = "/memory/recent", search = "?history=true", refresh = false, status = refresh ? 200 : 401, networkError = false, malformed = false } = {}) {
  const requests = [];
  const redirects = [];
  const clearedSessions = [];
  const mocks = {
    "./activeSessionStorage": { clearLoginSessionState: () => clearedSessions.push(true) },
  };
  const context = {
    exports: {}, require: name => mocks[name],
    window: { location: { pathname: path, search, replace: value => redirects.push(value) } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (networkError) throw new Error("temporary network failure");
      return { ok: status === 200, status, json: async () => malformed ? {} : ({ access_token: "test-local-session-marker", user_id: "test-user" }) };
    },
  };
  const source = ts.transpileModule(readFileSync(join(__dirname, "auth.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, context);
  return { auth: context.exports, requests, redirects, clearedSessions };
}

test("expired cloud login clears identity and returns to login with the original destination", async () => {
  const app = setup();
  app.auth.setAccessToken("expired-test-marker");
  app.auth.setUserId("previous-user");
  assert.equal(await app.auth.recoverAccessToken(), false);
  assert.equal(app.auth.getAccessToken(), null);
  assert.equal(app.auth.getUserId(), null);
  assert.deepEqual(app.redirects, ["/login?next=%2Fmemory%2Frecent%3Fhistory%3Dtrue"]);
});

test("parallel bootstrap restores one authenticated session without entering guest mode", async () => {
  const app = setup({ refresh: true });
  assert.deepEqual(await Promise.all([app.auth.bootstrapSession(), app.auth.bootstrapSession()]), [true, true]);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].options.credentials, "include");
  assert.equal(app.auth.getUserId(), "test-user");
  assert.deepEqual(app.redirects, []);
});

test("failed login recovery on the login page does not redirect in a loop", async () => {
  const app = setup({ path: "/login/complete" });
  assert.equal(await app.auth.recoverAccessToken(), false);
  assert.deepEqual(app.redirects, []);
});

for (const [name, options] of Object.entries({
  "gateway unavailable": { status: 502 },
  "cloud unavailable": { status: 503 },
  "rate limited": { status: 429 },
  "network failure": { networkError: true },
  "invalid sync response": { refresh: true, malformed: true },
})) {
  test(`${name} preserves identity without redirecting to login`, async () => {
    const app = setup(options);
    app.auth.setAccessToken("existing-local-marker");
    app.auth.setUserId("current-user");
    await assert.rejects(app.auth.recoverAccessToken());
    assert.equal(app.auth.getAccessToken(), "existing-local-marker");
    assert.equal(app.auth.getUserId(), "current-user");
    assert.deepEqual(app.redirects, []);
    // A failed single-flight refresh must not leave subsequent attempts stuck.
    await assert.rejects(app.auth.recoverAccessToken());
    assert.equal(app.requests.length, 2);
  });
}

test("failed durable logout keeps the current identity available for another attempt", async () => {
  const app = setup({ status: 500 });
  app.auth.setAccessToken("existing-local-marker");
  app.auth.setUserId("current-user");
  await assert.rejects(app.auth.logoutSession());
  assert.equal(app.auth.getUserId(), "current-user");
  assert.equal(app.auth.getAccessToken(), "existing-local-marker");
  assert.deepEqual(app.clearedSessions, []);
});

test("successful durable logout clears the local identity and conversation state", async () => {
  const app = setup({ status: 200 });
  app.auth.setAccessToken("existing-local-marker");
  app.auth.setUserId("current-user");
  await app.auth.logoutSession();
  assert.equal(app.auth.getUserId(), null);
  assert.equal(app.auth.getAccessToken(), null);
  assert.deepEqual(app.clearedSessions, [true]);
});
