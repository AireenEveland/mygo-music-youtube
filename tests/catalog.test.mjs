// The catalog: pages, account data, search, parsing and paging.
import test from "node:test";
import assert from "node:assert/strict";
import { load, COOKIE } from "./harness.mjs";
import {
  visitorId, accountMenu, browseAnswer, searchAnswer, playlistAnswer,
  shelf, video, playlistVideo, lockup, channel, playlist, player,
} from "./fixtures.mjs";

const pages = {
  FEwhat_to_watch: () => browseAnswer([
    shelf("For you", [
      { videoRenderer: video("v1", "First") },
      { videoRenderer: video("v2", "Second") },
    ]),
  ], "HOME-2"),
  FEsubscriptions: () => browseAnswer([shelf("New uploads", [{ videoRenderer: video("s1", "Sub video") }])]),
  FEplaylist_aggregation: () => browseAnswer([
    { itemSectionRenderer: { contents: [{ playlistRenderer: playlist("PL1", "My list") }] } },
  ]),
  VLWL: () => playlistAnswer([{ playlistVideoRenderer: playlistVideo("w1", "Later") }], { name: "Watch Later", token: "WL-2" }),
  VLLL: () => browseAnswer([
    { itemSectionRenderer: { contents: [{ videoRenderer: video("l1", "Liked") }] } },
  ], "LIKED-2"),
  FEhistory: () => browseAnswer([
    { itemSectionRenderer: { contents: [{ videoRenderer: video("h1", "Watched") }] } },
  ]),
  UCchan1: () => browseAnswer([shelf("Videos", [{ videoRenderer: video("a1", "Upload") }])]),
};

const continuations = {
  "HOME-2": () => browseAnswer([shelf("More for you", [{ videoRenderer: video("v3", "Third") }])]),
  "WL-2": () => playlistAnswer([{ playlistVideoRenderer: playlistVideo("w2", "Later 2") }]),
  "LIKED-2": () => browseAnswer([{ itemSectionRenderer: { contents: [{ videoRenderer: video("l2", "Liked 2") }] } }]),
  "SEARCH-2": () => searchAnswer([{ videoRenderer: video("q3", "Second page") }]),
};

const routes = {
  visitor_id: () => visitorId,
  browse: (body) => {
    if (body.continuation) return (continuations[body.continuation] || (() => browseAnswer([])))();
    return (pages[body.browseId] || (() => browseAnswer([])))();
  },
  search: (body) => {
    if (body.continuation) return (continuations[body.continuation] || (() => searchAnswer([])))();
    return searchAnswer([
      { videoRenderer: video("q1", "Found", { length: "" }) },
      { lockupViewModel: lockup("q2", "Lockup result") },
      { channelRenderer: channel("UCx", "Some channel") },
      { playlistRenderer: playlist("PLq", "A playlist") },
    ], "SEARCH-2");
  },
  player: () => player(),
  "account/account_menu": () => accountMenu(),
  "like/like": () => ({}),
  "like/removelike": () => ({}),
  suggest: () => ["q", ["one", "two"]],
};

const signed = { settings: { manualCookie: COOKIE }, routes };

test("home lists shelves, including the continuation page", async () => {
  const { api, calls } = await load({ routes });
  const page = await api.home();
  assert.equal(page.title, "Home");
  assert.deepEqual(page.sections.map((s) => s.title), ["For you", "More for you"]);
  assert.equal(page.sections[0].tracks.length, 2);
  assert.equal(page.sections.some((s) => s.links), false);
  assert.equal(calls.filter((c) => c.endpoint === "browse").length, 2);
});

test("a session adds the library links to home", async () => {
  const { api } = await load(signed);
  const page = await api.home();
  const library = page.sections.find((s) => s.links);
  assert.deepEqual(library.links.map((l) => l.page), [
    "subscriptions", "playlists", "watchlater", "history", "liked",
  ]);
});

test("the My Page and subscription pages need a session", async () => {
  const { api } = await load({ routes });
  await assert.rejects(api.browse({ page: "subscriptions" }), (e) => e.code === "signIn");
  const { api: mine } = await load(signed);
  assert.equal((await mine.browse({ page: "me" })).title, "My Account");
  const subs = await mine.browse({ page: "subscriptions" });
  assert.equal(subs.title, "Subscriptions");
  assert.equal(subs.sections[0].tracks[0].id, "s1");
});

test("the playlists page lists the account's own playlists", async () => {
  const { api } = await load(signed);
  const page = await api.browse({ page: "playlists" });
  assert.deepEqual(page.sections[0].playlists.map((p) => p.id), ["LL", "WL", "PL1"]);
  assert.deepEqual(await api.playlists().then((all) => all.map((p) => p.id)), ["LL", "WL", "PL1"]);
});

test("Watch Later, Liked Videos and History read their own feeds", async () => {
  const { api, calls } = await load(signed);
  const later = await api.browse({ page: "watchlater" });
  assert.equal(later.title, "Watch Later");
  assert.deepEqual(later.sections[0].tracks.map((t) => t.id), ["w1", "w2"]);

  const liked = await api.browse({ page: "liked" });
  assert.equal(liked.title, "Liked Videos");
  assert.equal(liked.sections[0].tracks[0].id, "l1");

  const history = await api.browse({ page: "history" });
  assert.equal(history.title, "History");
  assert.deepEqual(history.sections[0].tracks.map((t) => t.id), ["h1"]);
  assert.equal(calls.some((c) => c.body.browseId === "VLWL"), true);
});

test("an unknown page is reported, not silently empty", async () => {
  const { api } = await load(signed);
  await assert.rejects(api.browse({ page: "nope" }), (e) => e.code === "unavailable");
});

test("a playlist keeps its title, cover and every page of tracks", async () => {
  const { api } = await load(signed);
  const list = await api.playlist({ id: "VLWL" });
  assert.equal(list.id, "WL");
  assert.equal(list.name, "Watch Later");
  assert.equal(list.owner, "Me");
  assert.equal(list.description, "Saved for later");
  assert.equal(list.mine, true);
  assert.equal(list.trackCount, 2);
  assert.deepEqual(list.tracks.map((t) => t.id), ["w1", "w2"]);
  assert.match(list.tracks[0].album.imageUrl, /i\.ytimg\.com/);
});

test("liked videos page with a continuation token", async () => {
  const { api } = await load(signed);
  const first = await api.liked({ offset: 0 });
  assert.deepEqual(first.tracks.map((t) => t.id), ["l1"]);
  assert.equal(first.more, true);
  const second = await api.liked({ offset: 1 });
  assert.deepEqual(second.tracks.map((t) => t.id), ["l2"]);
  assert.equal(second.more, false);
});

test("liking a video reaches the like endpoint and is remembered", async () => {
  const { api, calls } = await load(signed);
  assert.deepEqual(await api.isLiked({ ids: ["l1", "missing"] }), { l1: true, missing: false });
  await api.like({ id: "new", on: true });
  assert.deepEqual(await api.isLiked({ ids: ["new"] }), { new: true });
  await api.like({ id: "new", on: false });
  assert.deepEqual(await api.isLiked({ ids: ["new"] }), { new: false });
  assert.equal(calls.some((c) => c.endpoint === "like/like"), true);
  assert.equal(calls.some((c) => c.endpoint === "like/removelike"), true);
});

test("recently watched and a channel's uploads", async () => {
  const { api } = await load(signed);
  assert.deepEqual((await api.recent()).map((t) => t.id), ["h1"]);
  const artist = await api.artist({ id: "UCchan1" });
  assert.equal(artist.artist.id, "UCchan1");
  assert.deepEqual(artist.tracks.map((t) => t.id), ["a1"]);
});

test("search parses old and new renderers, fills duration and pages", async () => {
  const { api, calls } = await load(signed);
  const first = await api.search({ query: "q", kind: "tracks" });
  assert.deepEqual(first.tracks.map((t) => t.id), ["q1", "q2"]);
  assert.equal(first.tracks[0].duration, 225000);
  assert.equal(first.tracks[0].name, "Found");
  assert.equal(first.tracks[0].artists[0].name, "Channel One");
  assert.match(first.tracks[1].album.imageUrl, /i\.ytimg\.com/);
  assert.equal(first.more, true);
  assert.equal(calls.find((c) => c.endpoint === "search").body.params, "EgIQAQ==");

  const second = await api.search({ query: "q", kind: "tracks", offset: 2 });
  assert.deepEqual(second.tracks.map((t) => t.id), ["q3"]);
  assert.equal(calls.at(-1).body.continuation, "SEARCH-2");
});

test("search keeps the other kinds separate, and falls back to a plain search", async () => {
  const { api: artists } = await load(signed);
  assert.deepEqual((await artists.search({ query: "q", kind: "artists" })).artists.map((a) => a.id), ["UCx"]);
  const { api: playlists } = await load(signed);
  assert.deepEqual((await playlists.search({ query: "q", kind: "playlists" })).playlists.map((p) => p.id), ["PLq"]);
  const { api, calls } = await load({
    ...signed,
    routes: { ...routes, search: (body) => (body.params ? searchAnswer([]) : searchAnswer([{ videoRenderer: video("fb", "Fallback") }])) },
  });
  assert.deepEqual((await api.search({ query: "q", kind: "tracks" })).tracks.map((t) => t.id), ["fb"]);
  assert.equal(calls.filter((c) => c.endpoint === "search").length, 2);
});

test("a missing continuation token ends paging without a request", async () => {
  const { api, calls } = await load(signed);
  const empty = await api.search({ query: "q", kind: "tracks", offset: 99 });
  assert.deepEqual(empty.tracks, []);
  assert.equal(empty.more, false);
  assert.equal(calls.some((c) => c.endpoint === "search"), false);
});

test("suggestions read the browser's own completion service", async () => {
  const { api } = await load({ routes });
  assert.deepEqual(await api.suggest({ query: "q" }), ["one", "two"]);
});

test("the listener's own words follow the app's language", async () => {
  const { api } = await load({ routes, language: "zh-CN" });
  assert.equal((await api.home()).title, "首页");
  const { api: signedApi } = await load({ ...signed, language: "zh-CN" });
  assert.equal((await signedApi.browse({ page: "history" })).title, "观看历史");
});
