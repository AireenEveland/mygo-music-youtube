// Playback: ffmpeg serves MP3, yt-dlp is the fallback, and failures say why.
import test from "node:test";
import assert from "node:assert/strict";
import { load, defaultPrograms, COOKIE } from "./harness.mjs";
import { visitorId, player, opusOnly, signedOnly, audioURL, ytdlpLine } from "./fixtures.mjs";

const base = { visitor_id: () => visitorId, player: () => player() };
const withPlayer = (answer) => ({ ...base, player: () => answer });
const serveArgs = (spawns) => spawns.filter((s) => s.kind === "serve").at(-1).args;
const serveInput = (spawns) => {
  const args = serveArgs(spawns);
  return args[args.indexOf("-i") + 1];
};
const argAfter = (spawns, flag) => {
  const args = serveArgs(spawns);
  return args[args.indexOf(flag) + 1];
};

test("a track is handed to the app as MP3 by ffmpeg", async () => {
  const { api, spawns } = await load({ routes: base });
  const got = await api.stream({ id: "v1", quality: "standard" });
  assert.equal(got.type, "mp3");
  assert.equal(got.quality, "standard");
  assert.equal(got.bitRate, 128000);
  assert.equal(got.gain, -4);
  assert.match(got.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  assert.equal(got.headers, undefined);

  const args = spawns.find((s) => s.kind === "serve").args;
  assert.equal(serveInput(spawns), audioURL("256"));
  assert.equal(argAfter(spawns, "-b:a"), "128k");
  assert.ok(args.includes("-listen"));
  assert.ok(args.includes("libmp3lame"));
  assert.ok(args.includes("-user_agent"));
  assert.ok(args.includes("-request_size"));
  assert.ok(args.includes("-reconnect"));
  assert.equal(spawns.some((s) => s.name === "yt-dlp"), false);
});

test("high quality only changes the MP3 bit rate", async () => {
  const { api, spawns } = await load({ routes: base });
  const got = await api.stream({ id: "v1", quality: "high" });
  assert.equal(got.quality, "high");
  assert.equal(got.bitRate, 192000);
  assert.equal(argAfter(spawns, "-b:a"), "192k");
  assert.equal(serveInput(spawns), audioURL("256"));
});

test("Opus in WebM plays too, as ffmpeg decodes any codec", async () => {
  const { api, spawns } = await load({ routes: withPlayer(player({ formats: opusOnly })) });
  assert.equal((await api.stream({ id: "v1" })).type, "mp3");
  assert.equal(serveInput(spawns), audioURL("opus"));
});

test("a signed address is found again by yt-dlp, with the cookie on stdin", async () => {
  const programs = { ...defaultPrograms(), deno: { installed: true } };
  const { api, spawns } = await load({
    routes: withPlayer(player({ formats: signedOnly })),
    settings: { manualCookie: COOKIE },
    programs,
  });
  assert.equal((await api.stream({ id: "v1" })).type, "mp3");

  const run = spawns.find((s) => s.kind === "ytdlp");
  assert.ok(run);
  assert.ok(run.args.includes("--print"));
  assert.ok(run.args.includes("--config-locations"));
  assert.ok(run.args.includes("https://www.youtube.com/watch?v=v1"));
  assert.ok(run.args.includes("--js-runtimes"));
  assert.ok(run.args.includes("youtube:player_client=web_safari"));
  assert.match(run.stdin, /--add-headers "Cookie:SAPISID=abc123/);
  assert.equal(serveInput(spawns), "https://ytdlp.example/audio");
});

test("signed out, yt-dlp asks for its own best audio", async () => {
  const { api, spawns } = await load({ routes: withPlayer(player({ formats: signedOnly })) });
  await api.stream({ id: "v1" });
  const run = spawns.find((s) => s.kind === "ytdlp");
  assert.ok(run.args.includes("bestaudio[protocol^=http]/bestaudio"));
  assert.equal(run.stdin, "");
});

test("with no yt-dlp, the reason the direct address failed is reported", async () => {
  const { api, spawns } = await load({
    routes: withPlayer(player({ formats: signedOnly })),
    programs: { ffmpeg: { installed: true } },
  });
  await assert.rejects(api.stream({ id: "v1" }), /no playable audio/i);
  assert.equal(spawns.some((s) => s.kind === "ytdlp"), false);
});

test("without ffmpeg, a setup failure is reported and yt-dlp is not tried", async () => {
  const { api, spawns } = await load({ routes: base, programs: {} });
  await assert.rejects(api.stream({ id: "v1" }), (e) => e.code === "setup");
  assert.equal(spawns.some((s) => s.kind === "ytdlp"), false);
});

test("when the listener hasn't allowed programs, the plugin says to allow them", async () => {
  const { api } = await load({ routes: base, allowProcess: false });
  await assert.rejects(api.stream({ id: "v1" }), (e) => e.code === "setup" && /allow/i.test(e.message));
});

test("an address turned down by YouTube is found again through yt-dlp", async () => {
  const programs = { ...defaultPrograms(), ffmpeg: { installed: true, ranged: true, serveFails: 1 } };
  const { api, spawns } = await load({ routes: base, programs });
  assert.equal((await api.stream({ id: "v1" })).type, "mp3");
  assert.equal(spawns.filter((s) => s.kind === "serve").length, 2);
  assert.equal(spawns.filter((s) => s.kind === "ytdlp").length, 1);
  assert.equal(serveInput(spawns), "https://ytdlp.example/audio");
});

test("a video YouTube won't play never reaches yt-dlp", async () => {
  const { api, spawns } = await load({ routes: withPlayer(player({ status: "ERROR", reason: "Video unavailable" })) });
  await assert.rejects(api.stream({ id: "v1" }), (e) => e.code === "unavailable");
  assert.equal(spawns.some((s) => s.kind === "ytdlp"), false);
});

test("a browser check asks the listener to sign in", async () => {
  const { api } = await load({
    routes: withPlayer(player({ status: "LOGIN_REQUIRED", reason: "Sign in to confirm you're not a bot" })),
    programs: { ffmpeg: { installed: true } },
  });
  await assert.rejects(api.stream({ id: "v1" }), (e) => e.code === "signIn");
});

test("yt-dlp's own errors are turned into a sign-in or an unavailable failure", async () => {
  for (const [stderr, code] of [
    ["ERROR: [youtube] Sign in to confirm you're not a bot", "signIn"],
    ["ERROR: [youtube] Private video. Sign in", "signIn"],
    ["ERROR: [youtube] Video unavailable", "unavailable"],
  ]) {
    const programs = { ffmpeg: { installed: true }, "yt-dlp": { installed: true, lines: [], stderr } };
    const { api } = await load({ routes: withPlayer(player({ formats: signedOnly })), programs });
    await assert.rejects(api.stream({ id: "v1" }), (e) => e.code === code);
  }
});

test("yt-dlp's answer without an address is reported", async () => {
  const programs = { ffmpeg: { installed: true }, "yt-dlp": { installed: true, lines: [ytdlpLine("")] } };
  const { api } = await load({ routes: withPlayer(player({ formats: signedOnly })), programs });
  await assert.rejects(api.stream({ id: "v1" }), /no audio/i);
});

test("an address is looked up once, even when the track is played twice", async () => {
  const { api, calls, spawns } = await load({ routes: base });
  await api.stream({ id: "v1" });
  await api.stream({ id: "v1" });
  assert.equal(calls.filter((c) => c.endpoint === "player").length, 1);
  assert.equal(spawns.filter((s) => s.kind === "serve").length, 2);
});

test("the audio source setting picks which player is asked", async () => {
  const { api: web, calls: webCalls } = await load({ routes: base, settings: { audioClient: "web" } });
  await web.stream({ id: "v1" });
  assert.equal(webCalls.filter((c) => c.endpoint === "player").length, 1);
  assert.equal(webCalls.find((c) => c.endpoint === "player").headers["x-youtube-client-name"], "1");

  const { api: vision, calls: visionCalls } = await load({ routes: base, settings: { audioClient: "visionos" } });
  await vision.stream({ id: "v1" });
  assert.equal(visionCalls.find((c) => c.endpoint === "player").headers["x-youtube-client-name"], "101");
});

test("signing out forgets the address, so it is looked up again", async () => {
  const { api, calls } = await load({ routes: base, settings: { manualCookie: COOKIE } });
  await api.stream({ id: "v1" });
  api.signOut();
  await api.stream({ id: "v1" });
  assert.equal(calls.filter((c) => c.endpoint === "player").length, 2);
});
