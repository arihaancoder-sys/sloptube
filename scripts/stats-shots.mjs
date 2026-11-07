#!/usr/bin/env node
// Checks and screenshots of analytics (feature 13), without a real database.
//
//   node scripts/stats-shots.mjs [out-dir]   (default: shots/stats)
//
// 1. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint). It knows a made up channel owner with a few
//    made up videos and answers studio_analytics, video_analytics and
//    realtime_views for any range with made up days, the way 015_stats.sql
//    shapes them: retention buckets built with the same marking as
//    stats_reached(), traffic sources for one video and none for another,
//    and not_allowed for a video that is not the owner's.
// 2. Starts `next dev` pointed at it.
// 3. With Playwright: the stats flag off (no Analytics in the nav, the coming
//    soon page, 403 stats_off from the routes, no analytics links in Content
//    or on the edit page); the channel overview (the four numbers, the line
//    and bar charts with their tooltips, the top videos, realtime, the range
//    menu kept in the address); a video's analytics (views, watch time,
//    average view duration and percentage, likes against dislikes, comments,
//    the retention curve, traffic sources, no country card); a video without
//    sources or retention; somebody else's video. Then screenshots at 1280
//    and 390, light and dark.
//
// Needs Playwright with Chromium. Made up names, no real data. Nothing here
// touches the network.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { addDays, rangeBounds, RANGES } from "../lib/stats/rules.ts";
import { bucketsFromMasks, markPing } from "../lib/stats/retention.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/stats"));
const APP_PORT = Number(process.env.APP_PORT ?? 3473);

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

// 1. A made up owner, a channel, videos and their numbers -----------------------------------------

const NOW = Date.now();
const DAY = 86_400_000;
const HOUR = 3_600_000;
const OWNER = { id: "a0000000-0000-4000-8000-000000000002", email: "owner@example.com", username: "owner", name: "Sample Kitchen", handle: "samplekitchen" };
const CHANNEL = { id: "c0000000-0000-4000-8000-000000000001", handle: OWNER.handle, name: OWNER.name, subs: 1234, created: new Date(NOW - 150 * DAY).toISOString() };
const vid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const OTHER_VIDEO = "f0000000-0000-4000-8000-000000000099";
const stamp = (t) => new Date(t).toISOString();

const VIDEOS = [
  { n: 1, title: "Fluffy pancakes in ten minutes", duration: 317, base: 160, short: false },
  { n: 5, title: "Three sauces for any pasta", duration: 402, base: 70, short: false },
  { n: 2, title: "Flipping pancakes in slow motion", duration: 28, base: 45, short: true },
  { n: 3, title: "Sourdough starter, day one", duration: 371, base: 9, short: false },
].map((v) => ({
  ...v,
  id: vid(v.n),
  created: stamp(NOW - (v.n * 9 + 20) * DAY),
  row: {
    id: vid(v.n), title: v.title, description: "", visibility: "public", status: "ready", is_short: v.short, short_choice: null,
    duration_s: v.duration, thumbnail_url: null, thumbnail_name: null, hls_key: `hls/${vid(v.n)}/master.m3u8`, tags: [], comments_mode: null,
    created_at: stamp(NOW - (v.n * 9 + 20) * DAY), published_at: stamp(NOW - (v.n * 9 + 20) * DAY), views: v.base * 120, like_count: v.base * 6,
    comment_count: v.base, deleted_at: null, trash_visibility: null, purge_at: null,
  },
}));

const state = { flag: "everyone", calls: [] };

/** A repeatable wave, no randomness: the same numbers on every run. */
const wave = (i, base) => Math.max(0, Math.round(base * (1 + 0.4 * Math.sin(i / 3.3) + 0.2 * Math.cos(i / 1.9))));

function series(range, base, created, durationS) {
  const { from, days } = rangeBounds(range, NOW, created);
  return Array.from({ length: days }, (_, i) => {
    const views = wave(i + days, base);
    return { day: addDays(from, i), views, watch_s: Math.round(views * durationS * 0.45) };
  });
}
const total = (rows, k) => rows.reduce((s, r) => s + r[k], 0);

function studioAnalytics(range) {
  const { from, to } = rangeBounds(range, NOW, CHANNEL.created);
  const perVideo = VIDEOS.map((v) => ({ v, daily: series(range, v.base, v.created, v.duration) }));
  const daily = perVideo[0].daily.map((d, i) => ({
    day: d.day,
    views: perVideo.reduce((s, p) => s + (p.daily.find((x) => x.day === d.day)?.views ?? 0), 0),
    watch_s: perVideo.reduce((s, p) => s + (p.daily.find((x) => x.day === d.day)?.watch_s ?? 0), 0),
    i,
  }));
  const views = total(daily, "views");
  return {
    range, from, to,
    channel: { id: CHANNEL.id, handle: CHANNEL.handle, name: CHANNEL.name, subscribers: CHANNEL.subs },
    totals: { views, watch_s: total(daily, "watch_s"), subs_gained: Math.round(daily.length * 3.4), subs_lost: Math.round(daily.length * 0.6), viewers: Math.round(views * 0.64) },
    daily: daily.filter((d) => d.views > 0).map(({ day, views, watch_s }) => ({ day, views, watch_s })),
    top: perVideo
      .map(({ v, daily: d }) => ({ ...v.row, views: total(d, "views"), watch_s: total(d, "watch_s") }))
      .filter((v) => v.views > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10),
  };
}

function retentionFor(durationS, viewers) {
  // Most viewers watch the start, fewer stay to the end; marked like watch_ping does.
  const masks = Array.from({ length: viewers }, (_, k) => {
    const stop = Math.min(durationS, 15 + ((k * 53) % 97) * (durationS / 90));
    let m = markPing(0, 0, 0, durationS);
    for (let at = 10; at < stop; at += 10) m = markPing(m, at, 10, durationS);
    return markPing(m, stop, Math.min(10, stop), durationS);
  });
  return bucketsFromMasks(masks);
}

function videoAnalytics(id, range) {
  const v = VIDEOS.find((x) => x.id === id);
  if (!v) return { error: id === OTHER_VIDEO ? "not_allowed" : "not_found" };
  const { from, to } = rangeBounds(range, NOW, v.created);
  const daily = series(range, v.base, v.created, v.duration);
  const views = total(daily, "views");
  // The first video has traffic sources and retention; the sourdough one has neither (pings from before 015).
  const rich = v.n === 1;
  const ret = rich || v.n === 5 ? retentionFor(v.duration, 120) : { viewers: 0, buckets: Array(21).fill(0) };
  const split = [["home", 0.38], ["search", 0.26], ["subscriptions", 0.16], ["external", 0.09], ["channel", 0.06], ["shorts", 0.03], ["direct", 0.02]];
  return {
    range, from, to,
    video: { ...v.row, likes: v.row.like_count, dislikes: Math.round(v.row.like_count * 0.03), comments: v.row.comment_count },
    totals: {
      views, watch_s: total(daily, "watch_s"), likes: Math.round(views * 0.05), dislikes: Math.round(views * 0.002),
      comments: Math.round(views * 0.006), viewers: Math.round(views * 0.82),
    },
    daily,
    retention: { viewers: ret.viewers, buckets: ret.buckets },
    sources: rich ? split.map(([source, f]) => ({ source, views: Math.round(views * f), watch_s: Math.round(views * f * v.duration * 0.45) })) : [],
  };
}

function realtime(id) {
  const top = Math.floor(NOW / HOUR) * HOUR;
  const scale = id ? (VIDEOS.find((v) => v.id === id)?.base ?? 0) / 10 : 28;
  return Array.from({ length: 48 }, (_, i) => ({ hour: stamp(top - (47 - i) * HOUR), views: wave(i, scale) })).filter((h) => h.views > 0);
}

// 2. Sessions ----------------------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString("base64url");
const exp = Math.floor(NOW / 1000) + 24 * 3600;
const token = [
  b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  b64url(JSON.stringify({ sub: OWNER.id, email: OWNER.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
  b64url("not-a-real-signature"),
].join(".");
const authUser = { id: OWNER.id, aud: "authenticated", role: "authenticated", email: OWNER.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
const session = { access_token: token, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: authUser };

// 3. The stand in server -------------------------------------------------------------------------------

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message) => send(400, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");
  // Thumbnails: one made up picture for every video.
  if (/^\/hls\/[0-9a-f-]{36}\/thumb-1\.webp$/.test(url.pathname)) {
    const hue = parseInt(url.pathname.slice(39, 41), 10) * 70;
    return send(200, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 90"><rect width="160" height="90" fill="hsl(${hue} 45% 55%)"/><circle cx="80" cy="45" r="22" fill="hsl(${hue} 60% 80%)"/></svg>`, "image/svg+xml");
  }
  if (url.pathname.startsWith("/hls/")) return send(404, { error: "not_found" });

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const me = req.headers.authorization === `Bearer ${token}` ? OWNER : null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");

  if (url.pathname === "/auth/v1/user") return me ? send(200, authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["studio", "stats", "upload", "channels", "comments", "shorts", "watch", "feed", "accounts", "engagement"].map((key) => ({
      key, label: key, description: "", mode: key === "stats" ? state.flag : "everyone", users: [], updated_at: null,
    }));
    return send(200, flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    return one(eq("id") === OWNER.id ? [{ username: OWNER.username, display_name: OWNER.name, avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const hit = eq("owner_id") === OWNER.id || eq("handle") === CHANNEL.handle || eq("id") === CHANNEL.id;
    return one(hit ? [{
      id: CHANNEL.id, owner_id: OWNER.id, handle: CHANNEL.handle, name: CHANNEL.name, description: "", links: [], avatar_url: null, banner_url: null,
      handle_changed_at: null, subscriber_count: CHANNEL.subs, video_count: VIDEOS.length, created_at: CHANNEL.created, comments_default: "on",
    }] : []);
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  if (["studio_analytics", "video_analytics", "realtime_views"].includes(rpc)) {
    state.calls.push({ rpc, args });
    if (!me) return send(401, { code: "42501", message: "permission denied for function " + rpc });
    if (state.flag !== "everyone") return fail("stats_off");
    if (args.range !== undefined && !RANGES.includes(args.range)) return fail("bad_range");
  }
  switch (rpc) {
    case "studio_analytics":
      return send(200, studioAnalytics(args.range));
    case "video_analytics": {
      const r = videoAnalytics(args.video_id, args.range);
      return r.error ? fail(r.error) : send(200, r);
    }
    case "realtime_views":
      if (args.video_id && !VIDEOS.some((v) => v.id === args.video_id)) return fail(args.video_id === OTHER_VIDEO ? "not_allowed" : "not_found");
      return send(200, realtime(args.video_id));
    case "studio_videos":
      return send(200, args.trash ? [] : VIDEOS.map((v) => v.row));
    case "studio_overview":
      return send(200, { channel: { id: CHANNEL.id, handle: CHANNEL.handle, name: CHANNEL.name, subscribers: CHANNEL.subs }, totals: {}, recent: {}, latest: null, trash: 0 });
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase at", mockUrl);

// 4. next dev --------------------------------------------------------------------------------------------

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

// 5. Playwright ------------------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const cookie = { name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(session)), domain: "localhost", path: "/" };

async function open(browser, path, { width = 1280, height = 900, theme = "light", scale = 1, user = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (user) await context.addCookies([cookie]);
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  page.on("pageerror", (e) => failures.push(`page error on ${path}: ${e.message}`));
  await go(page, path);
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

/** page.goto, once more when `next dev` cuts a navigation short while it compiles. */
async function go(page, path) {
  try {
    await page.goto(app + path, { waitUntil: "load" });
  } catch (err) {
    if (!String(err?.message).includes("ERR_ABORTED")) throw err;
    await page.waitForTimeout(1000);
    await page.goto(app + path, { waitUntil: "load" });
  }
}

const until = async (fn, ms = 8000) => {
  for (let t = 0; t < ms && !(await fn()); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
const ready = (page) => page.waitForSelector('[data-studio-state="ready"]', { timeout: 60000 });
const statText = (page, name) => page.locator(`[data-stat="${name}"]:visible [data-stat-value]`).innerText();
const navLabels = (page) => page.locator("[data-studio-nav] [data-studio-nav-item]").evaluateAll((els) => els.map((e) => e.getAttribute("data-studio-nav-item")));

/** Moves the mouse over a chart at a share (0 to 1) of its width and reads the tooltip. */
async function hover(page, card, share) {
  const svg = page.locator(`[data-stats-card="${card}"]:visible svg`).first();
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + 44 + (box.width - 52) * share, box.y + box.height / 2);
  const tip = page.locator(`[data-stats-card="${card}"]:visible [data-chart-tip]`);
  await tip.waitFor({ timeout: 3000 }).catch(() => {});
  return (await tip.count()) ? tip.innerText() : "";
}

const pages = ["/studio/analytics", `/studio/video/${vid(1)}/analytics`, `/studio/video/${vid(3)}/analytics`, "/studio/content", `/studio/video/${vid(1)}/edit`, "/studio"];

try {
  await waitForApp();
  for (const p of pages) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Warm up: `next dev` compiles each page's browser code on its first visit.
  {
    const ctx = await browser.newContext();
    await ctx.addCookies([cookie]);
    const page = await ctx.newPage();
    for (const p of pages) {
      await page.goto(app + p, { waitUntil: "load" }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
    }
    await ctx.close();
  }

  // The flag off ----------------------------------------------------------------------------------------
  {
    state.flag = "off";
    const { context, page } = await open(browser, "/studio/analytics");
    await page.waitForSelector('[data-studio-state="stats-off"]', { timeout: 60000 });
    check(true, "flag off: /studio/analytics shows the coming soon page");
    const labels = await navLabels(page);
    check(labels.length > 0 && !labels.includes("Analytics"), `flag off: no Analytics in the nav (${labels.join(", ")})`);
    await page.screenshot({ path: join(outDir, "off-1280-light.png") });
    await go(page, `/studio/video/${vid(1)}/analytics`);
    await page.waitForSelector('[data-studio-state="stats-off"]', { timeout: 60000 });
    check(true, "flag off: a video's analytics shows the coming soon page");
    for (const path of ["/api/studio/analytics", `/api/studio/analytics/video?id=${vid(1)}`, "/api/studio/analytics/realtime"]) {
      const r = await context.request.get(app + path);
      const res = [r.status(), (await r.json()).error];
      check(res[0] === 403 && res[1] === "stats_off", `flag off: ${path} answers ${res.join(" ")}`);
    }
    await go(page, "/studio/content");
    await ready(page);
    check((await page.locator('[data-content-rows] a[aria-label="Analytics"]').count()) === 0, "flag off: no Analytics link on the Content rows");
    await go(page, `/studio/video/${vid(1)}/edit`);
    await page.waitForSelector(`[data-video-editor="${vid(1)}"]`, { timeout: 60000 });
    check((await page.locator("[data-analytics-link]").count()) === 0, "flag off: no Analytics link on the edit page");
    await context.close();
    state.flag = "everyone";
  }

  // Signed out ------------------------------------------------------------------------------------------
  {
    const { context, page } = await open(browser, "/studio/analytics", { user: false });
    await page.waitForURL(/\/login\?next=/, { timeout: 60000 });
    check(new URL(page.url()).searchParams.get("next") === "/studio/analytics", "signed out: goes to /login?next=/studio/analytics");
    const r = await context.request.get(app + "/api/studio/analytics");
    check(r.status() === 401, `signed out: the route answers ${r.status()}`);
    await context.close();
  }

  // The channel overview ----------------------------------------------------------------------------------
  {
    state.calls.length = 0;
    const { context, page } = await open(browser, "/studio/analytics");
    await ready(page);
    const labels = await navLabels(page);
    check(labels.join() === "Dashboard,Content,Analytics,Comments,Customization,Settings", `nav: Analytics after Content (${labels.join(", ")})`);
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Analytics"), "nav: Analytics is the active item");
    const want = studioAnalytics("28d");
    check(state.calls.some((c) => c.rpc === "studio_analytics" && c.args.range === "28d"), "overview: 28 days by default");
    check(state.calls.some((c) => c.rpc === "realtime_views" && c.args.video_id === null), "overview: realtime for the whole channel");
    check((await statText(page, "views")) === want.totals.views.toLocaleString("en-US"), `overview: views ${want.totals.views}`);
    const hours = (want.totals.watch_s / 3600).toFixed(1);
    const watchShown = await statText(page, "watch");
    check(watchShown === (want.totals.watch_s / 3600 >= 100 ? Math.round(want.totals.watch_s / 3600).toLocaleString("en-US") : hours), `overview: watch time ${watchShown} hours`);
    const net = want.totals.subs_gained - want.totals.subs_lost;
    check((await statText(page, "subscribers")) === `+${net}`, `overview: subscribers +${net}`);
    check((await statText(page, "audience")) === want.totals.viewers.toLocaleString("en-US"), "overview: estimated audience");
    await page.waitForSelector('[data-stats-card="views-chart"] svg', { timeout: 10000 });
    check((await page.locator('[data-stats-card="views-chart"] svg path').count()) >= 2, "overview: the views line and its fill");
    check((await page.locator('[data-stats-card="watch-chart"] [data-bar]').count()) === 28, "overview: 28 watch time bars");
    const tipFirst = await hover(page, "views-chart", 0);
    const first = want.daily[0];
    check(tipFirst.includes(first.views.toLocaleString("en-US")) && /\w{3}, \w{3} \d+, \d{4}/.test(tipFirst), `overview: the line's tooltip (${tipFirst.replace(/\n/g, " / ")})`);
    const tipBar = await hover(page, "watch-chart", 0.99);
    check(tipBar.includes("hours"), `overview: a bar's tooltip (${tipBar.replace(/\n/g, " / ")})`);
    await page.screenshot({ path: join(outDir, "hover-1280-light.png") });
    const top = await page.locator("[data-top-video]").evaluateAll((els) => els.map((e) => e.getAttribute("data-top-video")));
    check(top.join() === want.top.map((v) => v.id).join(), "overview: the top videos, most views first");
    check(Number((await page.locator("[data-realtime-total]").innerText()).replace(/,/g, "")) === realtime(null).reduce((s, h) => s + h.views, 0), "overview: realtime adds up 48 hours");
    check((await page.locator('[data-stats-card="realtime"] [data-bar]').count()) > 0, "overview: realtime bars");
    // The range menu.
    await page.locator("[data-range]").selectOption("7d");
    await page.waitForURL(/range=7d/, { timeout: 30000 });
    await until(async () => (await page.locator('[data-channel-analytics="7d"]').count()) === 1, 30000);
    check((await page.locator('[data-stats-card="watch-chart"]:visible [data-bar]').count()) === 7, "range: 7 days gives 7 bars");
    check(state.calls.some((c) => c.rpc === "studio_analytics" && c.args.range === "7d"), "range: studio_analytics(7d)");
    await page.reload();
    await ready(page);
    check((await page.locator("[data-range]").inputValue()) === "7d", "range: kept in the address over a reload");
    await go(page, "/studio/analytics?range=lifetime");
    await ready(page);
    const life = studioAnalytics("lifetime");
    check((await page.locator("[data-range-dates]").innerText()).startsWith(life.from), `range: lifetime starts the day the channel was made (${life.from})`);
    await go(page, "/studio/analytics?range=nonsense");
    await ready(page);
    check((await page.locator("[data-range]").inputValue()) === "28d", "range: an unknown range shows 28 days");
    const bad = await context.request.get(app + "/api/studio/analytics?range=3d");
    check(bad.status() === 400, `route: a bad range answers ${bad.status()}`);
    const okRoute = await context.request.get(app + "/api/studio/analytics?range=90d");
    const okJson = await okRoute.json();
    check(okRoute.status() === 200 && okJson.daily.length === 90, "route: 90 days of days");
    // A top video opens its analytics.
    await go(page, "/studio/analytics");
    await ready(page);
    await page.locator(`[data-top-video="${vid(1)}"] a`).click();
    await page.waitForSelector(`[data-video-analytics="${vid(1)}"]`, { timeout: 60000 });
    check(true, "overview: a top video opens its analytics");
    await context.close();
  }

  // One video ---------------------------------------------------------------------------------------------
  {
    state.calls.length = 0;
    const { context, page } = await open(browser, `/studio/video/${vid(1)}/analytics?range=28d`);
    await page.waitForSelector(`[data-video-analytics="${vid(1)}"]`, { timeout: 60000 });
    const want = videoAnalytics(vid(1), "28d");
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Analytics"), "video: Analytics stays the active item");
    check((await statText(page, "views")) === want.totals.views.toLocaleString("en-US"), "video: views");
    const avg = want.totals.watch_s / want.totals.views;
    const clock = `${Math.floor(Math.round(avg) / 60)}:${String(Math.round(avg) % 60).padStart(2, "0")}`;
    const dur = await page.locator('[data-stat="duration"]:visible').innerText();
    check(dur.includes(clock) && dur.includes("% of the video"), `video: average view duration ${clock} and the percentage (${dur.replace(/\n/g, " / ")})`);
    const share = (want.totals.likes / (want.totals.likes + want.totals.dislikes)) * 100;
    check((await page.locator("[data-like-share]").innerText()) === `${Math.round(share * 10) / 10}%`, `video: likes against dislikes ${share.toFixed(1)}%`);
    check((await page.locator("[data-comments]").innerText()) === want.totals.comments.toLocaleString("en-US"), "video: comments");
    check(await until(async () => (await page.locator('[data-stats-card="retention"]:visible svg').count()) === 1), "video: the retention curve");
    const tipStart = await hover(page, "retention", 0);
    check(tipStart.includes("100% still watching"), `video: everybody is there at the start (${tipStart.replace(/\n/g, " / ")})`);
    const tipEnd = await hover(page, "retention", 1);
    const endShare = Math.round((want.retention.buckets[20] / want.retention.viewers) * 1000) / 10;
    check(tipEnd.includes("The end") && tipEnd.includes(`${endShare}%`), `video: the end of the curve (${tipEnd.replace(/\n/g, " / ")})`);
    const sources = await page.locator("[data-source]").evaluateAll((els) => els.map((e) => e.getAttribute("data-source")));
    check(sources.join() === "home,search,subscriptions,external,channel,shorts,direct", `video: traffic sources, most views first (${sources.join(", ")})`);
    check((await page.locator('[data-stats-card="country"], [data-stats-card="geography"]').count()) === 0, "video: no country card, the ping carries none");
    check(state.calls.some((c) => c.rpc === "realtime_views" && c.args.video_id === vid(1)), "video: realtime for this video");
    await page.locator("[data-range]").selectOption("lifetime");
    await page.waitForURL(/range=lifetime/, { timeout: 30000 });
    check(await until(() => state.calls.some((c) => c.rpc === "video_analytics" && c.args.range === "lifetime"), 30000), "video: the range menu asks for lifetime");
    await context.close();

    // A video whose pings carried no source and no retention yet.
    const s = await open(browser, `/studio/video/${vid(3)}/analytics`);
    await s.page.waitForSelector(`[data-video-analytics="${vid(3)}"]`, { timeout: 60000 });
    check((await s.page.locator('[data-stats-card="sources"]').count()) === 0, "video without sources: no traffic sources card");
    check((await s.page.locator("[data-retention-empty]").count()) === 1, "video without retention: says there is not enough yet");
    await s.context.close();

    // Somebody else's video.
    const o = await open(browser, `/studio/video/${OTHER_VIDEO}/analytics`);
    await o.page.waitForSelector('[data-studio-state="missing"]', { timeout: 60000 });
    check(true, "another channel's video: isn't in your content");
    const r = await o.context.request.get(app + `/api/studio/analytics/video?id=${OTHER_VIDEO}`);
    const res = [r.status(), (await r.json()).error];
    check(res[0] === 403 && res[1] === "not_allowed", `another channel's video: the route answers ${res.join(" ")}`);
    const rt = await o.context.request.get(app + `/api/studio/analytics/realtime?video=${vid(1)}`);
    check(rt.status() === 200 && (await rt.json()).hours.length === 48, "realtime route: 48 hours");
    await o.context.close();
  }

  // The links ----------------------------------------------------------------------------------------------
  {
    const { context, page } = await open(browser, "/studio/content");
    await ready(page);
    await page.locator(`[data-row="${vid(5)}"]`).hover();
    await page.locator(`[data-row="${vid(5)}"] a[aria-label="Analytics"]`).click();
    await page.waitForSelector(`[data-video-analytics="${vid(5)}"]`, { timeout: 60000 });
    check(true, "links: a Content row opens the video's analytics");
    await go(page, `/studio/video/${vid(1)}/edit`);
    await page.waitForSelector(`[data-video-editor="${vid(1)}"]`, { timeout: 60000 });
    await page.locator("[data-analytics-link]").click();
    await page.waitForSelector(`[data-video-analytics="${vid(1)}"]`, { timeout: 60000 });
    check(true, "links: the edit page opens the video's analytics");
    await context.close();
  }

  // Screenshots ---------------------------------------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      const height = width === 390 ? 844 : 900;
      const shot = async (path, name) => {
        const { context, page } = await open(browser, path, { width, height, theme, scale: 2 });
        await ready(page);
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.mouse.move(width - 2, height - 2);
        await page.waitForTimeout(400);
        await page.screenshot({ path: join(outDir, `${name}-${width}-${theme}.png`), fullPage: true });
        await context.close();
      };
      await shot("/studio/analytics", "channel");
      await shot(`/studio/video/${vid(1)}/analytics`, "video");
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
  for (const f of failures) console.error("  " + f);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${outDir}`);
process.exit(0);
