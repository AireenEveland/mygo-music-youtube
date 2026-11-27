// Signing in, signing out, and what a session is allowed to reach.
import test from "node:test";
import assert from "node:assert/strict";
import { load, COOKIE } from "./harness.mjs";
import { visitorId, accountMenu, browseAnswer, searchAnswer, player, http } from "./fixtures.mjs";

const base = {
  visitor_id: () => visitorId,
  browse: () => browseAnswer([]),
  search: () => searchAnswer([]),
  player: () => player(),
  "account/account_menu": () => accountMenu(),
};

test("signed out, account and the library answer nothing", async () => {
  const { api } = await load({ routes: base });
  assert.equal(await api.account(), null);
  assert.deepEqual(await api.playlists(), []);
  assert.deepEqual(await api.recent(), []);
});

test("signing in on Google's page keeps the cookies and signs the requests", async () => {
  let asked;
  const { api, storage, calls } = await load({
    routes: base,
    webSignIn: async (o) => { asked = o; return { cookie: COOKIE }; },
  });
  const me = await api.signIn();
  assert.equal(me.name, "My Account");
  assert.equal(me.id, "@me");
  assert.equal(me.page, "me");
  assert.equal(storage.get("cookie"), COOKIE);
  assert.equal(asked.cookiesOf, "https://www.youtube.com/");
  assert.deepEqual(asked.until, ["SAPISID", "__Secure-3PSID"]);
  assert.match(asked.url, /accounts\.google\.com\/ServiceLogin/);

  const menu = calls.find((c) => c.endpoint === "account/account_menu");
  assert.equal(menu.headers.cookie, COOKIE);
  assert.match(menu.headers.authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  assert.equal(menu.headers["x-goog-authuser"], "0");
});

test("a pasted Cookie signs in without opening a window", async () => {
  const { api, storage, calls } = await load({
    routes: base,
    settings: { manualCookie: COOKIE },
    webSignIn: () => { throw new Error("should not open a window"); },
  });
  assert.equal((await api.signIn()).name, "My Account");
  assert.equal(storage.get("cookie"), COOKIE);
  assert.equal(calls.some((c) => c.endpoint === "visitor_id"), true);
});

test("without a window or a pasted Cookie, sign-in asks for the setting", async () => {
  const { api } = await load({ routes: base });
  await assert.rejects(api.signIn(), (e) => e.code === "setup");
});

test("signing out forgets the session even when a Cookie is in the settings", async () => {
  const { api } = await load({ routes: base, settings: { manualCookie: COOKIE } });
  assert.equal((await api.account()).name, "My Account");
  api.signOut();
  assert.equal(await api.account(), null);
});

test("a 401 ends the session and asks the listener to sign in again", async () => {
  const { api, storage } = await load({
    routes: { ...base, search: () => http(401, {}) },
    settings: { manualCookie: COOKIE },
  });
  await assert.rejects(api.search({ query: "x", kind: "tracks", offset: 0 }), (e) => e.code === "signIn");
  assert.equal(storage.get("cookie"), "");
  assert.equal(await api.account(), null);
});

test("editing the Cookie setting lets the new value take effect", async () => {
  const { api, storage } = await load({
    routes: base,
    settings: { manualCookie: COOKIE },
  });
  assert.equal((await api.account()).name, "My Account");
  api.setSetting({ key: "manualCookie", value: "SAPISID=new; __Secure-3PAPISID=new" });
  assert.equal(storage.has("cookie"), false);
  assert.equal((await api.account()).name, "My Account");
});

test("the plugin's own words follow the listener's language", async () => {
  const { api } = await load({
    routes: { ...base, browse: () => browseAnswer([]) },
    language: "zh-CN",
  });
  const page = await api.home();
  assert.equal(page.title, "首页");
});
