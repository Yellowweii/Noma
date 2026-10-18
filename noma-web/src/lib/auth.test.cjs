const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

function setup({ path = "/memory/recent", search = "?history=true", refresh = false, clerk = false } = {}) {
  const requests = [];
  const redirects = [];
  const mocks = {
    "./clerk": {
      clerkPublishableKey: clerk ? "test-public-key" : "",
      hasClerkLoginIntent: () => clerk,
      getClerkSessionToken: async () => "test-clerk-token",
      signOutClerk: async () => {},
    },
    "./activeSessionStorage": { clearLoginSessionState: () => {} },
  };
  const context = {
    exports: {}, require: name => mocks[name],
    window: { location: { pathname: path, search, replace: value => redirects.push(value) } },
    fetch: async (url, options) => {
      requests.push({ url, options });
      const ok = url.endsWith("/clerk") ? clerk : refresh;
      return { ok, status: ok ? 200 : 401, json: async () => ({ access_token: "test-local-session-marker", user_id: "test-user" }) };
    },
  };
  const source = ts.transpileModule(readFileSync(join(__dirname, "auth.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(source, context);
  return { auth: context.exports, requests, redirects };
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

test("explicit Clerk login can establish the session before login enforcement redirects", async () => {
  const app = setup({ clerk: true });
  assert.equal(await app.auth.bootstrapSession(), true);
  assert.deepEqual(app.requests.map(request => request.url), ["/api/v1/auth/refresh", "/api/v1/auth/clerk"]);
  assert.equal(app.requests[1].options.headers.Authorization, "Bearer test-clerk-token");
  assert.deepEqual(app.redirects, []);
});
