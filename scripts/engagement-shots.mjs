#!/usr/bin/env node
// Checks and screenshots of likes, views, resume and watch history, without
// a real database or R2.
//
//   node scripts/engagement-shots.mjs [out-dir]   (default: shots/engagement)
//
// 1. Makes a 14 second test clip with ffmpeg and encodes it with the
//    encoder's own arguments, like scripts/watch-shots.mjs.
// 2. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    viewer and a made up channel owner, keeps reactions, view days, history
//    and the pause setting in memory, and counts views with the same rule as
//    watch_ping in 011_engagement.sql (applyPing from lib/engagement/rules.ts).
//    Every watch_ping call is recorded, so the checks can see them.
// 3. Starts `next dev` pointed at it.
// 4. With Playwright: the flag off (history placeholder, the ping route says
//    403, placeholder thumbs); signed out (like goes to sign in, pings carry
//    the hashed cookie key); the like toggle with the count moving before the
//    server answers; the owner's dislike count and like bar; a 12 second
//    playback that marks a view; resume from history with the Resumed note;
//    the red bars on the home grid; the history page (day headers, infinite
//    scroll, remove, pause, clear). Then screenshots at 1280 and 390, light
//    and dark.
//
// Needs ffmpeg and Playwright with Chromium. Made up names and titles, no
// real data. Nothing here touches the network.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildEncodeArgs, buildThumbnailArgs, thumbnailName, SPRITE_IMAGE, SPRITE_VTT } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";
import { buildVtt, spritePlan } from "../worker/lib/sprite.mjs";
import { historyLabel } from "../lib/engagement/history.ts";
import { applyPing, viewDay } from "../lib/engagement/rules.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/engagement"));
const APP_PORT = Number(process.env.APP_PORT ?? 3461);
const CLIP_S = 14;

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.toString().slice(-500)}`);
}

// 1. Made up people, a channel and videos ----------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VIEWER = { id: "a0000000-0000-4000-8000-000000000001", email: "viewer@example.com", username: "viewer" };
const OWNER = { id: "a0000000-0000-4000-8000-000000000002", email: "owner@example.com", username: "owner" };
const CHANNEL = { id: "c0000000-0000-4000-8000-000000000001", handle: "samplekitchen", name: "Sample Kitchen", owner: OWNER.id, subs: 1234 };

const TITLES = [
  "Fluffy pancakes in ten minutes",
  "Cable management that actually lasts",
  "Sunrise hike to the old fire lookout",
  "Growing a pixel art garden",
  "Bread with four ingredients",
  "A robot the size of a coin",
  "Night sky timelapse from the ridge",
  "Folding a paper crane, slowly",
  "Patching a modular synth from scratch",
  "Building a moss terrarium",
];
const uuid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const CLIP_ID = uuid(1);
const VIDEOS = Array.from({ length: 30 }, (_, i) => ({
  id: uuid(i + 1),
  title: i === 0 ? "Test pattern with a tone, fourteen seconds" : `${TITLES[i % TITLES.length]}${i >= 10 ? ` (part ${Math.floor(i / 10) + 1})` : ""}`,
  description: "A made up video for the likes and history checks. It has a second sentence so the row shows two lines.",
  duration_s: i === 0 ? CLIP_S : 240 + i * 37,
  thumbnail_url: null,
  hls_key: `hls/${uuid(i + 1)}/master.m3u8`,
  preview_sprite_key: null,
  published_at: new Date(NOW - (i + 1) * 9 * HOUR).toISOString().replace("Z", "123+00:00"),
  views: 1000 * (i + 1) + 7,
  channel_id: CHANNEL.id,
  channel_handle: CHANNEL.handle,
  channel_name: CHANNEL.name,
  channel_avatar_url: null,
  design: i,
  likes: i === 0 ? 41 : 10 + i,
  dislikes: i === 0 ? 0 : i % 4,
}));
const card = ({ design, likes, dislikes, description, ...v }) => (void design, void likes, void dislikes, void description, v);

// 2. The fixture clip ----------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-engagement-"));
const hlsDir = join(work, "hls", CLIP_ID);
mkdirSync(hlsDir, { recursive: true });
const source = join(work, "source.mp4");
console.log(`fixture: making a ${CLIP_S} second clip in`, work);
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${CLIP_S}`,
  "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${CLIP_S}`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
]);
const renditions = pickRenditions({ width: 640, height: 360, fps: 30 });
const sprite = spritePlan(CLIP_S, { everySeconds: 2 });
run("ffmpeg", buildEncodeArgs({ input: source, renditions, hasAudio: true, sprite, segmentSeconds: 2 }), { cwd: hlsDir });
run("ffmpeg", buildThumbnailArgs({ input: source, atSeconds: 2, output: join(hlsDir, thumbnailName(0)) }));
writeFileSync(join(hlsDir, SPRITE_VTT), buildVtt(sprite, CLIP_S, SPRITE_IMAGE));
const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".vtt": "text/vtt; charset=utf-8",
};

// 3. Sessions ------------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString("base64url");
const exp = Math.floor(NOW / 1000) + 24 * 3600;
function sessionFor(user) {
  const token = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
    b64url("not-a-real-signature"),
  ].join(".");
  const authUser = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
  return { token, authUser, session: { access_token: token, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: authUser } };
}
const SESSIONS = { [VIEWER.id]: sessionFor(VIEWER), [OWNER.id]: sessionFor(OWNER) };
const USERS = [VIEWER, OWNER];

// 4. In memory state ---------------------------------------------------------------------------

const state = {
  flag: "everyone",
  delay: 0,
  reactions: new Map(), // `${user}|${video}` -> kind
  history: new Map(), // user -> Map(video -> { position_s, duration_s, last_at })
  paused: new Set(),
  days: new Map(), // `${video}|${key}|${day}` -> ViewDay
  pings: [],
  views: new Map(VIDEOS.map((v) => [v.id, v.views])),
};

function reset() {
  state.flag = "everyone";
  state.delay = 0;
  state.reactions.clear();
  state.history.clear();
  state.paused.clear();
  state.days.clear();
  state.pings.length = 0;
  for (const v of VIDEOS) state.views.set(v.id, v.views);
}

const historyOf = (user) => state.history.get(user) ?? state.history.set(user, new Map()).get(user);
function counts(video) {
  const v = VIDEOS.find((x) => x.id === video);
  let likes = v.likes;
  let dislikes = v.dislikes;
  for (const [k, kind] of state.reactions) {
    if (!k.endsWith(`|${video}`)) continue;
    if (kind === "like") likes++;
    else dislikes++;
  }
  return { likes, dislikes };
}

/** The viewer's history: most recent first, 26 videos over the last two weeks. */
function seedHistory() {
  const h = historyOf(VIEWER.id);
  const agoHours = [0.5, 2, 5, 25, 27, 30, 33, 52, 54, 60, 75, 77, 100, 110, 120, 150, 170, 175, 200, 220, 240, 260, 280, 300, 320, 340];
  agoHours.forEach((ago, i) => {
    const v = VIDEOS[i + 2];
    h.set(v.id, { position_s: Math.round(v.duration_s * [0.15, 0.4, 0.75, 1, 0.3][i % 5]), duration_s: v.duration_s, last_at: new Date(NOW - ago * HOUR).toISOString() });
  });
}

function myHistory(user, { cursor = null, cursor_id = null, lim = 20 }) {
  let rows = [...historyOf(user).entries()]
    .map(([id, e]) => ({ id, ...e }))
    .sort((a, b) => (a.last_at < b.last_at ? 1 : a.last_at > b.last_at ? -1 : a.id < b.id ? 1 : -1));
  if (cursor) {
    const t = Date.parse(cursor);
    rows = rows.filter((r) => Date.parse(r.last_at) < t || (Date.parse(r.last_at) === t && r.id < cursor_id));
  }
  return rows.slice(0, Math.min(Math.max(lim, 1), 50)).map((r) => {
    const v = VIDEOS.find((x) => x.id === r.id);
    return {
      ...card(v),
      description: v.description,
      views: state.views.get(v.id),
      position_s: r.position_s,
      progress: Math.min(1, r.position_s / (r.duration_s ?? v.duration_s)),
      watched_at: r.last_at,
    };
  });
}

function thumbSvg(v) {
  const h = (v.design * 47) % 360;
  const words = v.title.split(" ").slice(0, 3).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,30%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="${160 + (v.design % 10) * 30}" cy="170" r="90" fill="rgba(255,255,255,0.18)"/><text x="40" y="300" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#fff">${words}</text></svg>`;
}

const channelRow = () => ({
  id: CHANNEL.id,
  owner_id: CHANNEL.owner,
  handle: CHANNEL.handle,
  name: CHANNEL.name,
  description: "A made up channel for the engagement checks.",
  links: [],
  avatar_url: null,
  banner_url: null,
  handle_changed_at: null,
  subscriber_count: CHANNEL.subs,
  video_count: VIDEOS.length,
  created_at: new Date(NOW - 400 * DAY).toISOString(),
});

// 5. The stand in server ---------------------------------------------------------------------

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message) => send(400, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");

  // The fixture clip, like a public bucket domain.
  if (url.pathname.startsWith(`/hls/${CLIP_ID}/`)) {
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = join(work, path);
    if (!file.startsWith(work) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }
  const m = /^\/hls\/([0-9a-f-]{36})\/thumb-1\.webp$/.exec(url.pathname);
  const thumbOf = m && VIDEOS.find((x) => x.id === m[1]);
  if (thumbOf) return send(200, thumbSvg(thumbOf), "image/svg+xml");

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const auth = req.headers.authorization ?? "";
  const me = USERS.find((u) => auth === `Bearer ${SESSIONS[u.id].token}`) ?? null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");

  if (url.pathname === "/auth/v1/user") return me ? send(200, SESSIONS[me.id].authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["engagement", "watch", "channels", "feed", "accounts"].map((key) => ({
      key,
      label: key,
      description: "",
      mode: key === "engagement" ? state.flag : "everyone",
      users: [],
      updated_at: null,
    }));
    return send(200, flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    const u = USERS.find((x) => x.id === eq("id"));
    return one(u ? [{ username: u.username, display_name: u.username === "owner" ? "Sample Kitchen" : "Viewer", avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const hit = (eq("owner_id") && eq("owner_id") === CHANNEL.owner) || eq("handle") === CHANNEL.handle || eq("id") === CHANNEL.id;
    return one(hit ? [channelRow()] : []);
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  switch (rpc) {
    case "watch_video": {
      const v = VIDEOS.find((x) => x.id === args.video_id);
      if (!v) return send(200, []);
      return send(200, [
        {
          ...card(v),
          views: state.views.get(v.id),
          description: v.description,
          visibility: "public",
          status: "ready",
          is_owner: me?.id === CHANNEL.owner,
          created_at: v.published_at,
          width: 640,
          height: 360,
          renditions: [{ name: "360p", width: 640, height: 360 }],
          preview_sprite_key: v.id === CLIP_ID ? `hls/${CLIP_ID}/sprite.vtt` : null,
          channel_subscriber_count: CHANNEL.subs,
        },
      ]);
    }
    case "video_engagement": {
      const v = VIDEOS.find((x) => x.id === args.video_id);
      if (!v) return send(200, []);
      const c = counts(v.id);
      const h = me ? historyOf(me.id).get(v.id) : null;
      return send(200, [
        {
          like_count: c.likes,
          dislike_count: me?.id === CHANNEL.owner ? c.dislikes : null,
          my_reaction: me ? (state.reactions.get(`${me.id}|${v.id}`) ?? null) : null,
          position_s: h?.position_s ?? null,
          duration_s: h?.duration_s ?? v.duration_s,
        },
      ]);
    }
    case "react": {
      if (!me) return send(401, { code: "42501", message: "permission denied for function react" });
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      const key = `${me.id}|${args.video_id}`;
      if (args.kind === null) state.reactions.delete(key);
      else state.reactions.set(key, args.kind);
      const c = counts(args.video_id);
      return send(200, [{ reaction: state.reactions.get(key) ?? null, like_count: c.likes, dislike_count: me.id === CHANNEL.owner ? c.dislikes : null }]);
    }
    case "watch_ping": {
      if (state.flag === "off") return fail("engagement_off");
      const header = String(req.headers["x-viewer-key"] ?? "");
      const who = me ? `u:${me.id}` : /^[0-9a-f]{64}$/.test(header) ? `a:${header}` : null;
      if (!who) return fail("no_viewer_key");
      const v = VIDEOS.find((x) => x.id === args.video_id);
      if (!v) return fail("not_found");
      const now = Date.now();
      const dayKey = `${v.id}|${who}|${viewDay(now)}`;
      const r = applyPing(state.days.get(dayKey) ?? null, { playedS: args.played_s, now }, v.duration_s);
      state.days.set(dayKey, r.day);
      if (r.countedNow) state.views.set(v.id, state.views.get(v.id) + 1);
      state.pings.push({ video: v.id, who, position: args.position_s, played: args.played_s, counted: r.countedNow, at: now });
      if (me && !state.paused.has(me.id)) {
        historyOf(me.id).set(v.id, { position_s: Math.min(args.position_s, v.duration_s), duration_s: v.duration_s, last_at: new Date(now).toISOString() });
      }
      return send(200, [{ counted: r.countedNow, views: state.views.get(v.id), watched_s: r.day.watchedS }]);
    }
    case "my_history":
      return send(200, me ? myHistory(me.id, args) : []);
    case "history_paused":
      return send(200, me ? state.paused.has(me.id) : false);
    case "my_progress": {
      if (!me) return send(200, []);
      const h = historyOf(me.id);
      return send(200, (args.video_ids ?? []).filter((id) => h.has(id)).map((id) => ({ video_id: id, position_s: h.get(id).position_s, duration_s: h.get(id).duration_s })));
    }
    case "clear_history": {
      if (!me) return fail("not_signed_in");
      const n = historyOf(me.id).size;
      historyOf(me.id).clear();
      return send(200, n);
    }
    case "remove_from_history":
      if (!me) return fail("not_signed_in");
      return send(200, historyOf(me.id).delete(args.video_id));
    case "set_history_paused":
      if (!me) return fail("not_signed_in");
      if (args.on) state.paused.add(me.id);
      else state.paused.delete(me.id);
      return send(200, state.paused.has(me.id));
    case "feed_videos":
      return send(200, VIDEOS.slice(0, args.lim ?? 24).map((v) => ({ ...card(v), views: state.views.get(v.id), score: 0 })));
    case "related_videos":
      return send(200, VIDEOS.filter((v) => v.id !== args.video_id).slice(0, 8).map((v) => ({ ...card(v), views: state.views.get(v.id) })));
    case "my_subscriptions":
    case "subscriptions_feed":
      return send(200, []);
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 6. next dev --------------------------------------------------------------------------------

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: mockUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder-for-the-mock",
  MEDIA_PUBLIC_URL: mockUrl,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  PORT: String(APP_PORT),
};
const dev = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
const app = `http://localhost:${APP_PORT}`;

function cleanup() {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    dev.kill("SIGTERM");
  }
  mock.closeAllConnections();
  mock.close();
  rmSync(work, { recursive: true, force: true });
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${app}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next dev did not start:\n" + devLog.slice(-2000));
}

// 7. Playwright ---------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const cookieFor = (user) => ({ name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSIONS[user.id].session)), domain: "localhost", path: "/" });

async function open(browser, path, { width = 1280, height = 900, theme = "light", scale = 1, user = VIEWER } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (user) await context.addCookies([cookieFor(user)]);
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
      // Muted, so the player may start on its own; no position from earlier runs.
      localStorage.setItem("sloptube.player.volume", JSON.stringify({ volume: 1, muted: true }));
      localStorage.removeItem("sloptube.player.resume");
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

const watchUrl = (id = CLIP_ID) => `/watch?v=${id}`;
const likeCount = (page) => page.locator('[data-reaction-count="like"]').innerText();
const until = async (fn, ms = 5000) => {
  for (let t = 0; t < ms && !fn(); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
const imagesLoaded = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("main img")]
      .filter((img) => img.getBoundingClientRect().top < innerHeight)
      .every((img) => img.complete && img.naturalWidth > 0),
  );
const currentTime = (page) => page.evaluate(() => document.querySelector("video")?.currentTime ?? -1);

try {
  await waitForApp();
  for (const p of ["/", "/feed/history", watchUrl()]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  // The flag off -------------------------------------------------------------------------------
  {
    reset();
    state.flag = "off";
    const { context, page } = await open(browser, "/feed/history");
    await page.waitForSelector('[data-history-state="off"]', { timeout: 30000 });
    check(true, "flag off: /feed/history shows the placeholder");
    const res = await page.evaluate(async (id) => {
      const r = await fetch("/api/watch/ping", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: id, position: 12, played: 10 }) });
      return { status: r.status, body: await r.json() };
    }, CLIP_ID);
    check(res.status === 403 && res.body.error === "engagement_off", `flag off: the ping route answers ${res.status} ${res.body.error}`);
    await page.goto(app + watchUrl());
    await page.waitForSelector('[data-reaction="like"]', { timeout: 30000 });
    check(await page.locator('[data-reaction="like"]').isDisabled(), "flag off: the thumbs are disabled placeholders");
    await page.waitForTimeout(2500);
    check(state.pings.length === 0, "flag off: the player sends no pings");
    await context.close();
  }

  // Signed out ----------------------------------------------------------------------------------
  {
    reset();
    const { context, page } = await open(browser, watchUrl(), { user: null });
    await page.waitForSelector('[data-reactions="none"]', { timeout: 30000 });
    check((await likeCount(page)) === "41", `signed out: the like count shows (${await likeCount(page)})`);
    check((await page.locator('[data-reaction-count="dislike"]').innerText()) === "", "signed out: no dislike count");
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > 1.5, null, { timeout: 30000 });
    await until(() => state.pings.length > 0);
    const ping = state.pings[0];
    check(ping?.who.startsWith("a:") && /^a:[0-9a-f]{64}$/.test(ping.who), "signed out: pings carry the hashed cookie key");
    const sv = (await context.cookies()).find((c) => c.name === "sv");
    check(Boolean(sv) && sv.httpOnly && !ping.who.includes(sv.value), "signed out: the sv cookie is set, httpOnly, never sent as is");
    await page.locator('[data-reaction="like"]').click();
    await page.waitForURL(/\/login\?next=/, { timeout: 15000 });
    check(new URL(page.url()).searchParams.get("next") === watchUrl(), "signed out: like goes to /login?next=");
    await context.close();
  }

  // The like toggle -------------------------------------------------------------------------------
  {
    reset();
    const { context, page } = await open(browser, watchUrl());
    await page.waitForSelector('[data-reactions="none"]', { timeout: 30000 });
    await page.evaluate(() => document.querySelector("video")?.pause());
    check((await likeCount(page)) === "41", "like count starts at 41");
    state.delay = 1200;
    await page.locator('[data-reaction="like"]').click();
    await page.waitForSelector('[data-reaction="like"][data-on]', { timeout: 300 });
    check((await likeCount(page)) === "42", "like: 42 at once");
    check(!state.reactions.size, "like: the server has not answered yet");
    await until(() => state.reactions.get(`${VIEWER.id}|${CLIP_ID}`) === "like");
    check(state.reactions.get(`${VIEWER.id}|${CLIP_ID}`) === "like", "like: the server has it");
    await page.screenshot({ path: join(outDir, "watch-liked-1280-light.png"), clip: { x: 0, y: 56, width: 1280, height: 844 } });
    await page.locator('[data-reaction="like"]').click();
    check((await likeCount(page)) === "41", "unlike: back to 41 at once");
    await until(() => !state.reactions.size);
    check(!state.reactions.size, "unlike: the server cleared it");
    await page.locator('[data-reaction="dislike"]').click();
    await page.waitForSelector('[data-reaction="dislike"][data-on]', { timeout: 300 });
    check((await page.locator('[data-reaction-count="dislike"]').innerText()) === "", "dislike: no count for a viewer");
    check((await page.locator("[data-like-bar]").count()) === 0, "dislike: no like bar for a viewer");
    await until(() => state.reactions.get(`${VIEWER.id}|${CLIP_ID}`) === "dislike");
    check(state.reactions.get(`${VIEWER.id}|${CLIP_ID}`) === "dislike", "dislike: the server has it");
    state.delay = 0;
    await context.close();
  }

  // The owner sees dislikes and the like bar -----------------------------------------------------------
  {
    const { context, page } = await open(browser, watchUrl(), { user: OWNER });
    await page.waitForSelector("[data-like-bar]", { timeout: 30000 });
    const dis = await page.locator('[data-reaction-count="dislike"]').innerText();
    check(dis === "1", `owner: the dislike count shows (${dis})`);
    const bar = await page.locator("[data-like-bar]").getAttribute("data-like-bar");
    check(bar === (41 / 42).toFixed(2), `owner: the like bar is at ${bar}`);
    await context.close();
  }

  // A 12 second playback marks a view ---------------------------------------------------------------
  {
    reset();
    const before = state.views.get(CLIP_ID);
    const { context, page } = await open(browser, watchUrl());
    await page.waitForSelector("[data-player]", { timeout: 30000 });
    if ((await page.locator("[data-player]").getAttribute("data-player-state")) !== "playing") await page.click("[data-big-play]").catch(() => {});
    await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 12.2, null, { timeout: 40000 });
    await page.evaluate(() => document.querySelector("video").pause());
    await until(() => state.pings.some((p) => p.counted), 5000);
    const mine = state.pings.filter((p) => p.video === CLIP_ID && p.who === `u:${VIEWER.id}`);
    console.log("     pings:", mine.map((p) => `${p.played}s@${p.position}${p.counted ? " counted" : ""}`).join(", "));
    check(mine[0]?.played === 0, "view: a start ping opens the day");
    check(mine.some((p) => p.played >= 9 && p.counted), "view: the 10 second ping counts the view (watch_ping call seen)");
    check(state.views.get(CLIP_ID) === before + 1, `view: views went from ${before} to ${state.views.get(CLIP_ID)}`);
    await until(() => state.pings.filter((p) => p.who === `u:${VIEWER.id}`).length > mine.length, 3000);
    console.log("     after pause:", state.pings.map((p) => `${p.played}s@${p.position}`).join(", "));
    const pos = historyOf(VIEWER.id).get(CLIP_ID)?.position_s ?? 0;
    check(pos >= 11, `history: the position is saved (${pos})`);
    // Again the same day: no second view.
    await page.reload();
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, null, { timeout: 30000 });
    await page.evaluate(async () => {
      const v = document.querySelector("video");
      v.currentTime = 0;
      await v.play().catch(() => {});
    });
    await page.waitForFunction(() => document.querySelector("video")?.currentTime >= 11.5, null, { timeout: 40000 });
    await page.waitForTimeout(500);
    check(state.views.get(CLIP_ID) === before + 1, "view: watching again the same day adds no view");
    await context.close();

    // The red bar on the home grid.
    const home = await open(browser, "/");
    await home.page.waitForSelector(`[data-feed-card="${CLIP_ID}"] [data-thumb-progress]`, { timeout: 30000 });
    const frac = Number(await home.page.locator(`[data-feed-card="${CLIP_ID}"] [data-thumb-progress]`).getAttribute("data-thumb-progress"));
    const saved = historyOf(VIEWER.id).get(CLIP_ID).position_s / CLIP_S;
    check(frac > 0.5 && Math.abs(frac - saved) < 0.01, `home: the red bar on the watched video matches the saved position (${frac})`);
    check((await home.page.locator("[data-thumb-progress]").count()) === 1, "home: no bars on videos never watched");
    await home.context.close();
  }

  // Resume ------------------------------------------------------------------------------------------
  for (const [pos, want] of [
    [11, 11],
    [5, 0],
    [13, 0],
  ]) {
    reset();
    historyOf(VIEWER.id).set(CLIP_ID, { position_s: pos, duration_s: CLIP_S, last_at: new Date().toISOString() });
    const { context, page } = await open(browser, watchUrl());
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1, null, { timeout: 30000 });
    await page.waitForTimeout(400);
    const t = await currentTime(page);
    const toast = await page.locator("[data-resumed]").count();
    if (want) {
      check(t >= want - 0.1 && t < want + 2, `resume: saved at ${pos} s, the player seeks to ${t.toFixed(1)}`);
      check(toast === 1, 'resume: the "Resumed" note shows');
      if (pos === 11) await page.screenshot({ path: join(outDir, "watch-resumed-1280-light.png"), clip: { x: 0, y: 56, width: 1280, height: 844 } });
    } else {
      check(t < 2, `resume: saved at ${pos} s of ${CLIP_S}, starts from the top (${t.toFixed(1)})`);
      check(toast === 0, "resume: no note");
    }
    await context.close();
  }

  // The history page ------------------------------------------------------------------------------------
  {
    reset();
    seedHistory();
    const { context, page } = await open(browser, "/feed/history");
    await page.waitForSelector('[data-history-state="ready"]', { timeout: 30000 });
    check((await page.locator("[data-history-row]").count()) === 20, "history: the first page has 20 rows");
    const tz = await page.evaluate(() => new Date().getTimezoneOffset());
    const all = myHistory(VIEWER.id, { lim: 50 });
    await page.locator("[data-history-more]").scrollIntoViewIfNeeded();
    await page.waitForSelector(`[data-history-count="${all.length}"]`, { timeout: 15000 });
    check(true, `history: infinite scroll loads the rest (${all.length})`);
    const labels = await page.locator("[data-history-day-label]").allInnerTexts();
    const want = [...new Set(all.map((r) => historyLabel(r.watched_at, Date.now(), tz).label))];
    check(JSON.stringify(labels) === JSON.stringify(want), `history: day headers ${labels.slice(0, 4).join(", ")}, ...`);
    check(labels[0] === "Today" && labels[1] === "Yesterday", "history: Today, then Yesterday");
    check((await page.locator("[data-history-row] [data-thumb-progress]").count()) === all.length, "history: every row has its red bar");
    const order = await page.locator("[data-history-row]").evaluateAll((els) => els.map((e) => e.getAttribute("data-history-row")));
    check(JSON.stringify(order) === JSON.stringify(all.map((r) => r.id)), "history: most recent first");

    // Remove one.
    const gone = all[1].id;
    await page.locator(`[data-history-row="${gone}"]`).hover();
    await page.locator(`[data-history-remove="${gone}"]`).click();
    check((await page.locator(`[data-history-row="${gone}"]`).count()) === 0, "remove: the row goes at once");
    await until(() => !historyOf(VIEWER.id).has(gone));
    check(!historyOf(VIEWER.id).has(gone), "remove: the server dropped it");

    // Pause, then turn it back on.
    await page.locator('[data-history-pause="off"]').click();
    await page.waitForSelector('[data-history-confirm="pause"]');
    await page.locator("[data-history-confirm-ok]").click();
    await page.waitForSelector('[data-history-pause="on"]', { timeout: 5000 });
    check(state.paused.has(VIEWER.id), "pause: the server has it, the button says Turn on");
    await page.locator('[data-history-pause="on"]').click();
    await page.locator("[data-history-confirm-ok]").click();
    await page.waitForSelector('[data-history-pause="off"]', { timeout: 5000 });
    check(!state.paused.has(VIEWER.id), "pause: turned back on");

    // Clear all.
    await page.locator("[data-history-clear]").click();
    await page.waitForSelector('[data-history-confirm="clear"]');
    await page.screenshot({ path: join(outDir, "history-clear-1280-light.png") });
    await page.locator("[data-history-confirm-ok]").click();
    await page.waitForSelector("[data-history-empty]", { timeout: 5000 });
    check(historyOf(VIEWER.id).size === 0, "clear: the server history is empty");
    check((await page.getByText("This list has no videos.").count()) === 1, 'clear: "This list has no videos."');
    await context.close();

    const out = await open(browser, "/feed/history", { user: null });
    await out.page.waitForSelector('[data-history-state="signed-out"]', { timeout: 30000 });
    check((await out.page.getByText("Keep track of what you watch").count()) === 1, "signed out: Keep track of what you watch");
    await out.context.close();
  }

  // Screenshots at 1280 and 390, light and dark -------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      reset();
      seedHistory();
      state.reactions.set(`${VIEWER.id}|${CLIP_ID}`, "like");
      const opts = { width, height, theme, scale: 2 };
      {
        const { context, page } = await open(browser, "/feed/history", opts);
        await page.waitForSelector('[data-history-state="ready"] [data-thumb-progress]', { timeout: 30000 });
        await imagesLoaded(page);
        await page.screenshot({ path: join(outDir, `history-${width}-${theme}.png`) });
        console.log(`shot  history-${width}-${theme}.png`);
        await context.close();
      }
      {
        const { context, page } = await open(browser, "/", opts);
        await page.waitForSelector("[data-thumb-progress]", { timeout: 30000 });
        await imagesLoaded(page);
        await page.screenshot({ path: join(outDir, `home-${width}-${theme}.png`) });
        console.log(`shot  home-${width}-${theme}.png`);
        await context.close();
      }
      for (const user of [VIEWER, OWNER]) {
        const { context, page } = await open(browser, watchUrl(), { ...opts, user });
        await page.waitForSelector("[data-reactions]", { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, null, { timeout: 30000 });
        await page.evaluate(() => {
          const v = document.querySelector("video");
          v.pause();
          v.currentTime = 4;
        });
        await page.waitForTimeout(400);
        if (width < 1016) await page.evaluate(() => document.querySelector("[data-reactions]").scrollIntoView({ block: "center" }));
        const name = `watch-${user === OWNER ? "owner" : "viewer"}-${width}-${theme}.png`;
        await page.screenshot({ path: join(outDir, name) });
        console.log(`shot  ${name}`);
        await context.close();
      }
    }
  }

  await browser.close();
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
} finally {
  cleanup();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall engagement checks passed, screenshots in ${outDir}`);
process.exit(0);
