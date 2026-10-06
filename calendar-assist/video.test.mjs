import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("./experiment.js", import.meta.url), "utf8");

function harness(responseBody, status = 200) {
  const calls = [];
  const logins = [];
  class LoginInfo {
    init(origin, _action, httpRealm, username, password) {
      Object.assign(this, {origin, httpRealm, username, password});
    }
    clone() { return Object.assign(new LoginInfo(), this); }
  }
  class FakeOAuth2 {
    constructor(scope, settings) { Object.assign(this, {scope, settings, extraAuthParams: []}); calls.push({kind: "oauth", scope, settings}); }
    async connect() { this.accessToken = "test-access-token"; this.refreshToken = "test-refresh-token"; }
  }
  const context = {
    URL,
    Date,
    console,
    setTimeout,
    clearTimeout,
    fetch: async (url, options) => { calls.push({kind: "fetch", url, options}); return {ok: status < 400, status, json: async () => responseBody}; },
    ChromeUtils: {importESModule(path) {
      if (path.includes("ExtensionCommon")) return {ExtensionCommon: {ExtensionAPI: class {}}};
      if (path.includes("ExtensionSupport")) return {ExtensionSupport: {}};
      if (path.includes("OAuth2")) return {OAuth2: FakeOAuth2};
      throw Error(path);
    }},
    Services: {logins: {
      searchLoginsAsync: async () => logins,
      addLoginAsync: async login => logins.push(login),
      modifyLoginAsync: async (old, updated) => Object.assign(old, updated),
    }},
    Cc: {"@mozilla.org/login-manager/loginInfo;1": {createInstance: () => new LoginInfo()}},
    Ci: {nsILoginInfo: {}},
  };
  vm.runInNewContext(source, context, {filename: "experiment.js"});
  return {assist: new context.calendarAssist(), calls, logins};
}

test("Google Meet uses only the created-space scope and adds no unrelated permission", async () => {
  const h = harness({meetingUri: "https://meet.google.com/abc-defg-hij"});
  h.assist.videoConfig = {googleClientId: "desktop.apps.googleusercontent.com", googleClientSecret: "desktop-public", zoomClientId: ""};
  const link = await h.assist.createVideo("google", {});
  assert.equal(link, "https://meet.google.com/abc-defg-hij");
  assert.equal(h.calls[0].scope, "https://www.googleapis.com/auth/meetings.space.created");
  assert.equal(h.calls[0].settings.usePKCE, true);
  assert.equal(h.calls[0].settings.redirectionEndpoint, "http://127.0.0.1/callback");
  assert.equal(JSON.stringify([...h.assist.oauth.values()][0].extraAuthParams), JSON.stringify([["access_type", "offline"], ["prompt", "consent"]]));
  assert.equal(h.calls[1].url, "https://meet.googleapis.com/v2/spaces");
  assert.equal(h.calls[1].options.headers.Authorization, "Bearer test-access-token");
  assert.equal(h.logins[0].password, "test-refresh-token");
});

test("Zoom schedules the event at the local selection represented in UTC", async () => {
  const h = harness({join_url: "https://us06web.zoom.us/j/123456789?pwd=abc"});
  h.assist.videoConfig = {googleClientId: "", googleClientSecret: "", zoomClientId: "zoom-public"};
  const start = new Date("2026-10-08T09:00:00Z");
  const end = new Date("2026-10-08T10:30:00Z");
  const link = await h.assist.createVideo("zoom", {title: "Taglio capelli", start, end, allDay: false});
  assert.equal(link, "https://us06web.zoom.us/j/123456789?pwd=abc");
  assert.equal(h.calls[0].scope, "meeting:write:meeting");
  assert.equal(h.calls[0].settings.clientSecret, null);
  const request = h.calls[1];
  assert.equal(request.url, "https://api.zoom.us/v2/users/me/meetings");
  assert.deepEqual(JSON.parse(request.options.body), {
    topic: "Taglio capelli", type: 2, start_time: "2026-10-08T09:00:00Z", duration: 90, timezone: "UTC",
  });
});

test("invalid times, links and API errors do not yield a meeting", async () => {
  const h = harness({join_url: "https://attacker.example/j/123"});
  h.assist.videoConfig = {googleClientId: "", googleClientSecret: "", zoomClientId: "zoom-public"};
  await assert.rejects(h.assist.createVideo("zoom", {allDay: true}), /orario valido/);
  assert.equal(h.calls.length, 0);
  await assert.rejects(h.assist.createVideo("zoom", {title: "Test", start: new Date(0), end: new Date(3600000), allDay: false}), /link valido/);
  const failed = harness({}, 403);
  failed.assist.videoConfig = {googleClientId: "google", googleClientSecret: "", zoomClientId: ""};
  await assert.rejects(failed.assist.createVideo("google", {}), /HTTP 403/);
});
