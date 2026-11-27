// Loads index.js the way MyGo Music does, with a stand-in for its host global.
// Programs are stand-ins too: a test says which ones are installed and what
// they answer, and every spawn is recorded so its arguments can be checked.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { SourceTextModule, createContext } from "node:vm";

const dir = fileURLToPath(new URL("..", import.meta.url));

const response = (status, body) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
});

export function routesFetch(routes) {
  const calls = [];
  const impl = async (url, options = {}) => {
    const address = String(url);
    let body = {};
    try { body = JSON.parse(options.body || "{}"); } catch { /* GET */ }
    const endpoint = address.match(/\/youtubei\/v1\/([^?]+)/)?.[1]
      || (address.includes("/api/stats/") ? "stats" : "suggest");
    calls.push({ url: address, endpoint, body, headers: options.headers || {} });
    const handler = routes[endpoint];
    const result = handler ? handler(body, calls.length) : {};
    if (result instanceof Error) throw result;
    if (result?.__http) return response(result.__http, result.body);
    return response(200, result);
  };
  return { fetch: impl, calls };
}

// A stand-in program. What it answers depends on why the plugin started it:
// a version probe, ffmpeg's help, an ffmpeg server, or yt-dlp's own run.
function pretendSpawn(command, args, config, spawns, allowProcess) {
  if (!allowProcess) throw new Error("not allowed: start a program");
  const name = String(command).split("/").pop();
  if (!Object.hasOwn(config, name) || config[name].installed === false) {
    throw new Error(`spawn ${command} ENOENT`);
  }
  const cfg = config[name];
  const kind = args.includes("-listen") ? "serve"
    : args.includes("-h") ? "help"
    : args.includes("--print") ? "ytdlp"
    : "version";
  const record = { command, args, kind, name, stdin: "", closed: false, killed: false };
  spawns.push(record);

  // serveFails may be a number: fail that many ffmpeg servers, then succeed.
  const serveIndex = spawns.filter((s) => s.kind === "serve").length - 1;
  const serveFails = kind === "serve" && (
    cfg.serveFails === true ||
    (typeof cfg.serveFails === "number" && serveIndex < cfg.serveFails)
  );
  const stdout = kind === "version" ? [`${name} version 1.0`]
    : kind === "help" ? (cfg.ranged ? ["  -request_size <size>  limit request size"] : ["  -rw_timeout <us>  set timeout"])
    : kind === "ytdlp" ? (cfg.lines || [])
    : [];
  const stderr = kind === "serve"
    ? (serveFails ? (cfg.stderr || "Invalid data found") : (cfg.stderr || "Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'https://x':"))
    : (cfg.stderr || "");
  const code = cfg.code ?? 0;
  let line = 0;
  return {
    pid: 1000 + spawns.length,
    write: (text) => { record.stdin += text; },
    closeStdin: () => { record.closed = true; },
    readLine: async () => (line < stdout.length ? stdout[line++] : null),
    wait: () => Promise.resolve(code),
    kill: () => { record.killed = true; },
    errorOutput: () => stderr,
  };
}

// ffmpeg and yt-dlp installed, no JS runtime, both answering successfully.
export const defaultPrograms = () => ({
  ffmpeg: { installed: true, ranged: true },
  "yt-dlp": { installed: true, lines: ['{"url":"https://ytdlp.example/audio","http_headers":{"User-Agent":"yt-dlp"}}'] },
});

export async function load({
  storage = new Map(),
  settings = {},
  routes = {},
  webSignIn,
  platform = "linux",
  language = "en",
  programs = defaultPrograms(),
  allowProcess = true,
} = {}) {
  const locale = JSON.parse(await readFile(join(dir, "locales/zh-CN.json"), "utf8"));
  const warnings = [];
  const spawns = [];
  const host = {
    platform,
    arch: "arm64",
    dir,
    dataDir: "/tmp/mygo-youtube-test",
    storage: {
      get: (k) => (storage.has(k) ? structuredClone(storage.get(k)) : null),
      set: (k, v) => void storage.set(k, structuredClone(v)),
      remove: (k) => void storage.delete(k),
    },
    setting: (key) => settings[key] ?? "",
    t: (text) => (language === "zh-CN" ? locale[text] ?? text : text),
    language: () => language,
    openURL: () => {},
    signInPrompt: () => {},
    waitForRedirect: () => { throw new Error("waitForRedirect should not be used"); },
    spawn: (command, args) => pretendSpawn(command, args, programs, spawns, allowProcess),
    ...(webSignIn ? { webSignIn: async (options) => webSignIn(plain(options)) } : {}),
  };
  // Values made inside the VM have a different Array/Object prototype, which
  // deepStrictEqual rejects. Hand the tests plain values from this realm.
  const plain = (value) => (value && typeof value === "object" ? JSON.parse(JSON.stringify(value)) : value);
  const { fetch: fetchImpl, calls } = routesFetch(routes);
  const source = await readFile(join(dir, "index.js"), "utf8");
  const mod = new SourceTextModule(source, {
    identifier: "index.js",
    context: createContext({
      URL,
      URLSearchParams,
      TextEncoder,
      TextDecoder,
      AbortController,
      fetch: fetchImpl,
      setTimeout,
      clearTimeout,
      console: { log: () => {}, warn: (m) => warnings.push(String(m)), error: () => {} },
      host,
      structuredClone,
    }),
  });
  await mod.link(() => { throw new Error("plugins import nothing"); });
  await mod.evaluate();
  const api = Object.fromEntries(
    Object.entries(mod.namespace).map(([name, fn]) => [
      name,
      typeof fn !== "function" ? fn : (...args) => {
        const out = fn(...args);
        return out && typeof out.then === "function" ? out.then(plain) : plain(out);
      },
    ]),
  );
  return { api, storage, host, calls, spawns, warnings };
}

export const COOKIE =
  "SAPISID=abc123; __Secure-3PAPISID=abc123; __Secure-3PSID=xyz; SID=sss; HSID=hhh; SSID=ss";
