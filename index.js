// YouTube for MyGo Music, for personal use.
//
// The catalog is the one YouTube's own website asks for (its InnerTube API).
// Signing in happens on Google's page in a window of the app, and the cookies
// of that session are kept in the plugin's data on this machine. Your library,
// playlists, subscriptions, history and liked videos are read with them.
//
// A video's audio is the address YouTube's Vision Pro player is given. ffmpeg
// turns it into MP3 on this machine and serves it to the app over localhost,
// so any codec works and an older app can play it too. yt-dlp is an optional
// fallback for the day that address needs YouTube's JavaScript to be worked
// out. YouTube's private API may change without notice.

const site = "https://www.youtube.com";
const webUA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const visionUA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";
// A client version YouTube's website answers to. This is the one thing that
// needs an edit when YouTube changes the shape of its answers.
const webVersion = "2.20250312.01.00";
const t = host.t;

function fail(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// ---------------------------------------------------------------- small tools

function walk(node, visit) {
  if (Array.isArray(node)) {
    for (const x of node) walk(x, visit);
  } else if (node && typeof node === "object") {
    visit(node);
    for (const v of Object.values(node)) walk(v, visit);
  }
}

// Answers are deep and change shape, so what's in them is found by name.
function findAll(node, name, out = []) {
  if (Array.isArray(node)) {
    for (const x of node) findAll(x, name, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (key === name) out.push(value);
      else findAll(value, name, out);
    }
  }
  return out;
}
const findOne = (node, name) => findAll(node, name)[0];

// All the renderers we know, in the order they appear in an answer. A matched
// renderer isn't walked into, so a wrapper never doubles its contents.
function collect(node, names, out = []) {
  if (Array.isArray(node)) {
    for (const x of node) collect(x, names, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (names.includes(key)) out.push({ kind: key, value });
      else collect(value, names, out);
    }
  }
  return out;
}

function textOf(x) {
  if (!x) return "";
  if (typeof x === "string") return x;
  if (typeof x.content === "string") return x.content;
  if (typeof x.simpleText === "string") return x.simpleText;
  if (Array.isArray(x.runs)) return x.runs.map((r) => r?.text ?? r?.content ?? "").join("");
  if (typeof x.text === "string") return x.text;
  return "";
}

function msOf(text) {
  const s = String(text || "").trim();
  if (!/^\d+(:\d+)+$/.test(s)) return 0;
  return s.split(":").reduce((sum, n) => sum * 60 + Number(n), 0) * 1000;
}

function numberOf(x) {
  if (typeof x === "number") return x;
  const match = String(x || "").replace(/,/g, "").match(/\d+/);
  return match ? Number(match[0]) : 0;
}

// The largest picture in a renderer, by its declared width. Only YouTube's
// image hosts count, so a navigation URL is never taken for a cover.
function imageOf(node) {
  let best = "";
  let width = -1;
  walk(node, (o) => {
    const url = o.url;
    if (typeof url !== "string" || !/(ytimg\.com|ggpht\.com|googleusercontent\.com|gvt1\.com)/.test(url)) return;
    const w = Number(o.width) || 0;
    if (w >= width) {
      width = w;
      best = url;
    }
  });
  return best || undefined;
}

const plainId = (id) => String(id || "").replace(/^VL/, "");
const watchURL = (id) => `${site}/watch?v=${id}`;
const lang = () => (host.language() === "zh-CN" ? "zh-CN" : "en");

// ------------------------------------------------------------------ session

// A Cookie header from the sign-in window, or one pasted into the settings.
// An empty string in storage means "signed out", and keeps the setting from
// signing the listener back in until they ask to.
function cookie() {
  const saved = host.storage.get("cookie");
  if (saved !== null && saved !== undefined) return saved || "";
  return host.setting("manualCookie") || "";
}
const signedIn = () => Boolean(cookie());

function endSession() {
  host.storage.set("cookie", "");
  tokens.clear();
  likedSet = null;
}
function needAccount() {
  if (!signedIn()) throw fail("signIn", t("Sign in first"));
}

function cookieValue(name) {
  for (const part of cookie().split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return "";
}

// SHA-1 in plain JavaScript: the SAPISIDHASH header is a hash of the time, the
// session's SAPISID cookie and the origin of the request.
function sha1(text) {
  const bytes = [...new TextEncoder().encode(text)];
  const bits = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 7; i >= 0; i--) bytes.push(i >= 4 ? 0 : (bits >>> (i * 8)) & 0xff);
  const rotl = (x, n) => (x << n) | (x >>> (32 - n));
  const h = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
  for (let at = 0; at < bytes.length; at += 64) {
    const w = [];
    for (let i = 0; i < 16; i++) {
      w[i] = (bytes[at + i * 4] << 24) | (bytes[at + i * 4 + 1] << 16) | (bytes[at + i * 4 + 2] << 8) | bytes[at + i * 4 + 3];
    }
    for (let i = 16; i < 80; i++) w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
    let [a, b, c, d, e] = h;
    for (let i = 0; i < 80; i++) {
      const [f, k] =
        i < 20 ? [(b & c) | (~b & d), 0x5a827999]
        : i < 40 ? [b ^ c ^ d, 0x6ed9eba1]
        : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc]
        : [b ^ c ^ d, 0xca62c1d6];
      const next = (rotl(a, 5) + f + e + k + w[i]) | 0;
      [e, d, c, b, a] = [d, c, rotl(b, 30), a, next];
    }
    [a, b, c, d, e].forEach((v, i) => (h[i] = (h[i] + v) | 0));
  }
  return h.map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}

function authHeaders(origin = site) {
  const sapisid = cookieValue("__Secure-3PAPISID") || cookieValue("SAPISID");
  if (!sapisid) return {};
  const now = Math.floor(Date.now() / 1000);
  return {
    cookie: cookie(),
    authorization: `SAPISIDHASH ${now}_${sha1(`${now} ${sapisid} ${origin}`)}`,
    "x-goog-authuser": "0",
  };
}

// ----------------------------------------------------------------- InnerTube

let visitor = "";

function webClient() {
  return {
    client: { clientName: "WEB", clientVersion: webVersion, hl: lang(), gl: "US" },
    name: "1",
    version: webVersion,
    ua: webUA,
    anonymous: false,
  };
}

// YouTube's app for the Vision Pro is given audio addresses that need no
// signature worked out. It asks as a visitor: a session is turned down.
function visionClient() {
  return {
    client: {
      clientName: "VISIONOS",
      clientVersion: "1.02",
      deviceMake: "Apple",
      deviceModel: "RealityDevice17,1",
      userAgent: visionUA,
      osName: "visionOS",
      osVersion: "26.5.23O471",
      visitorData: visitor,
    },
    name: "101",
    version: "1.02",
    ua: visionUA,
    anonymous: true,
  };
}

async function raw(endpoint, body, as) {
  const headers = {
    "content-type": "application/json",
    "user-agent": as.ua,
    origin: site,
    "x-origin": site,
    "x-youtube-client-name": as.name,
    "x-youtube-client-version": as.version,
    ...(visitor && !as.skipVisitor ? { "x-goog-visitor-id": visitor } : {}),
    ...(as.anonymous ? {} : authHeaders()),
    ...(as.headers || {}),
  };
  return fetch(`${site}/youtubei/v1/${endpoint}?prettyPrint=false`, {
    method: "POST",
    headers,
    body: JSON.stringify({ context: { client: as.client }, ...body }),
  });
}

// A visit gets an ID before YouTube gives it any audio, or asks if it's a bot.
async function ensureVisitor() {
  if (visitor) return;
  try {
    const res = await raw("visitor_id", {}, { ...webClient(), anonymous: true, skipVisitor: true });
    visitor = (await res.json()).responseContext?.visitorData || "";
  } catch (e) {
    console.warn(`visitor_id: ${e.message}`);
  }
}

async function call(endpoint, body, as = webClient()) {
  if (!as.skipVisitor) await ensureVisitor();
  const res = await raw(endpoint, body, as);
  if (res.status === 401 && !as.anonymous) {
    endSession();
    throw fail("signIn", t("Your YouTube session has ended: sign in again"));
  }
  if (!res.ok) throw new Error(`${endpoint}: ${res.status}`);
  const answer = await res.json();
  if (answer?.error) throw new Error(`${endpoint}: ${answer.error.message || answer.error.code}`);
  return answer;
}

const browseId = (id, extra = {}) => call("browse", { browseId: id, ...extra });

// The app asks for pages by how much it has, the service by an opaque token:
// this is which token goes with how much.
const tokens = new Map();
function pageToken(key, offset) {
  return offset > 0 ? tokens.get(`${key}\0${offset}`) || "" : "";
}
function keepToken(key, offset, token) {
  if (token) tokens.set(`${key}\0${offset}`, token);
  return Boolean(token);
}

function nextToken(answer) {
  const item = findOne(answer, "continuationItemRenderer");
  const command = item?.continuationEndpoint?.continuationCommand || findOne(item, "continuationCommand");
  const older = findOne(answer, "nextContinuationData");
  return command?.token || older?.continuation || findOne(answer, "continuationCommand")?.token || "";
}

// ------------------------------------------------------------------- parsing

const itemKeys = [
  "videoRenderer",
  "playlistVideoRenderer",
  "gridVideoRenderer",
  "compactVideoRenderer",
  "playlistRenderer",
  "gridPlaylistRenderer",
  "channelRenderer",
  "gridChannelRenderer",
  "lockupViewModel",
];
// A playlistVideoRenderer is a track, not a playlist: match by exact name.
const playlistKeys = ["playlistRenderer", "gridPlaylistRenderer"];
const artistKeys = ["channelRenderer", "gridChannelRenderer"];

function channelIdOf(v) {
  const found = findOne(v, "browseId");
  return typeof found === "string" && /^UC|^FEmusic|^VL/.test(found) ? found : "";
}

function trackOf(v) {
  const id = v.videoId || v.contentId;
  if (!id) return null;
  const length = textOf(v.lengthText) || textOf(findOne(v, "thumbnailOverlayTimeStatusRenderer")?.text);
  const byline =
    textOf(v.ownerText) || textOf(v.longBylineText) || textOf(v.shortBylineText) || textOf(v.bylineText);
  return {
    id,
    name: textOf(v.title) || textOf(v.headline) || "",
    artists: [{ id: channelIdOf(v), name: byline }],
    // MyGo Music takes a track's cover from its album. A video has no album.
    album: { id: "", name: "", imageUrl: imageOf(v) },
    duration: msOf(length),
    url: watchURL(id),
  };
}

function playlistOf(p) {
  const id = plainId(p.playlistId || p.contentId || "");
  if (!id) return null;
  return {
    id,
    name: textOf(p.title) || "",
    imageUrl: imageOf(p),
    owner: textOf(p.shortBylineText) || textOf(p.longBylineText) || "",
    trackCount: numberOf(textOf(p.videoCountText) || textOf(p.videoCountShortText) || p.videoCount),
  };
}

function artistOf(c) {
  const found = findOne(c, "browseId");
  const id = c.channelId || c.contentId || (typeof found === "string" ? found : "");
  const name = textOf(c.title) || "";
  if (!id || !name) return null;
  return { id, name, imageUrl: imageOf(c) };
}

// YouTube is moving its lists from the old renderers to lockupViewModel. Its
// words live in metadataParts, so the same loose reading works for both shapes.
function lockupOf(l) {
  const id = l.contentId;
  if (!id) return null;
  const type = String(l.contentType || "");
  const meta = l.metadata?.lockupMetadataViewModel || {};
  const name = textOf(meta.title) || "";
  const image = imageOf(l);
  const words = [];
  for (const parts of findAll(meta, "metadataParts")) {
    for (const part of parts || []) {
      const s = textOf(part?.text);
      if (s) words.push(s);
    }
  }
  if (/PLAYLIST/.test(type)) {
    return { kind: "playlist", value: { id: plainId(id), name, imageUrl: image, owner: words[0] || "" } };
  }
  if (/CHANNEL/.test(type)) {
    return { kind: "artist", value: { id, name, imageUrl: image } };
  }
  if (!/VIDEO|CLIP/.test(type)) return null;
  return {
    kind: "track",
    value: {
      id,
      name,
      artists: [{ id: "", name: words[0] || "" }],
      album: { id: "", name: "", imageUrl: image },
      duration: msOf(words.find((w) => /^\d+(:\d+)+$/.test(w))),
      url: watchURL(id),
    },
  };
}

function itemsOf(answer) {
  const out = [];
  const seen = new Set();
  for (const { kind, value } of collect(answer, itemKeys)) {
    let got = null;
    if (kind === "lockupViewModel") {
      got = lockupOf(value);
    } else if (playlistKeys.includes(kind)) {
      const p = playlistOf(value);
      got = p && { kind: "playlist", value: p };
    } else if (artistKeys.includes(kind)) {
      const a = artistOf(value);
      got = a && { kind: "artist", value: a };
    } else {
      const track = trackOf(value);
      got = track && { kind: "track", value: track };
    }
    if (!got || !got.value?.id) continue;
    const key = `${got.kind}\0${got.value.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(got);
  }
  return out;
}

const ofKind = (items, kind) => items.filter((i) => i.kind === kind).map((i) => i.value);

function rowsOf(answer) {
  return { items: itemsOf(answer), token: nextToken(answer) };
}

function sectionOf(node, title = "") {
  const items = itemsOf(node);
  return {
    title: title || textOf(node.title) || textOf(findOne(node, "title")),
    tracks: ofKind(items, "track"),
    playlists: ofKind(items, "playlist"),
    artists: ofKind(items, "artist"),
  };
}

// Home is a page of shelves. With none, the whole answer is one section.
function sectionsOf(answer) {
  const shelves = collect(answer, ["richShelfRenderer", "shelfRenderer", "musicShelfRenderer"]);
  const parts = shelves.length ? shelves.map((s) => s.value) : [answer];
  return parts.map((p) => sectionOf(p)).filter((s) => s.tracks.length || s.playlists.length || s.artists.length);
}

// The player answers how long a video is. Only a few rows ever lack it.
const players = new Map();
async function playerOf(id, which = "vision") {
  const key = `${which}\0${id}`;
  const known = players.get(key);
  if (known && Date.now() - known.at < 50 * 60 * 1000) return known.answer;
  const as = which === "vision" ? visionClient() : webClient();
  const answer = await call("player", { videoId: id, contentCheckOk: true, racyCheckOk: true }, as);
  players.set(key, { answer, at: Date.now() });
  return answer;
}

async function withDurations(tracks) {
  const missing = tracks.filter((x) => !x.duration).slice(0, 6);
  await Promise.all(
    missing.map(async (track) => {
      try {
        const r = await playerOf(track.id);
        track.duration = Number(r.videoDetails?.lengthSeconds || 0) * 1000;
      } catch (e) {
        console.warn(`length of ${track.id}: ${e.message}`);
      }
    }),
  );
  return tracks;
}

// -------------------------------------------------------------------- account

const signInPage =
  "https://accounts.google.com/ServiceLogin?service=youtube&uilel=3&passive=true" +
  "&continue=https%3A%2F%2Fwww.youtube.com%2Fsignin%3Faction_handle_signin%3Dtrue%26app%3Ddesktop%26next%3Dhttps%253A%252F%252Fwww.youtube.com%252F";

// Google turns down signing in on a page it takes for one inside an app, so
// the window is told it's the system's own browser.
const browserUA =
  host.platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15"
    : webUA;

export async function signIn() {
  const pasted = host.setting("manualCookie");
  if (pasted) {
    host.storage.set("cookie", pasted);
  } else if (typeof host.webSignIn === "function") {
    const { cookie: session } = await host.webSignIn({
      url: signInPage,
      cookiesOf: `${site}/`,
      until: ["SAPISID", "__Secure-3PSID"],
      userAgent: browserUA,
    });
    host.storage.set("cookie", session || "");
  } else {
    throw fail("setup", t("Paste a Cookie header in the plugin settings to sign in"));
  }
  tokens.clear();
  likedSet = null;
  const me = await account();
  if (!me) {
    endSession();
    throw new Error(t("YouTube didn't take that sign-in: try again"));
  }
  return me;
}

export function signOut() {
  endSession();
  players.clear();
  located.clear();
}

export async function account() {
  if (!signedIn()) return null;
  let answer;
  try {
    answer = await call("account/account_menu", {});
  } catch (e) {
    if (e.code === "signIn") throw e;
    // An account menu that answers but isn't shaped as expected still means the
    // cookies are there; the library will tell us if they aren't.
    return { id: "me", name: t("My Page"), page: "me" };
  }
  const header = findOne(answer, "activeAccountHeaderRenderer") || {};
  const name = textOf(header.accountName) || textOf(findOne(answer, "accountName"));
  if (!name) return null;
  return {
    id: textOf(header.channelHandle) || "me",
    name,
    imageUrl: imageOf(header.accountPhoto),
    page: "me",
  };
}

export function setSetting({ key, value }) {
  if (key === "manualCookie") {
    // Let a pasted Cookie take effect, or forget one that was cleared.
    host.storage.remove("cookie");
    likedSet = null;
    tokens.clear();
  }
  if (key === "audioClient") located.clear();
}

// ---------------------------------------------------------------------- pages

export async function home() {
  const answer = await browseId("FEwhat_to_watch");
  const sections = sectionsOf(answer);
  // It comes in pages. One more makes a page worth scrolling.
  const token = nextToken(answer);
  if (token) {
    try {
      sections.push(...sectionsOf(await call("browse", { continuation: token })));
    } catch (e) {
      console.warn(`home continuation: ${e.message}`);
    }
  }
  if (signedIn()) {
    sections.push({
      title: t("Your library"),
      links: [
        { title: t("Subscriptions"), page: "subscriptions" },
        { title: t("Playlists"), page: "playlists" },
        { title: t("Watch Later"), page: "watchlater" },
        { title: t("History"), page: "history" },
        { title: t("Liked Videos"), page: "liked" },
      ],
    });
  }
  return { title: t("Home"), sections };
}

async function libraryLinks() {
  const me = await account();
  return {
    title: me?.name || t("My Page"),
    imageUrl: me?.imageUrl,
    sections: [
      {
        title: t("Your library"),
        links: [
          { title: t("Subscriptions"), page: "subscriptions" },
          { title: t("Playlists"), page: "playlists" },
          { title: t("Watch Later"), page: "watchlater" },
          { title: t("History"), page: "history" },
          { title: t("Liked Videos"), page: "liked" },
        ],
      },
    ],
  };
}

export async function browse({ page }) {
  switch (page) {
    case "me":
      return libraryLinks();
    case "subscriptions": {
      needAccount();
      const answer = await browseId("FEsubscriptions");
      const sections = sectionsOf(answer);
      if (!sections.length) {
        return { title: t("Subscriptions"), sections: [{ title: t("Videos"), empty: t("No subscriptions yet") }] };
      }
      return { title: t("Subscriptions"), sections };
    }
    case "playlists": {
      needAccount();
      const all = await playlists();
      return {
        title: t("Playlists"),
        sections: [{ title: t("Your playlists"), playlists: all, empty: t("No playlists yet") }],
      };
    }
    case "watchlater": {
      needAccount();
      const list = await playlist({ id: "WL" });
      return { title: t("Watch Later"), sections: [{ title: t("Videos"), tracks: list.tracks, empty: t("Nothing here yet") }] };
    }
    case "liked":
    case "history": {
      needAccount();
      const tracks = page === "history" ? await recent() : (await liked({ offset: 0 })).tracks;
      return {
        title: page === "history" ? t("History") : t("Liked Videos"),
        sections: [{ title: t("Videos"), tracks, empty: t("Nothing here yet") }],
      };
    }
    default:
      throw fail("unavailable", t("no such page"));
  }
}

// --------------------------------------------------------------------- search

// Search filters as the website sends them. If one stops answering, a plain
// search is tried and filtered here, so the tab doesn't come back empty.
const filters = {
  tracks: "EgIQAQ==",
  artists: "EgIQAg==",
  playlists: "EgIQAw==",
};
const searchKinds = { tracks: "track", artists: "artist", playlists: "playlist" };

export async function search({ query, kind, offset = 0 }) {
  const wanted = searchKinds[kind];
  if (!wanted) return { [kind]: [], more: false };
  const key = `search\0${kind}\0${query}`;
  const token = pageToken(key, offset);
  if (offset > 0 && !token) return { [kind]: [], more: false };

  let answer = await call("search", token ? { continuation: token } : { query, params: filters[kind] });
  let { items, token: next } = rowsOf(answer);
  let found = ofKind(items, wanted);
  if (!found.length && !token) {
    answer = await call("search", { query });
    ({ items, token: next } = rowsOf(answer));
    found = ofKind(items, wanted);
  }
  if (wanted === "track") await withDurations(found);
  return { [kind]: found, more: keepToken(key, offset + found.length, next) };
}

export async function suggest({ query }) {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${lang()}&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "user-agent": webUA } });
  if (!res.ok) return [];
  const body = await res.json();
  return Array.isArray(body?.[1]) ? body[1].filter((s) => typeof s === "string") : [];
}

// --------------------------------------------------------------------- library

// Liked videos and Watch Later are playlists YouTube keeps itself.
const fixedPlaylists = [
  { id: "LL", name: t("Liked Videos"), mine: true, fixed: true },
  { id: "WL", name: t("Watch Later"), mine: true, fixed: true },
];

// YouTube has moved this feed a few times. Try the ids it has used, and keep
// whichever answers with playlists for this visit.
const playlistFeeds = ["FEplaylist_aggregation", "FElibrary", "FEmy_youtube"];
let workingFeed = "";

async function feedPlaylists() {
  const tries = workingFeed ? [workingFeed, ...playlistFeeds.filter((id) => id !== workingFeed)] : playlistFeeds;
  for (const id of tries) {
    try {
      const found = ofKind(itemsOf(await browseId(id)), "playlist");
      if (found.length) {
        workingFeed = id;
        return found;
      }
    } catch (e) {
      console.warn(`playlists from ${id}: ${e.message}`);
    }
  }
  return [];
}

export async function playlists() {
  if (!signedIn()) return [];
  const found = await feedPlaylists();
  const own = found.map((p) => ({ ...p, mine: true, saved: false }));
  const known = new Set(own.map((p) => p.id));
  return [...fixedPlaylists.filter((p) => !known.has(p.id)), ...own];
}

async function allTracks(answer, cap = 20) {
  let { items, token } = rowsOf(answer);
  const tracks = ofKind(items, "track");
  for (let i = 0; token && i < cap; i++) {
    ({ items, token } = rowsOf(await call("browse", { continuation: token })));
    tracks.push(...ofKind(items, "track"));
  }
  return tracks;
}

export async function playlist({ id }) {
  if (!id) throw fail("unavailable", t("no such page"));
  const plain = plainId(id);
  const answer = await browseId(`VL${plain}`);
  const header = findOne(answer, "playlistHeaderRenderer") || {};
  const tracks = await withDurations(await allTracks(answer));
  const fixed = fixedPlaylists.find((p) => p.id === plain);
  return {
    id: plain,
    name: fixed?.name || textOf(header.title) || textOf(findOne(answer, "title")) || "",
    imageUrl: imageOf(header) || tracks[0]?.album?.imageUrl,
    description: textOf(header.description) || "",
    owner: textOf(header.ownerText) || textOf(header.straplineTextOne) || "",
    trackCount: tracks.length,
    mine: Boolean(fixed),
    fixed: Boolean(fixed),
    tracks,
  };
}

export async function liked({ offset = 0 } = {}) {
  needAccount();
  const token = pageToken("liked", offset);
  if (offset > 0 && !token) return { tracks: [], more: false };
  const answer = token ? await call("browse", { continuation: token }) : await browseId("VLLL");
  const { items, token: next } = rowsOf(answer);
  const tracks = await withDurations(ofKind(items, "track"));
  return { tracks, more: keepToken("liked", offset + tracks.length, next) };
}

// YouTube can't say of many videos at once which are liked, so the first pages
// of Liked Videos answer for a few minutes at a time.
let likedSet = null;
let likedAt = 0;

async function likedIds() {
  if (likedSet && Date.now() - likedAt < 5 * 60 * 1000) return likedSet;
  const set = new Set();
  let { items, token } = rowsOf(await browseId("VLLL"));
  for (let i = 0; ; i++) {
    for (const x of ofKind(items, "track")) set.add(x.id);
    if (!token || i >= 5) break;
    ({ items, token } = rowsOf(await call("browse", { continuation: token })));
  }
  likedSet = set;
  likedAt = Date.now();
  return set;
}

export async function isLiked({ ids }) {
  const set = signedIn() ? await likedIds() : new Set();
  return Object.fromEntries(ids.map((id) => [id, set.has(id)]));
}

export async function like({ id, on }) {
  needAccount();
  await call(on ? "like/like" : "like/removelike", { target: { videoId: id } });
  if (likedSet) {
    if (on) likedSet.add(id);
    else likedSet.delete(id);
  }
}

export async function recent() {
  if (!signedIn()) return [];
  try {
    const answer = await browseId("FEhistory");
    return (await withDurations(ofKind(itemsOf(answer), "track"))).slice(0, 50);
  } catch (e) {
    console.warn(`history: ${e.message}`);
    return [];
  }
}

// A channel is an "artist" here. Its page is the videos of its Home tab.
export async function artist({ id }) {
  if (!id) throw fail("unavailable", t("no such page"));
  const answer = await browseId(id);
  const tracks = sectionsOf(answer).flatMap((s) => s.tracks).slice(0, 40);
  const header = findOne(answer, "c4TabbedHeaderRenderer") || findOne(answer, "pageHeaderRenderer") || {};
  return {
    artist: {
      id,
      name: textOf(header.title) || tracks[0]?.artists?.[0]?.name || "",
      imageUrl: imageOf(header) || tracks[0]?.album?.imageUrl,
    },
    tracks: await withDurations(tracks),
    albums: [],
  };
}

// ---------------------------------------------------------------------- audio

// Where a track's audio is. Its address lasts for hours.
const located = new Map();

function gainOf(audio) {
  const lkfs = audio?.trackAbsoluteLoudnessLkfs ?? audio?.perceptualLoudnessDb;
  if (typeof lkfs !== "number" || !lkfs) return undefined;
  return Math.round((-18 - lkfs) * 100) / 100;
}

// ------------------------------------------------------------------ programs

// GUI apps don't get a shell's PATH, so the places Homebrew and other
// installers put programs are tried too. plugin.json names each one for the
// process permission; starting one is the only way to tell it's there.
const installed = new Map();

async function program(name, versionFlag) {
  if (installed.has(name)) return installed.get(name);
  for (const path of [name, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`]) {
    try {
      const proc = host.spawn(path, [versionFlag]);
      proc.closeStdin();
      while ((await proc.readLine()) !== null) { /* drain stdout */ }
      if ((await proc.wait()) === 0) {
        installed.set(name, path);
        return path;
      }
    } catch (e) {
      if (/allowed|permission|not permitted/i.test(String(e.message))) {
        throw fail("setup", t("Allow YouTube to start programs in its settings"));
      }
    }
  }
  installed.set(name, null);
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Any audio codec will do: ffmpeg makes MP3 of it. Only an address with no
// plain url needs YouTube's JavaScript, which is yt-dlp's job.
function audioOf(answer, which) {
  const status = answer.playabilityStatus || {};
  if (status.status !== "OK") {
    const why = textOf(status.reason) || String(status.reason || status.status || "");
    if (/LOGIN_REQUIRED|AGE_VERIFICATION|sign in|not a bot/i.test(`${status.status} ${why}`)) {
      throw fail("signIn", t("YouTube asks you to sign in to play this"));
    }
    throw fail("unavailable", `${t("This video is unavailable")}: ${why}`);
  }
  let best = null;
  for (const f of answer.streamingData?.adaptiveFormats || []) {
    if (!String(f.mimeType || "").startsWith("audio/") || typeof f.url !== "string" || f.isDrc) continue;
    if (f.audioTrack && f.audioTrack.audioIsDefault === false) continue;
    if (!best || (f.bitrate || 0) > (best.bitrate || 0)) best = f;
  }
  if (!best) throw new Error(t("YouTube listed no playable audio"));
  return {
    url: best.url,
    http_headers: { "User-Agent": which === "vision" ? visionUA : webUA, Referer: `${site}/` },
    gain: gainOf(answer.playerConfig?.audioConfig),
    tracking: answer.playbackTracking,
    direct: true,
  };
}

// The cookie goes to yt-dlp on its standard input: a command line is readable
// by anyone else on this machine.
function ytdlpConfig() {
  const c = cookie();
  if (!c) return "";
  // A Cookie header from a browser has no quotes or backslashes in it.
  const safe = c.split('"').join("").split(String.fromCharCode(92)).join("");
  return `--add-headers "Cookie:${safe}"\n`;
}

const ytdlpTimeout = 25000;

// Signed out, yt-dlp's own choice of client works. With a session it asks as
// Safari's player, whose HLS addresses YouTube still gives without a token
// from its JavaScript.
function whatYtdlpAsks() {
  if (!signedIn()) {
    return ["--extractor-args", "youtube:skip=hls,dash", "--format", "bestaudio[protocol^=http]/bestaudio"];
  }
  return [
    "--extractor-args", "youtube:player_client=web_safari",
    "--format", "bestaudio[protocol^=m3u8]/93/94/92/95/91",
  ];
}

function ytdlpFailure(output) {
  const lines = output.split(String.fromCharCode(10));
  const said = lines.reverse().find((l) => l.startsWith("ERROR:")) || output.trim() || "yt-dlp stopped";
  const why = said.slice(said.indexOf(":") + 1).trim() || said;
  if (/not a bot|sign in|cookies/i.test(why)) {
    return fail("signIn", t("YouTube turned down your session: sign in again"));
  }
  if (/unavailable|private|removed|not available|premium/i.test(why)) return fail("unavailable", why);
  return new Error(why);
}

async function throughYtdlp(id, why) {
  const ytdlp = await program("yt-dlp", "--version");
  if (!ytdlp) throw why || fail("unavailable", t("This video is unavailable"));
  const args = [
    "--config-locations", "-",
    "--no-warnings", "--no-playlist", "--no-progress",
    ...whatYtdlpAsks(),
    "--print", "%(.{url,http_headers})j",
  ];
  // YouTube's JavaScript challenges need a runtime. yt-dlp's own binaries
  // carry the solver scripts, but need one of these to run them.
  for (const runtime of ["deno", "node", "bun"]) {
    const path = await program(runtime, "--version");
    if (path) {
      args.push("--js-runtimes", `${runtime}:${path}`);
      break;
    }
  }
  args.push(watchURL(id));
  const proc = host.spawn(ytdlp, args);
  proc.write(ytdlpConfig());
  proc.closeStdin();
  const timer = setTimeout(() => proc.kill(), ytdlpTimeout);
  const lines = [];
  for (let line; (line = await proc.readLine()) !== null; ) lines.push(line);
  const code = await proc.wait();
  clearTimeout(timer);
  if (code !== 0 || !lines.length) throw ytdlpFailure(proc.errorOutput());
  let found;
  try {
    found = JSON.parse(lines[lines.length - 1]);
  } catch {
    throw new Error(t("yt-dlp answered with an error"));
  }
  if (!found?.url) throw new Error(t("yt-dlp found no audio"));
  return { url: found.url, http_headers: found.http_headers || {}, direct: false };
}

function forgetPlayer(id) {
  for (const key of players.keys()) if (key.endsWith(id)) players.delete(key);
}

async function locate(id) {
  const known = located.get(id);
  if (known && Date.now() - known.at < 50 * 60 * 1000) return known;
  const mode = host.setting("audioClient") || "";
  const tries = mode === "visionos" ? ["vision"] : mode === "web" ? ["web"] : ["vision", "web"];
  let last = null;
  for (const which of tries) {
    try {
      const value = { ...audioOf(await playerOf(id, which), which), at: Date.now() };
      located.set(id, value);
      return value;
    } catch (e) {
      // A client refused here may be given the audio as another one.
      last = e;
      console.warn(`audio of ${id} as ${which}: ${e.message}`);
    }
  }
  // A video YouTube won't play at all can't be found by yt-dlp either.
  if (last?.code === "unavailable") throw last;
  const value = { ...(await throughYtdlp(id, last)), at: Date.now() };
  located.set(id, value);
  return value;
}

// YouTube's own player asks for its audio a piece at a time. An older ffmpeg
// can't request it that way, so its help is checked once.
let ranged = null;
async function asksInPieces(ffmpeg) {
  if (ranged !== null) return ranged;
  const proc = host.spawn(ffmpeg, ["-hide_banner", "-h", "protocol=http"]);
  proc.closeStdin();
  let found = false;
  for (let line; (line = await proc.readLine()) !== null; ) found ||= line.includes("-request_size");
  await proc.wait();
  return (ranged = found);
}

// ffmpeg serves the MP3 to the one request the app makes, so a track starts
// before all of it exists. Only a few may wait at once.
const serving = [];
const servingAtMost = 3;
const servedWithin = 10 * 60 * 1000;

function stopWaiting() {
  while (serving.length >= servingAtMost) serving.shift().kill();
}

async function serve(source, kbps) {
  const ffmpeg = await program("ffmpeg", "-version");
  if (!ffmpeg) throw fail("setup", t("YouTube plays through ffmpeg: install it, then restart the app"));
  const pieces = await asksInPieces(ffmpeg);
  stopWaiting();
  const headers = source.http_headers || {};
  const port = 20000 + Math.floor(Math.random() * 40000);
  const proc = host.spawn(ffmpeg, [
    "-nostdin", "-hide_banner", "-nostats",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
    "-rw_timeout", "15000000",
    ...(pieces ? ["-request_size", String(10 << 20)] : []),
    ...(headers["User-Agent"] ? ["-user_agent", headers["User-Agent"]] : []),
    "-i", source.url,
    "-vn", "-c:a", "libmp3lame", "-b:a", `${kbps}k`, "-id3v2_version", "0", "-write_xing", "0",
    "-f", "mp3", "-listen", "1", `http://127.0.0.1:${port}/`,
  ]);
  proc.closeStdin();
  let stopped = false;
  serving.push(proc);
  const timer = setTimeout(() => proc.kill(), servedWithin);
  proc.wait().then(() => {
    stopped = true;
    clearTimeout(timer);
    const at = serving.indexOf(proc);
    if (at >= 0) serving.splice(at, 1);
  });
  const until = Date.now() + 15000;
  while (!proc.errorOutput().includes("Input #0")) {
    if (stopped) throw new Error(`ffmpeg stopped: ${proc.errorOutput().trim().split("\n").pop()}`);
    if (Date.now() > until) {
      proc.kill();
      throw new Error(t("the audio didn't start in time"));
    }
    await sleep(30);
  }
  await sleep(100);
  return `http://127.0.0.1:${port}/`;
}

export async function stream({ id, quality }) {
  if (!id) throw fail("unavailable", t("This video is unavailable"));
  const kbps = quality === "standard" ? 128 : 192;
  let source = await locate(id);
  let url;
  try {
    url = await serve(source, kbps);
  } catch (e) {
    // An address YouTube gave out may be turned down later. yt-dlp may find
    // another, but a missing ffmpeg is a setup problem, not the track's.
    if (!source.direct || e.code === "setup") throw e;
    located.delete(id);
    forgetPlayer(id);
    console.warn(`playing ${id} as YouTube gave it: ${e.message}`);
    source = { ...(await throughYtdlp(id, e)), at: Date.now() };
    url = await serve(source, kbps);
    located.set(id, source);
  }
  return {
    url,
    type: "mp3",
    quality: kbps === 128 ? "standard" : "high",
    bitRate: kbps * 1000,
    gain: source.gain,
  };
}

// ---------------------------------------------------------- reporting a play

// YouTube counts a play at the address its own player is given in
// playbackTracking, not by the bytes fetched from googlevideo.com. Pulling the
// audio alone counts as nothing, and leaves your watch history untouched.
// The app calls played() once, when a track really starts, so this is one
// honest report for one real play: never a loop, never a batch, never for a
// track that wasn't played. It goes only to youtube.com, with your session.
export async function played({ id }) {
  if (!id || !signedIn()) return;
  if (host.setting("reportPlayback") === "off") return;
  try {
    await reportPlay(id);
  } catch (e) {
    // Reporting is a courtesy, not part of playing. Never let it stop, or even
    // delay, the music: the app waits for this call to settle.
    console.warn(`reporting ${id} as played: ${e.message}`);
  }
}

async function reportPlay(id) {
  const tracking = await trackingFor(id);
  const base = tracking?.videostatsPlaybackUrl?.baseUrl;
  if (!base) throw new Error("YouTube gave no address to report a play to");
  const url = new URL(base);
  // The session goes with the report, so it must go to YouTube alone.
  if (url.protocol !== "https:" || !/(^|\.)youtube\.com$/.test(url.hostname)) {
    throw new Error(`not sending your session to ${url.hostname}`);
  }
  url.searchParams.set("ver", "2");
  url.searchParams.set("c", "WEB");
  url.searchParams.set("cpn", playbackNonce());
  const res = await fetch(url.href, {
    headers: { "user-agent": webUA, referer: `${site}/`, ...authHeaders(url.origin) },
  });
  if (!res.ok) throw new Error(`playback report: ${res.status}`);
}

// The player answer stream() already asked for carries the address, so an
// ordinary play costs no extra request. A play found by yt-dlp, or one whose
// answer has left the cache, asks the web player for it once more.
async function trackingFor(id) {
  const direct = located.get(id)?.tracking;
  if (direct) return direct;
  for (const which of ["vision", "web"]) {
    const known = players.get(`${which}\0${id}`);
    if (known?.answer?.playbackTracking) return known.answer.playbackTracking;
  }
  return (await playerOf(id, "web"))?.playbackTracking;
}

// The 16 characters a player sends to tell one playback from another.
function playbackNonce() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_";
  let out = "";
  for (let i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * 64)];
  return out;
}
