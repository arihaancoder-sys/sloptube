#!/usr/bin/env node
// Checks and screenshots of Snips, without a real database.
//
//   node scripts/shorts-shots.mjs [out-dir]   (default: shots/shorts)
//
// 1. Makes a 6 second vertical test clip with ffmpeg (HLS, shared by every
//    made up short) and a thumbnail per video.
// 2. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    viewer, three made up channels, 14 shorts and 8 regular videos. Snips
//    are ranked and paged with the same order as 013_shorts.sql
//    (compareShorts and isAfterCursor from lib/shorts/cursor.ts, shortsScore
//    from lib/shorts/rules.ts), the viewer's own short left out.
// 3. Starts `next dev` pointed at it.
// 4. With Playwright: the flag off (the placeholder, no shelf, no tab, the
//    routes say 403); the home shelf with shorts out of the grid; /shorts
//    autoplaying muted and looping, a tap for sound, arrow keys and the
//    wheel, the address following along, the 3 second view ping, a like,
//    the comments side sheet on desktop and bottom sheet on phones, share;
//    the next page loading without repeats; a deep link starting at its
//    short and a regular video sent on to /watch; the channel Snips tab in
//    9:16. Then screenshots at 1280 and 390, light and dark.
//
// Needs ffmpeg and Playwright with Chromium. Made up names and text, no real
// data. Nothing here touches the network.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildEncodeArgs } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";
import { compareShorts, isAfterCursor } from "../lib/shorts/cursor.ts";
import { shortsScore } from "../lib/shorts/rules.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/shorts"));
const APP_PORT = Number(process.env.APP_PORT ?? 3463);
const CLIP_S = 6;

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

// 1. Made up people, channels and videos ----------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const VIEWER = { id: "a0000000-0000-4000-8000-000000000001", email: "viewer@example.com", username: "viewer", name: "Viewer", handle: "viewer" };
const CHANNELS = [
  { id: "c0000000-0000-4000-8000-000000000001", owner: "a0000000-0000-4000-8000-000000000011", handle: "pocketchef", name: "Pocket Chef", subs: 48200 },
  { id: "c0000000-0000-4000-8000-000000000002", owner: "a0000000-0000-4000-8000-000000000012", handle: "trailminutes", name: "Trail Minutes", subs: 9120 },
  { id: "c0000000-0000-4000-8000-000000000003", owner: "a0000000-0000-4000-8000-000000000013", handle: "tinysynth", name: "Tiny Synth", subs: 731 },
  { id: "c0000000-0000-4000-8000-000000000009", owner: VIEWER.id, handle: VIEWER.handle, name: VIEWER.name, subs: 3 },
];
const SHORT_TITLES = [
  "One pan breakfast in 40 seconds",
  "The fastest way to fold a fitted sheet",
  "Sunrise from the ridge, no filter",
  "A bass line you can play with one finger",
  "Crispy rice trick everybody should know",
  "Crossing the creek the easy way",
  "Turning a kettle sound into a beat",
  "Lemon bars, but tiny",
  "Packing a tent in under a minute",
  "Three chords, one hundred songs",
  "Garlic peeling hack, tested",
  "Fog rolling over the valley",
  "Drum loop from kitchen pans",
  "The calmest pancake flip",
];
const REGULAR_TITLES = [
  "Ten weeknight dinners, start to finish",
  "Hiking the long loop: a full day on the trail",
  "Building a synth from a kit, part one",
  "Sourdough for people with no time",
  "Gear I actually use after five years",
  "Live session: forty minutes of ambient",
  "Meal prep for the whole week",
  "Map reading basics, explained slowly",
];

const vid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (t) => new Date(t).toISOString().replace("Z", "456+00:00");

const SHORTS = SHORT_TITLES.map((title, i) => ({
  id: vid(i + 1),
  title,
  channel: CHANNELS[i % 3],
  published: NOW - (i * 5 + 1) * HOUR,
  views: [12400, 830, 45100, 96, 7300, 2, 1500, 610, 22, 3900, 270, 15, 5, 48000][i],
  likes: [880, 40, 3100, 3, 410, 0, 77, 52, 1, 260, 9, 0, 0, 2900][i],
  comments: [3, 1, 4, 0, 2, 0, 1, 0, 0, 2, 0, 0, 0, 5][i],
  duration: CLIP_S,
  short: true,
}));
// The viewer's own short: never in their feed.
SHORTS.push({ id: vid(99), title: "My own test short", channel: CHANNELS[3], published: NOW - 0.5 * HOUR, views: 1, likes: 0, comments: 0, duration: CLIP_S, short: true });
const REGULAR = REGULAR_TITLES.map((title, i) => ({
  id: vid(i + 101),
  title,
  channel: CHANNELS[i % 3],
  published: NOW - (i * 9 + 2) * HOUR,
  views: [128000, 5400, 980, 31000, 2200, 640, 15000, 87][i],
  likes: 0,
  comments: 0,
  duration: [612, 2710, 1844, 903, 415, 2400, 1290, 333][i],
  short: false,
}));
const ALL = [...SHORTS, ...REGULAR];
const byId = new Map(ALL.map((v) => [v.id, v]));

// 2. The fixture clip and thumbnails ------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-shorts-"));
const hlsDir = join(work, "clip");
mkdirSync(hlsDir, { recursive: true });
const source = join(work, "source.mp4");
console.log(`fixture: making a ${CLIP_S} second vertical clip in`, work);
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", `testsrc2=size=360x640:rate=30:duration=${CLIP_S}`,
  "-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${CLIP_S}`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
]);
run("ffmpeg", buildEncodeArgs({ input: source, renditions: pickRenditions({ width: 360, height: 640, fps: 30 }), hasAudio: true, segmentSeconds: 2 }), { cwd: hlsDir });
ALL.forEach((v, i) => {
  const dir = join(work, "thumbs", v.id);
  mkdirSync(dir, { recursive: true });
  const size = v.short ? "360x640" : "640x360";
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=${size}:rate=1:duration=1`,
    "-vf", `hue=h=${(i * 47) % 360}:s=0.8`, "-frames:v", "1", "-c:v", "libwebp", join(dir, "thumb-1.webp"),
  ]);
});
const TYPES = { ".m3u8": "application/vnd.apple.mpegurl", ".m4s": "video/iso.segment", ".mp4": "video/mp4", ".webp": "image/webp" };

// 3. Sessions ------------------------------------------------------------------------------------

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
const SESSION = sessionFor(VIEWER);

// 4. In memory state -------------------------------------------------------------------------------

const state = { flag: "everyone", reactions: new Map(), watched: new Map(), pings: [], listCalls: [] };
function seed(flag = "everyone") {
  state.flag = flag;
  state.reactions.clear();
  state.watched.clear();
  state.pings.length = 0;
  state.listCalls.length = 0;
  for (const v of ALL) v.likesNow = v.likes;
}
seed();

const channelRow = (c) => ({
  id: c.id, owner_id: c.owner, handle: c.handle, name: c.name, description: "A made up channel for the Snips checks.",
  links: [], avatar_url: null, banner_url: null, handle_changed_at: null, subscriber_count: c.subs,
  video_count: ALL.filter((v) => v.channel === c).length, created_at: new Date(NOW - 400 * DAY).toISOString(), comments_default: "on",
});

function shortRow(v, me, extra = {}) {
  return {
    id: v.id, title: v.title, duration_s: v.duration, width: v.short ? 360 : 1280, height: v.short ? 640 : 720, thumbnail_url: null,
    hls_key: `hls/${v.id}/master.m3u8`, published_at: stamp(v.published), views: v.views, like_count: v.likesNow, comment_count: v.comments,
    comments_mode: "on", my_reaction: me ? (state.reactions.get(v.id) ?? null) : null, channel_id: v.channel.id, channel_handle: v.channel.handle,
    channel_name: v.channel.name, channel_avatar_url: null, ...extra,
  };
}

function feedRow(v) {
  return {
    id: v.id, title: v.title, duration_s: v.duration, thumbnail_url: null, hls_key: `hls/${v.id}/master.m3u8`, preview_sprite_key: null,
    published_at: stamp(v.published), views: v.views, score: 0, channel_id: v.channel.id, channel_handle: v.channel.handle,
    channel_name: v.channel.name, channel_avatar_url: null, is_short: v.short,
  };
}

/** list_shorts(cursor, lim), the order of 013_shorts.sql. */
function listShorts(me, { cursor, lim }) {
  const at = cursor?.at ?? stamp(Date.now());
  const asOf = Date.parse(at);
  const after = cursor ? { tier: cursor.tier, score: Number(cursor.score), id: cursor.id } : null;
  state.listCalls.push({ cursor: cursor ?? null, lim });
  return SHORTS.filter((v) => v.published <= asOf && v.channel.owner !== me?.id)
    .map((v) => {
      const seen = me ? state.watched.get(`${me.id}|${v.id}`) : undefined;
      const tier = seen !== undefined && seen <= asOf ? 1 : 0;
      const score = shortsScore({ views: v.views, likes: v.likesNow, comments: v.comments }, v.published, asOf);
      return { v, key: { tier, score, id: v.id } };
    })
    .sort((a, b) => compareShorts(a.key, b.key))
    .filter((r) => !after || isAfterCursor(r.key, after))
    .slice(0, Math.min(Math.max(lim ?? 10, 1), 30))
    .map((r) => shortRow(r.v, me, { tier: r.key.tier, score: r.key.score, as_of: at }));
}

/** feed_videos with exclude_shorts and channel_shorts, newest first. */
function feedVideos({ kind, cursor, cursor_id, lim, for_channel, exclude_shorts }) {
  return ALL.filter((v) => (kind === "channel" ? v.channel.id === for_channel : kind === "channel_shorts" ? v.channel.id === for_channel && v.short : true))
    .filter((v) => !(exclude_shorts && kind !== "channel_shorts" && v.short))
    .sort((a, b) => b.published - a.published || (a.id < b.id ? 1 : -1))
    .filter((v) => !cursor || stamp(v.published) < cursor || (stamp(v.published) === cursor && v.id < cursor_id))
    .slice(0, lim ?? 24)
    .map(feedRow);
}

const COMMENT_LINES = ["This is so satisfying to watch.", "Saved for later!", "How is this only a few seconds long", "Tried it, works.", "The sound at the end"];
const PEOPLE = [["Pixel Fern", "pixelfern"], ["Moss Garden", "mossgarden"], ["Paper Crane", "papercrane"], ["Coin Robot", "coinrobot"], ["Bread Lab", "breadlab"]];
function commentsOf(videoId) {
  const v = byId.get(videoId);
  if (!v) return [];
  return Array.from({ length: v.comments }, (_, i) => ({
    id: `d0000000-0000-4000-8000-${videoId.slice(-6)}${String(i).padStart(6, "0")}`, video_id: videoId, parent_id: null, body: COMMENT_LINES[i % 5],
    like_count: [41, 12, 3, 1, 0][i % 5], reply_count: 0, pinned: false, hearted: false, created_at: stamp(NOW - (i + 1) * 2 * HOUR), edited_at: null,
    deleted: false, author_handle: PEOPLE[i % 5][1], author_name: PEOPLE[i % 5][0], author_avatar_url: null, by_owner: false, mine: false, liked: false,
  }));
}

// 5. The stand in server -----------------------------------------------------------------------

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message) => send(400, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");

  const media = url.pathname.match(/^\/hls\/([0-9a-f-]{36})\/(.+)$/);
  if (media) {
    const name = normalize(decodeURIComponent(media[2])).replace(/^([/\\])+/, "");
    const file = name === "thumb-1.webp" ? join(work, "thumbs", media[1], name) : join(hlsDir, name);
    if (!file.startsWith(work) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const me = req.headers.authorization === `Bearer ${SESSION.token}` ? VIEWER : null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");
  const on = () => state.flag === "everyone";

  if (url.pathname === "/auth/v1/user") return me ? send(200, SESSION.authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["shorts", "feed", "watch", "channels", "accounts", "engagement", "comments"].map((key) => ({
      key, label: key, description: "", mode: key === "shorts" ? state.flag : "everyone", users: [], updated_at: null,
    }));
    return send(200, flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    return one(eq("id") === VIEWER.id ? [{ username: VIEWER.username, display_name: VIEWER.name, avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const c = CHANNELS.find((x) => x.handle === eq("handle") || x.owner === eq("owner_id") || x.id === eq("id"));
    return one(c ? [channelRow(c)] : []);
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  switch (rpc) {
    case "list_shorts":
      if (!on()) return fail("shorts_off");
      return send(200, listShorts(me, args));
    case "get_short": {
      const v = byId.get(args.video_id);
      if (!on() || !v) return send(200, []);
      return send(200, [shortRow(v, me, { is_short: v.short })]);
    }
    case "feed_videos":
      return send(200, feedVideos(args));
    case "react": {
      const v = byId.get(args.video_id);
      if (!me || !v) return fail(me ? "not_found" : "not_signed_in");
      const before = state.reactions.get(v.id) ?? null;
      if (before === "like") v.likesNow--;
      if (args.kind === "like") v.likesNow++;
      if (args.kind) state.reactions.set(v.id, args.kind);
      else state.reactions.delete(v.id);
      return send(200, [{ reaction: args.kind ?? null, like_count: v.likesNow, dislike_count: null }]);
    }
    case "watch_ping": {
      state.pings.push({ id: args.video_id, played: Number(args.played_s), position: Number(args.position_s), at: Date.now() });
      const total = state.pings.filter((p) => p.id === args.video_id).reduce((s, p) => s + p.played, 0);
      if (me && total >= 3 && !state.watched.has(`${me.id}|${args.video_id}`)) state.watched.set(`${me.id}|${args.video_id}`, Date.now());
      return send(200, [{ counted: total >= 3, views: byId.get(args.video_id)?.views ?? 0, watched_s: Math.floor(total) }]);
    }
    case "comments_info":
      return send(200, [{ comment_count: byId.get(args.video_id)?.comments ?? 0, mode: "on", is_owner: false }]);
    case "list_comments":
      return send(200, args.cursor ? [] : commentsOf(args.video_id));
    case "comments_since":
    case "list_replies":
    case "my_progress":
    case "my_subscriptions":
    case "subscriptions_feed":
    case "related_videos":
    case "video_engagement":
      return send(200, []);
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 6. next dev ------------------------------------------------------------------------------------

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

// 7. Playwright -------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const cookie = { name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSION.session)), domain: "localhost", path: "/" };

async function open(browser, path, { width = 1280, height = 800, theme = "light", scale = 1, signedIn = true, mobile = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale, hasTouch: mobile, isMobile: mobile });
  if (signedIn) await context.addCookies([cookie]);
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

const until = async (fn, ms = 6000) => {
  for (let t = 0; t < ms && !(await fn()); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
const activeId = (page) => page.locator("[data-shorts-feed]").getAttribute("data-shorts-active");
const activeVideo = (page) => page.locator('[data-short-active="true"] video');
const shortIds = (page) => page.$$eval("[data-short]", (els) => els.map((e) => e.getAttribute("data-short")));
/** The feed order the mock gives a fresh first page, for checking. */
const expected = () => listShorts(VIEWER, { cursor: null, lim: 30 }).map((r) => r.id);

try {
  await waitForApp();
  for (const p of ["/", "/shorts", `/shorts/${vid(3)}`, "/@pocketchef/shorts"]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  // The flag off ------------------------------------------------------------------------------------
  {
    seed("off");
    const { context, page } = await open(browser, "/shorts");
    await page.waitForSelector('[data-shorts-state="off"]', { timeout: 60000 });
    check(true, "flag off: /shorts shows the No Snips yet placeholder");
    const api = await page.evaluate(async () => {
      const r = await fetch("/api/shorts");
      return [r.status, (await r.json()).error];
    });
    check(api[0] === 403 && api[1] === "shorts_off", `flag off: /api/shorts answers ${api.join(" ")}`);
    await page.goto(app + "/");
    await page.waitForSelector('[data-feed-state="ready"]', { timeout: 60000 });
    check((await page.locator("[data-shorts-shelf]").count()) === 0, "flag off: no shelf on the home feed");
    const shortCards = await page.locator(SHORTS.map((s) => `[data-feed-card="${s.id}"]`).join(",")).count();
    check(shortCards > 0, `flag off: shorts stay in the home grid as cards (${shortCards})`);
    check((await page.locator('nav[aria-label="Guide"] a[href="/shorts"]').count()) === 0, "flag off: no Snips in the guide");
    await page.goto(app + "/@pocketchef");
    await page.waitForSelector('[data-channel-state="ready"]', { timeout: 60000 });
    check((await page.locator('nav[aria-label="Channel"] a:has-text("Snips")').count()) === 0, "flag off: no Snips tab on the channel page");
    await context.close();
  }

  // The home shelf ------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/");
    await page.waitForSelector("[data-shorts-shelf]", { timeout: 60000 });
    const shelf = await page.locator("[data-shorts-shelf] [data-short-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-short-card")));
    check(shelf.length === 12, `shelf: 12 shorts (${shelf.length})`);
    check(!shelf.includes(vid(99)), "shelf: never the viewer's own short");
    check((await page.locator("#shorts-shelf-title").innerText()).trim() === "Snips", "shelf: the Snips header with the mark");
    const inGrid = await page.locator(SHORTS.map((s) => `[data-feed-card="${s.id}"]`).join(",")).count();
    check(inGrid === 0, `shelf: shorts are out of the grid (${inGrid})`);
    const box = await page.locator("[data-shorts-shelf] [data-short-card] a").first().boundingBox();
    check(box && box.height > box.width * 1.6, `shelf: vertical thumbnails (${Math.round(box?.width)} x ${Math.round(box?.height)})`);
    const cards = await page.locator("[data-feed-card]").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    const shelfTop = (await page.locator("[data-shorts-shelf]").boundingBox()).y;
    check(cards.filter((t) => t < shelfTop).length === 4, `shelf: after the first row of four cards (${cards.filter((t) => t < shelfTop).length})`);
    check((await page.locator('nav[aria-label="Guide"] a[href="/shorts"]').count()) > 0, "guide: Snips under Home");
    await page.locator("[data-shorts-shelf] [data-short-card]").nth(1).locator("a").first().click();
    await page.waitForURL(/\/shorts\/[0-9a-f-]{36}$/, { timeout: 30000 });
    await page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
    check((await activeId(page)) === shelf[1], "shelf: a click opens /shorts/<id> at that short");
    await context.close();
  }

  // The feed ---------------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/shorts");
    await page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
    const order = expected();
    const first = await activeId(page);
    check(first === order[0], `feed: starts at the top ranked short (${first === order[0]})`);
    check(!(await shortIds(page)).includes(vid(99)), "feed: never the viewer's own short");
    await until(async () => (await activeVideo(page).evaluate((v) => v.currentTime)) > 0.5, 15000);
    const v = await activeVideo(page).evaluate((el) => ({ t: el.currentTime, muted: el.muted, loop: el.loop, paused: el.paused }));
    check(v.t > 0.5 && !v.paused, `feed: autoplays (${v.t.toFixed(1)} s)`);
    check(v.muted && (await page.locator("[data-short-muted]").count()) === 1, "feed: muted with Tap to unmute");
    check(v.loop, "feed: loops");
    // The 3 second view ping.
    await until(() => state.pings.some((p) => p.id === first && p.played >= 3), 9000);
    const ping = state.pings.find((p) => p.id === first && p.played >= 3);
    check(Boolean(ping), `views: a ping with ${ping?.played ?? 0} s goes out at 3 seconds`);
    // Loops back to the start.
    await until(async () => (await activeVideo(page).evaluate((el) => el.currentTime)) < 1, 9000);
    check(!(await activeVideo(page).evaluate((el) => el.paused)), "feed: plays on after the end (loop)");

    // A tap turns the sound on, and it stays on for the next short.
    await page.locator('[data-short-active="true"] [data-short-tap]').click();
    check(!(await activeVideo(page).evaluate((el) => el.muted)), "tap: the sound comes on");
    check((await page.locator("[data-short-muted]").count()) === 0, "tap: Tap to unmute goes away");
    await page.locator('[data-short-active="true"] [data-short-tap]').click();
    check(await activeVideo(page).evaluate((el) => el.paused), "tap: a second tap pauses");

    // Arrow keys.
    await page.keyboard.press("ArrowDown");
    await until(async () => (await activeId(page)) === order[1]);
    check((await activeId(page)) === order[1], "keys: ArrowDown moves to the next short");
    await until(() => new URL(page.url()).pathname === `/shorts/${order[1]}`);
    check(new URL(page.url()).pathname === `/shorts/${order[1]}`, "keys: the address follows (/shorts/<id>)");
    await until(async () => !(await activeVideo(page).evaluate((el) => el.paused)), 10000);
    check(!(await activeVideo(page).evaluate((el) => el.muted)), "keys: the next short keeps the sound on");
    await page.keyboard.press("ArrowUp");
    await until(async () => (await activeId(page)) === order[0]);
    check((await activeId(page)) === order[0], "keys: ArrowUp goes back");
    // The wheel: one notch, or one trackpad swipe of many small events, is one short.
    await page.mouse.move(640, 400);
    await page.mouse.wheel(0, 100);
    await until(async () => (await activeId(page)) === order[1]);
    check((await activeId(page)) === order[1], "wheel: one notch moves to the next short");
    await page.waitForTimeout(600); // the end of that gesture
    for (let k = 0; k < 12; k++) await page.mouse.wheel(0, -15);
    await until(async () => (await activeId(page)) === order[0]);
    await page.waitForTimeout(600);
    check((await activeId(page)) === order[0], "wheel: a trackpad swipe up moves back one short, not more");
    await page.waitForTimeout(600);
    await page.mouse.wheel(0, 100);
    await until(async () => (await activeId(page)) === order[1]);
    // The buttons on the side.
    await page.locator("[data-shorts-next]").click();
    await until(async () => (await activeId(page)) === order[2]);
    check((await activeId(page)) === order[2], "buttons: Next Snip");

    // A like.
    const likeBtn = page.locator('[data-short-active="true"] [data-short-like]');
    const before = Number(await likeBtn.getAttribute("data-short-like"));
    await likeBtn.click();
    await until(() => state.reactions.get(order[2]) === "like");
    check(state.reactions.get(order[2]) === "like", "like: react(like) reaches the database");
    check(Number(await likeBtn.getAttribute("data-short-like")) === before + 1, `like: the count goes up (${before} to ${before + 1})`);

    // Comments in the side sheet.
    await page.locator('[data-short-active="true"] [data-short-comments]').click();
    await page.waitForSelector('[data-comments-sheet="ready"] [data-comment]', { timeout: 30000 });
    const sheet = await page.locator("[data-comments-sheet]").boundingBox();
    const player = await page.locator('[data-short-active="true"] [data-short-player]').boundingBox();
    check(sheet.x >= player.x + player.width - 1 && sheet.width > 380, `comments: a side sheet right of the player on desktop (sheet at ${Math.round(sheet.x)}, player ends at ${Math.round(player.x + player.width)})`);
    const n = await page.locator("[data-comments-sheet] [data-comment]").count();
    check(n === byId.get(order[2]).comments, `comments: the short's ${n} comments, from feature 10's section`);
    check((await page.locator("[data-comments-sheet] [data-comment-box]").count()) === 1, "comments: the comment box is there");
    await page.locator("[data-comments-sheet-close]").click();
    check((await page.locator("[data-comments-sheet]").count()) === 0, "comments: close");

    // Share.
    await page.locator('[data-short-active="true"] [data-short-share]').click();
    const link = await page.locator("[data-share-link]").inputValue();
    check(link === `${app}/shorts/${order[2]}`, `share: the /shorts link (${link.replace(app, "")})`);
    check((await page.locator("[data-share-start]").count()) === 0, "share: no Start at for a short");
    await page.keyboard.press("Escape");

    // The next page, without repeats.
    for (let i = 3; i <= 8; i++) {
      await page.keyboard.press("ArrowDown");
      await until(async () => (await activeId(page)) === order[i]);
    }
    await until(async () => (await shortIds(page)).length === order.length, 10000);
    const ids = await shortIds(page);
    check(ids.length === order.length && new Set(ids).size === ids.length, `paging: all ${ids.length} shorts, none twice`);
    check(JSON.stringify(ids) === JSON.stringify(order), "paging: in the ranked order");
    const second = state.listCalls.find((c) => c.cursor);
    check(Boolean(second && second.cursor.at && second.cursor.id), "paging: the cursor carries the first page's time");
    // The same cursor, asked again, answers the same page.
    const again = await page.evaluate(async () => {
      const first = await (await fetch("/api/shorts")).json();
      const a = await (await fetch(`/api/shorts?cursor=${encodeURIComponent(first.next)}`)).json();
      const b = await (await fetch(`/api/shorts?cursor=${encodeURIComponent(first.next)}`)).json();
      return [a.shorts.map((s) => s.id).join(), b.shorts.map((s) => s.id).join()];
    });
    check(again[0] === again[1] && again[0].length > 0, "paging: the same cursor gives the same page");
    await context.close();
  }

  // Watched shorts go down ------------------------------------------------------------------------------
  {
    const order = expected();
    state.watched.set(`${VIEWER.id}|${order[0]}`, Date.now() - 1000);
    const now = expected();
    check(now[now.length - 1] === order[0] && now[0] === order[1], "ranking: a watched short moves below the unwatched ones");
    seed();
  }

  // Deep links ------------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, `/shorts/${vid(9)}`);
    await page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
    const ids = await shortIds(page);
    check(ids[0] === vid(9) && (await activeId(page)) === vid(9), "deep link: starts at that short");
    check(ids.filter((x) => x === vid(9)).length === 1, "deep link: and it is not repeated below");
    await page.goto(app + `/shorts/${vid(101)}`);
    await page.waitForURL(/\/watch\?v=/, { timeout: 30000 });
    check(new URL(page.url()).searchParams.get("v") === vid(101), "deep link: a regular video goes on to /watch");
    await page.goto(app + "/shorts/f0000000-0000-4000-8000-000000000777");
    await page.waitForSelector('[data-shorts-state="missing"]', { timeout: 30000 });
    check(true, "deep link: an unknown id says the Snip isn't available");
    await context.close();
  }

  // Signed out ---------------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/shorts", { signedIn: false });
    await page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
    await page.locator('[data-short-active="true"] [data-short-like]').click();
    await page.waitForURL(/\/login\?next=/, { timeout: 15000 });
    check(/^\/shorts\//.test(new URL(page.url()).searchParams.get("next") ?? ""), "signed out: a like goes to sign in and back");
    await context.close();
  }

  // The channel Snips tab ---------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/@pocketchef/shorts");
    await page.waitForSelector('[data-channel-shorts="ready"]', { timeout: 60000 });
    const ids = await page.locator("[data-short-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-short-card")));
    const mine = SHORTS.filter((s) => s.channel.handle === "pocketchef").sort((a, b) => b.published - a.published).map((s) => s.id);
    check(JSON.stringify(ids) === JSON.stringify(mine), `channel: the channel's ${ids.length} shorts, newest first`);
    const box = await page.locator("[data-short-card] a").first().boundingBox();
    check(Math.abs(box.height / box.width - 16 / 9) < 0.05, "channel: 9:16 cards");
    check((await page.locator('nav[aria-label="Channel"] a[aria-current="page"]').innerText()).trim().toLowerCase() === "snips", "channel: the Snips tab is on");
    await page.goto(app + "/@pocketchef/videos");
    await page.waitForSelector('[data-channel-videos="videos"]', { timeout: 60000 });
    const inVideos = await page.locator(SHORTS.map((s) => `[data-feed-card="${s.id}"]`).join(",")).count();
    check(inVideos === 0, "channel: shorts are out of the Videos tab");
    await context.close();
  }

  // Phones: the bottom sheet -----------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/shorts", { width: 390, height: 844, mobile: true });
    await page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
    const player = await page.locator('[data-short-active="true"] [data-short-player]').boundingBox();
    check(Math.round(player.width) === 390, `phone: the short fills the width (${Math.round(player.width)})`);
    await page.locator('[data-short-active="true"] [data-short-comments]').tap();
    await page.waitForSelector('[data-comments-sheet="ready"]', { timeout: 30000 });
    const sheet = await page.locator("[data-comments-sheet]").boundingBox();
    check(Math.round(sheet.width) === 390 && sheet.y > 150 && Math.round(sheet.y + sheet.height) === 844, `phone: a bottom sheet (top at ${Math.round(sheet.y)})`);
    await context.close();
  }

  // Screenshots ----------------------------------------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      const height = width === 390 ? 844 : 800;
      const mobile = width === 390;
      seed();
      const shot = (name) => join(outDir, `${name}-${width}-${theme}.png`);

      const home = await open(browser, "/", { width, height, theme, scale: 2, mobile });
      await home.page.waitForSelector("[data-shorts-shelf]", { timeout: 60000 });
      await home.page.locator("[data-shorts-shelf]").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - (innerWidth < 600 ? 260 : 330)));
      await home.page.waitForFunction(() => [...document.querySelectorAll("[data-shorts-shelf] img")].slice(0, 3).every((i) => i.complete && i.naturalWidth > 0));
      await home.page.waitForTimeout(300);
      await home.page.screenshot({ path: shot("home-shelf") });
      await home.context.close();

      const feed = await open(browser, "/shorts", { width, height, theme, scale: 2, mobile });
      await feed.page.waitForSelector('[data-shorts-feed="ready"]', { timeout: 60000 });
      await until(async () => (await activeVideo(feed.page).evaluate((v) => v.currentTime)) > 1.2, 15000);
      await feed.page.screenshot({ path: shot("shorts") });
      await feed.page.locator('[data-short-active="true"] [data-short-comments]').click();
      await feed.page.waitForSelector('[data-comments-sheet="ready"] [data-comment]', { timeout: 30000 });
      await feed.page.waitForTimeout(300);
      await feed.page.screenshot({ path: shot("shorts-comments") });
      await feed.context.close();

      const ch = await open(browser, "/@pocketchef/shorts", { width, height, theme, scale: 2, mobile });
      await ch.page.waitForSelector('[data-channel-shorts="ready"]', { timeout: 60000 });
      await ch.page.waitForFunction(() => [...document.querySelectorAll("[data-short-card] img")].every((i) => i.complete && i.naturalWidth > 0));
      await ch.page.screenshot({ path: shot("channel-shorts") });
      await ch.context.close();
    }
  }
  await browser.close();
} catch (err) {
  console.error(err);
  failures.push(String(err?.message ?? err));
} finally {
  cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${outDir}`);
process.exit(0);
