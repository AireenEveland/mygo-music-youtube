// Reporting a play: one honest report per real play, to YouTube alone.
import test from "node:test";
import assert from "node:assert/strict";
import { load, COOKIE } from "./harness.mjs";
import { visitorId, player, playbackURL, playbackTracking, http } from "./fixtures.mjs";

const base = {
  visitor_id: () => visitorId,
  player: () => player(),
  stats: () => ({}),
};
const signed = { settings: { manualCookie: COOKIE } };
const statsCalls = (calls) => calls.filter((c) => c.endpoint === "stats");

test("a real play is reported once to YouTube, with the session and a nonce", async () => {
  const { api, calls, spawns } = await load({ routes: base, ...signed });
  await api.stream({ id: "v1" });
  const before = statsCalls(calls).length;
  assert.equal(before, 0, "stream() itself must not report a play");
  const spawned = spawns.length;

  await api.played({ id: "v1" });
  const reports = statsCalls(calls);
  assert.equal(reports.length, 1, "exactly one report for one play");

  const url = new URL(reports[0].url);
  assert.equal(url.hostname, "www.youtube.com");
  assert.equal(url.protocol, "https:");
  assert.equal(url.pathname, "/api/stats/playback");
  assert.equal(url.searchParams.get("ver"), "2");
  assert.equal(url.searchParams.get("c"), "WEB");
  assert.match(url.searchParams.get("cpn") || "", /^[A-Za-z0-9_-]{16}$/);
  assert.equal(url.searchParams.get("el"), "detailpage", "the address's own params survive");

  const headers = reports[0].headers;
  assert.equal(headers.cookie, COOKIE);
  assert.match(headers.authorization, /^SAPISIDHASH \d+_[0-9a-f]{40}$/);
  assert.equal(headers["x-goog-authuser"], "0");
  assert.ok(headers["user-agent"]);
  assert.equal(headers.referer, "https://www.youtube.com/");
  assert.equal(spawns.length, spawned, "reporting starts no program of its own");
});

test("the report reuses the player answer stream() already fetched", async () => {
  const { api, calls } = await load({ routes: base, ...signed });
  await api.stream({ id: "v1" });
  const players = calls.filter((c) => c.endpoint === "player").length;
  await api.played({ id: "v1" });
  assert.equal(calls.filter((c) => c.endpoint === "player").length, players);
  assert.equal(statsCalls(calls).length, 1);
});

test("a play reported without a preceding stream still finds its address", async () => {
  const { api, calls } = await load({ routes: base, ...signed });
  await api.played({ id: "v1" });
  assert.ok(calls.some((c) => c.endpoint === "player"), "asks the web player once");
  assert.equal(statsCalls(calls).length, 1);
});

test("two plays get different nonces", async () => {
  const { api, calls } = await load({ routes: base, ...signed });
  await api.played({ id: "v1" });
  await api.played({ id: "v2" });
  const nonces = statsCalls(calls).map((c) => new URL(c.url).searchParams.get("cpn"));
  assert.equal(nonces.length, 2);
  assert.notEqual(nonces[0], nonces[1]);
});

test("signed out, nothing is reported", async () => {
  const { api, calls, warnings } = await load({ routes: base });
  await api.played({ id: "v1" });
  assert.equal(statsCalls(calls).length, 0);
  assert.equal(warnings.length, 0);
});

test("turning reporting off keeps listening out of the history", async () => {
  const { api, calls } = await load({ routes: base, settings: { manualCookie: COOKIE, reportPlayback: "off" } });
  await api.played({ id: "v1" });
  assert.equal(statsCalls(calls).length, 0);
});

test("an address outside youtube.com is refused, with the cookie kept", async () => {
  const evil = playbackTracking("https://tracker.example.com/api/stats/playback?docid=v1");
  const { api, calls, warnings } = await load({
    routes: { ...base, player: () => player({ tracking: evil }) },
    ...signed,
  });
  await api.played({ id: "v1" });
  assert.equal(statsCalls(calls).length, 0);
  assert.ok(warnings.some((w) => /not sending your session/.test(w)));
});

test("an http:// address is refused too", async () => {
  const insecure = playbackTracking("http://www.youtube.com/api/stats/playback?docid=v1");
  const { api, calls, warnings } = await load({
    routes: { ...base, player: () => player({ tracking: insecure }) },
    ...signed,
  });
  await api.played({ id: "v1" });
  assert.equal(statsCalls(calls).length, 0);
  assert.ok(warnings.length > 0);
});

test("a player answer with no tracking reports nothing, without failing", async () => {
  const { api, calls, warnings } = await load({
    routes: { ...base, player: () => player({ tracking: null }) },
    ...signed,
  });
  await assert.doesNotReject(() => api.played({ id: "v1" }));
  assert.equal(statsCalls(calls).length, 0);
  assert.ok(warnings.some((w) => /no address/.test(w)));
});

test("a failed report never breaks playback", async () => {
  const { api, calls, warnings } = await load({
    routes: { ...base, stats: () => http(503) },
    ...signed,
  });
  await assert.doesNotReject(() => api.played({ id: "v1" }));
  assert.equal(statsCalls(calls).length, 1);
  assert.ok(warnings.some((w) => /503/.test(w)));
});

test("an empty id is ignored", async () => {
  const { api, calls } = await load({ routes: base, ...signed });
  await api.played({ id: "" });
  assert.equal(calls.length, 0);
});
