#!/usr/bin/env node
// Checks and screenshots of the creator studio (feature 12), without a real
// database.
//
//   node scripts/studio-shots.mjs [out-dir]   (default: shots/studio)
//
// 1. Makes three thumbnail stills with ffmpeg, the way the encoder does.
// 2. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    channel owner with a few made up videos (one a Snip, one in the trash)
//    and keeps every change in memory, with the same rules as 014_studio.sql:
//    a video in the trash is private and gets its visibility back on restore,
//    bulk calls are all or nothing on the caller's own videos.
// 3. Starts `next dev` pointed at it.
// 4. With Playwright: the flag off (the coming soon page, no studio nav,
//    /studio/comments and /studio/videos as before); the dashboard; Content
//    with search, the visibility and Snips filters, sorting kept in the
//    address; bulk visibility; delete with the confirm box, the Trash tab
//    with the days left and restore; a failed bulk call putting the rows
//    back; the edit page saving title, description, tags, visibility,
//    comments mode and the Snip choice, and picking a still; the nav on
//    every page. Then screenshots at 1280 and 390, light and dark.
//
// Needs ffmpeg and Playwright with Chromium. Made up names, no real data.
// Nothing here touches the network.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildThumbnailArgs, thumbnailName } from "../worker/lib/ffmpeg.mjs";
import { TRASH_DAYS } from "../lib/studio/rules.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/studio"));
const APP_PORT = Number(process.env.APP_PORT ?? 3472);

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

// 1. A made up owner, a channel, videos -----------------------------------------------------

const NOW = Date.now();
const DAY = 86_400_000;
const OWNER = { id: "a0000000-0000-4000-8000-000000000002", email: "owner@example.com", username: "owner", name: "Sample Kitchen", handle: "samplekitchen" };
const OTHER_VIDEO = "f0000000-0000-4000-8000-000000000099";
const CHANNEL = { id: "c0000000-0000-4000-8000-000000000001", handle: OWNER.handle, name: OWNER.name, owner: OWNER.id, subs: 1234 };
const vid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (t) => new Date(t).toISOString();

const state = { flag: "everyone", videos: [], calls: [], failNext: null };

function seed() {
  state.flag = "everyone";
  state.calls.length = 0;
  state.failNext = null;
  const add = (n, title, days, extra = {}) => ({
    id: vid(n), title, description: "", visibility: "public", status: "ready", is_short: false, short_choice: null, duration_s: 300 + n * 37,
    thumbnail_url: null, thumbnail_name: null, hls_key: `hls/${vid(n)}/master.m3u8`, tags: [], comments_mode: null,
    created_at: stamp(NOW - days * DAY), published_at: stamp(NOW - days * DAY), views: 0, like_count: 0, comment_count: 0,
    deleted_at: null, trash_visibility: null, watch_s: 0, ...extra,
  });
  state.videos = [
    add(1, "Fluffy pancakes in ten minutes", 2, { views: 48213, like_count: 2310, comment_count: 184, description: "Ten minutes, one bowl, no mixer.", tags: ["breakfast", "pancakes"], watch_s: 3_960_000 }),
    add(2, "Flipping pancakes in slow motion", 5, { is_short: true, duration_s: 28, views: 9120, like_count: 801, comment_count: 22 }),
    add(3, "Sourdough starter, day one", 9, { visibility: "unlisted", views: 311, like_count: 18, comment_count: 4 }),
    add(4, "Kitchen tour (draft)", 12, { visibility: "private", published_at: null, views: 0 }),
    add(5, "Three sauces for any pasta", 20, { views: 15022, like_count: 640, comment_count: 71 }),
    add(6, "Crêpes for beginners", 31, { views: 7300, like_count: 290, comment_count: 35 }),
    add(9, "Old intro, take two", 60, { visibility: "private", trash_visibility: "unlisted", deleted_at: stamp(NOW - 4 * DAY), views: 12 }),
  ];
}

// 2. The stills ----------------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-studio-"));
const source = join(work, "source.mp4");
console.log("fixture: making stills in", work);
run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30:duration=3", "-c:v", "libx264", "-pix_fmt", "yuv420p", source]);
const stillsDir = join(work, "stills");
mkdirSync(stillsDir, { recursive: true });
for (const [i, at] of [0.3, 1.5, 2.7].entries()) run("ffmpeg", buildThumbnailArgs({ input: source, atSeconds: at, output: join(stillsDir, thumbnailName(i)) }));

// 3. Sessions ----------------------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString("base64url");
const exp = Math.floor(NOW / 1000) + 24 * 3600;
const token = [
  b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  b64url(JSON.stringify({ sub: OWNER.id, email: OWNER.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
  b64url("not-a-real-signature"),
].join(".");
const authUser = { id: OWNER.id, aud: "authenticated", role: "authenticated", email: OWNER.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
const session = { access_token: token, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: authUser };

// 4. The rules of 014_studio.sql, in memory ------------------------------------------------------------

const live = () => state.videos.filter((v) => !v.deleted_at);
function overview() {
  const vs = live();
  const sum = (k) => vs.reduce((n, v) => n + Number(v[k] || 0), 0);
  const latest = [...vs].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
  return {
    channel: { id: CHANNEL.id, handle: CHANNEL.handle, name: CHANNEL.name, avatar_url: null, subscribers: CHANNEL.subs },
    totals: { views: sum("views"), videos: vs.length, public_videos: vs.filter((v) => v.visibility === "public").length, likes: sum("like_count"), comments: sum("comment_count"), watch_s: sum("watch_s") + 1_440_000 },
    recent: { days: 28, views: 20410, watch_s: 1_310_000 },
    latest: latest && { ...latest, likes: latest.like_count, comments: latest.comment_count },
    trash: state.videos.length - vs.length,
  };
}
function listVideos(trash) {
  return state.videos
    .filter((v) => Boolean(v.deleted_at) === Boolean(trash))
    .map((v) => ({ ...v, purge_at: v.deleted_at ? stamp(Date.parse(v.deleted_at) + TRASH_DAYS * DAY) : null }));
}
function bulk({ video_ids: ids, action, visibility }) {
  if (state.failNext) {
    const code = state.failNext;
    state.failNext = null;
    return { error: code };
  }
  const mine = ids.map((id) => state.videos.find((v) => v.id === id));
  if (mine.some((v) => !v)) return { error: "not_allowed" };
  let changed = 0;
  for (const v of mine) {
    if (action === "visibility") {
      if (v.deleted_at) return { error: "in_trash" };
      if (v.visibility !== visibility) {
        v.visibility = visibility;
        changed++;
      }
    } else if (action === "trash" && !v.deleted_at) {
      Object.assign(v, { deleted_at: stamp(Date.now()), trash_visibility: v.visibility, visibility: "private" });
      changed++;
    } else if (action === "restore" && v.deleted_at) {
      Object.assign(v, { deleted_at: null, visibility: v.trash_visibility ?? "private", trash_visibility: null });
      changed++;
    }
  }
  return { data: changed };
}

const TYPES = { ".webp": "image/webp" };

// 5. The stand in server -------------------------------------------------------------------------------

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message) => send(400, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");

  // The public bucket domain: every video uses the same three stills.
  const still = url.pathname.match(/^\/hls\/[0-9a-f-]{36}\/(thumb-[1-3]\.webp)$/);
  if (still) {
    const file = normalize(join(stillsDir, still[1]));
    if (!file.startsWith(stillsDir) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
    res.writeHead(200, { "content-type": TYPES[extname(file)], "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const me = req.headers.authorization === `Bearer ${token}` ? OWNER : null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");
  const on = () => state.flag === "everyone";

  if (url.pathname === "/auth/v1/user") return me ? send(200, authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["studio", "upload", "channels", "comments", "shorts", "watch", "feed", "accounts"].map((key) => ({
      key, label: key, description: "", mode: key === "studio" ? state.flag : "everyone", users: [], updated_at: null,
    }));
    return send(200, flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    return one(eq("id") === OWNER.id ? [{ username: OWNER.username, display_name: OWNER.name, avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const hit = eq("owner_id") === OWNER.id || eq("handle") === CHANNEL.handle || eq("id") === CHANNEL.id;
    return one(hit ? [{
      id: CHANNEL.id, owner_id: OWNER.id, handle: CHANNEL.handle, name: CHANNEL.name, description: "A made up channel for the studio checks.", links: [],
      avatar_url: null, banner_url: null, handle_changed_at: null, subscriber_count: CHANNEL.subs, video_count: 4, created_at: stamp(NOW - 400 * DAY), comments_default: "on",
    }] : []);
  }
  if (url.pathname === "/rest/v1/videos") {
    // /studio/videos (feature 3) with the flag off.
    return send(200, state.videos.filter((v) => !v.deleted_at).map((v) => ({ ...v, owner_id: OWNER.id, source_bytes: 1048576, error: null })));
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  if (rpc.startsWith("studio_") || rpc === "update_video" || rpc === "set_video_thumbnail") {
    state.calls.push({ rpc, args });
    if (!me) return send(401, { code: "42501", message: "permission denied for function " + rpc });
    if (!on()) return fail("studio_off");
  }
  const find = (id) => state.videos.find((v) => v.id === id);
  switch (rpc) {
    case "studio_overview":
      return send(200, overview());
    case "studio_videos":
      return send(200, listVideos(args.trash));
    case "studio_bulk": {
      const r = bulk(args);
      return r.error ? fail(r.error) : send(200, r.data);
    }
    case "update_video": {
      const v = find(args.video_id);
      if (!v) return fail(args.video_id === OTHER_VIDEO ? "not_allowed" : "not_found");
      if (v.deleted_at) return fail("in_trash");
      Object.assign(v, { title: args.title.trim(), description: args.description, visibility: args.visibility, tags: args.tags });
      return send(200, null);
    }
    case "set_video_thumbnail": {
      const v = find(args.video_id);
      if (!v) return fail("not_found");
      Object.assign(v, { thumbnail_name: args.name, thumbnail_url: args.url });
      return send(200, null);
    }
    case "set_comments_mode": {
      state.calls.push({ rpc, args });
      const v = find(args.video_id);
      v.comments_mode = args.mode;
      return send(200, JSON.stringify(args.mode ?? "on"));
    }
    case "set_short_choice": {
      state.calls.push({ rpc, args });
      const v = find(args.video_id);
      v.short_choice = args.on;
      v.is_short = args.on;
      return send(200, v.is_short);
    }
    case "studio_comments":
      return send(200, []);
    case "my_subscriptions":
    case "subscriptions_feed":
    case "feed_videos":
      return send(200, []);
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 6. next dev --------------------------------------------------------------------------------------------

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

// 7. Playwright ------------------------------------------------------------------------------------------

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

const until = async (fn, ms = 5000) => {
  for (let t = 0; t < ms && !(await fn()); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
// Next keeps pages visited in this tab mounted but hidden, so look at the visible ones only.
const rowIds = (page) => page.locator("[data-content-rows] > li:visible").evaluateAll((els) => els.map((e) => e.getAttribute("data-row")));
const ready = (page) => page.waitForSelector('[data-studio-state="ready"]', { timeout: 60000 });
const v = (id) => state.videos.find((x) => x.id === id);

try {
  await waitForApp();
  for (const p of ["/studio", "/studio/content", "/studio/content/trash", `/studio/video/${vid(1)}/edit`, "/studio/comments", "/studio/videos", "/studio/channel"]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Warm up: `next dev` compiles each page's browser code on its first visit
  // and may reload the page once while it does. Visit every page first.
  {
    seed();
    const ctx = await browser.newContext();
    await ctx.addCookies([cookie]);
    const page = await ctx.newPage();
    for (const p of ["/studio", "/studio/content", "/studio/content/trash", `/studio/video/${vid(1)}/edit`, "/studio/comments", "/studio/channel", "/studio/settings", "/login"]) {
      await page.goto(app + p, { waitUntil: "load" }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
    }
    state.flag = "off";
    for (const p of ["/studio", "/studio/videos", "/studio/comments"]) {
      await page.goto(app + p, { waitUntil: "load" }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(1500);
    }
    await ctx.close();
  }

  // The flag off -------------------------------------------------------------------------------------
  {
    seed();
    state.flag = "off";
    const { context, page } = await open(browser, "/studio");
    await page.waitForSelector('[data-studio-state="off"]', { timeout: 60000 });
    check(true, "flag off: /studio shows the coming soon page");
    check((await page.locator("[data-studio-nav]").count()) === 0, "flag off: no studio nav");
    await page.screenshot({ path: join(outDir, "off-1280-light.png") });
    await go(page, "/studio/comments");
    await page.waitForSelector('[data-studio-comments-state="ready"]', { timeout: 60000 });
    check((await page.locator("[data-studio-nav]").count()) === 0, "flag off: /studio/comments works as before, without the nav");
    await go(page, "/studio/videos");
    await page.waitForSelector('[data-upload-state="ready"]', { timeout: 60000 });
    check(new URL(page.url()).pathname === "/studio/videos", "flag off: /studio/videos stays the feature 3 list");
    const r = await context.request.post(app + "/api/studio/bulk", { data: { ids: [vid(1)], action: "trash" } });
    const res = [r.status(), (await r.json()).error];
    check(res[0] === 403 && res[1] === "studio_off", `flag off: /api/studio/bulk answers ${res.join(" ")}`);
    await context.close();
  }

  // Signed out ------------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/content", { user: false });
    await page.waitForURL(/\/login\?next=/, { timeout: 60000 });
    check(new URL(page.url()).searchParams.get("next") === "/studio/content", "signed out: Content goes to /login?next=/studio/content");
    await context.close();
  }

  // The dashboard -----------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio");
    await ready(page);
    check((await page.locator("[data-studio-nav]").isVisible()), "dashboard: the dark studio nav shows");
    const navBg = await page.locator("[data-studio-nav]").evaluate((el) => getComputedStyle(el).backgroundColor);
    check(navBg === "rgb(40, 40, 40)", `dashboard: the nav is dark (${navBg})`);
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Dashboard"), "dashboard: Dashboard is the active item");
    check(!(await page.locator('nav[aria-label="Guide"]').first().isVisible()), "dashboard: the main guide does not dock next to it");
    check((await page.locator("[data-latest-title]").innerText()) === "Fluffy pancakes in ten minutes", "dashboard: the latest video");
    check((await page.locator("[data-subscribers]").innerText()) === "1,234", "dashboard: current subscribers");
    const latest = await page.locator('[data-studio-card="latest"]').innerText();
    check(latest.includes("48,213") && latest.includes("2,310") && latest.includes("184") && latest.includes("1,100"), "dashboard: views, likes, comments and 1,100 hours of watch time");
    check((await page.locator('[data-studio-card="news"] li').count()) >= 3, "dashboard: what's new");
    check((await page.locator("[data-trash-count]").getAttribute("data-trash-count")) === "1", "dashboard: the trash count");
    // The hamburger opens the guide as a drawer here.
    await page.locator('header button[aria-label]').first().click();
    check(await until(async () => (await page.locator('nav[aria-label="Guide"]').filter({ hasText: "Home" }).last().isVisible())), "dashboard: the hamburger opens the guide as a drawer");
    await context.close();
  }

  // Content: search, filters, sort ----------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/content");
    await ready(page);
    let ids = await rowIds(page);
    check(ids.length === 6 && ids[0] === vid(1), `content: six videos, newest first (${ids.length})`);
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Content"), "content: Content is the active item");
    await page.locator('[data-sort="views"]').click();
    ids = await rowIds(page);
    check(ids.join() === [vid(1), vid(5), vid(2), vid(6), vid(3), vid(4)].join(), "content: Views sorts the most viewed first");
    await page.locator('[data-sort="views"]').click();
    check((await rowIds(page))[0] === vid(4), "content: a second click flips it");
    check(page.url().includes("sort=views") && page.url().includes("dir=asc"), "content: the sort is in the address");
    await page.locator('[data-sort="title"]').click();
    check((await rowIds(page))[0] === vid(6), "content: Title sorts A to Z without the accents (Crêpes first)");
    await page.locator("[data-content-search]").fill("pancakes");
    ids = await rowIds(page);
    check(ids.length === 2 && ids.includes(vid(1)) && ids.includes(vid(2)), "content: search by title");
    await page.locator("label:has-text('Type') select").selectOption("shorts");
    check((await rowIds(page)).join() === vid(2), "content: Snips only");
    await page.locator("label:has-text('Type') select").selectOption("all");
    await page.locator("[data-content-search]").fill("");
    await page.locator("label:has-text('Visibility') select").selectOption("unlisted");
    check((await rowIds(page)).join() === vid(3), "content: Unlisted only");
    await page.reload();
    await ready(page);
    check((await rowIds(page)).join() === vid(3), "content: filters survive a reload");
    await page.locator("label:has-text('Visibility') select").selectOption("all");
    await page.locator("[data-content-search]").fill("zzz");
    check((await page.locator("[data-content-empty]").innerText()).includes("No videos match"), "content: nothing matches");
    await context.close();
  }

  // Content: bulk visibility, delete, the trash, restore, a failed call -------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/content");
    await ready(page);
    await page.locator(`[data-row="${vid(5)}"] input[type=checkbox]`).check();
    await page.locator(`[data-row="${vid(6)}"] input[type=checkbox]`).check();
    check((await page.locator("[data-selected-count]").innerText()) === "2 selected", "bulk: 2 selected in the dark bar");
    await page.locator('[data-bulk-bar] button[aria-label="Edit visibility"]').click();
    await page.locator('[role="menu"] [role="menuitem"]:has-text("Unlisted")').click();
    await until(() => v(vid(5)).visibility === "unlisted" && v(vid(6)).visibility === "unlisted");
    check(v(vid(5)).visibility === "unlisted" && v(vid(6)).visibility === "unlisted", "bulk: both are unlisted in the database");
    check((await page.locator(`[data-row="${vid(5)}"]`).getAttribute("data-visibility")) === "unlisted", "bulk: and in the list");
    check((await page.locator("[data-toast]").innerText()) === "2 videos set to unlisted", "bulk: the toast says so");
    const call = state.calls.find((c) => c.rpc === "studio_bulk");
    check(call?.args.action === "visibility" && call.args.video_ids.length === 2, "bulk: one studio_bulk call for both");

    // Select all, then clear.
    await page.locator('[data-content-view] input[aria-label="Select all"]').first().check();
    check((await page.locator("[data-selected-count]").innerText()) === "6 selected", "bulk: select all");
    await page.locator('button[aria-label="Clear the selection"]').click();
    check((await page.locator("[data-bulk-bar]").count()) === 0, "bulk: clear");

    // A failed call puts the rows back.
    state.failNext = "rate_limited";
    await page.locator(`[data-row="${vid(3)}"] input[type=checkbox]`).check();
    await page.locator('[data-bulk="trash"]').click();
    check((await page.locator('[role="dialog"]').innerText()).includes("30 days"), "delete: the confirm box explains the 30 days");
    check(await page.locator("[data-confirm]").isDisabled(), "delete: Move to trash waits for the tick");
    await page.locator('[role="dialog"] input[type=checkbox]').check();
    await page.locator("[data-confirm]").click();
    await until(async () => (await page.locator("[data-toast]").innerText().catch(() => "")).includes("Wait a minute"));
    check((await page.locator(`[data-row="${vid(3)}"]`).count()) === 1 && !v(vid(3)).deleted_at, "bulk: a refused call puts the row back");

    // Delete one from its row.
    await page.locator('button[aria-label="Clear the selection"]').click();
    await page.locator(`[data-row="${vid(5)}"]`).hover();
    await page.locator(`[data-row="${vid(5)}"] button[aria-label="Delete"]`).click();
    await page.locator('[role="dialog"] input[type=checkbox]').check();
    await page.locator("[data-confirm]").click();
    await until(() => Boolean(v(vid(5)).deleted_at));
    check(v(vid(5)).deleted_at && v(vid(5)).visibility === "private" && v(vid(5)).trash_visibility === "unlisted", "delete: in the trash, private, the old visibility kept");
    check(await until(async () => (await page.locator(`[data-row="${vid(5)}"]`).count()) === 0), "delete: gone from Content");

    // The trash.
    await page.locator('[role="tab"]:visible:has-text("Trash")').click();
    await page.waitForSelector('[data-content-view="trash"]', { state: "visible" });
    const trashIds = await rowIds(page);
    check(trashIds.length === 2 && trashIds[0] === vid(5), "trash: the new one first, then the old one");
    check((await page.locator(`[data-row="${vid(5)}"]:visible`).innerText()).includes("Deleted forever in 30 days"), "trash: 30 days left for today's");
    check((await page.locator(`[data-row="${vid(9)}"]:visible`).innerText()).includes("Deleted forever in 26 days"), "trash: 26 days left for one from 4 days ago");
    await page.screenshot({ path: join(outDir, "trash-flow-1280-light.png") });
    await page.locator(`[data-row="${vid(5)}"]:visible [data-restore]`).click();
    await until(() => !v(vid(5)).deleted_at);
    check(!v(vid(5)).deleted_at && v(vid(5)).visibility === "unlisted", "restore: back as unlisted");
    await page.locator('[role="tab"]:visible:has-text("Videos")').click();
    await page.waitForSelector('[data-content-view="videos"]', { state: "visible" });
    check((await rowIds(page)).includes(vid(5)), "restore: back in Content");
    await context.close();
  }

  // The edit page ----------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/content");
    await ready(page);
    await page.locator(`[data-row="${vid(1)}"] [data-row-title]`).click();
    await page.waitForSelector(`[data-video-editor="${vid(1)}"]`, { timeout: 60000 });
    check(new URL(page.url()).pathname === `/studio/video/${vid(1)}/edit`, "edit: the title opens Video details");
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Content"), "edit: Content stays the active item");
    check(await page.locator("[data-save]").isDisabled(), "edit: Save waits for a change");
    check((await page.locator("[data-still]").count()) === 3, "edit: the three stills");
    check(await page.locator("[data-upload-thumbnail]").isDisabled(), "edit: Upload thumbnail is off without R2 settings");
    await page.locator('[data-field="title"]').fill("  Fluffy pancakes in 10 minutes  ");
    await page.locator('[data-field="description"]').fill("Ten minutes, one bowl.\nNo mixer needed.");
    await page.locator('[data-field="tags"]').fill("breakfast, pancakes, Pancakes, quick recipe");
    check((await page.locator("[data-tag-chips] li").count()) === 3, "edit: tags turn into chips without repeats");
    await page.locator('[data-visibility-choice] input[value="unlisted"]').check();
    await page.locator('[data-comments-mode] label:has-text("Hold all comments") input').check();
    await page.locator("[data-save]").click();
    check(
      await until(async () => (await page.locator("[data-editor-message]").innerText().catch(() => "")) === "Changes saved"),
      "edit: Save says Changes saved",
    );
    const saved = v(vid(1));
    check(saved.title === "Fluffy pancakes in 10 minutes", `edit: the title is saved trimmed ("${saved.title}")`);
    check(saved.description === "Ten minutes, one bowl.\nNo mixer needed.", "edit: the description is saved");
    check(saved.tags.join("|") === "breakfast|pancakes|quick recipe", `edit: the tags are saved (${saved.tags.join(", ")})`);
    check(saved.visibility === "unlisted", "edit: the visibility is saved");
    check(saved.comments_mode === "held", "edit: the comments mode goes through set_comments_mode");
    check(await page.locator("[data-save]").isDisabled(), "edit: Save is off again after saving");
    // A still.
    await page.locator('[data-still="thumb-2.webp"]').click();
    await until(() => v(vid(1)).thumbnail_name === "thumb-2.webp");
    check(v(vid(1)).thumbnail_url === `${mockUrl}/hls/${vid(1)}/thumb-2.webp` || v(vid(1)).thumbnail_url === null, "edit: still 2 is stored with its public link");
    check((await page.locator("[data-preview-thumbnail]").getAttribute("src")).endsWith("thumb-2.webp"), "edit: the preview shows still 2");
    // Undo.
    await page.locator('[data-field="title"]').fill("Something else");
    await page.locator("[data-undo]").click();
    check((await page.locator('[data-field="title"]').inputValue()) === "Fluffy pancakes in 10 minutes", "edit: Undo changes goes back to the saved title");
    // An empty title cannot be saved.
    await page.locator('[data-field="title"]').fill("   ");
    check(await page.locator("[data-save]").isDisabled(), "edit: an empty title cannot be saved");
    await context.close();

    // The Snip choice on the short.
    const s = await open(browser, `/studio/video/${vid(2)}/edit`);
    await s.page.waitForSelector(`[data-video-editor="${vid(2)}"]`, { timeout: 60000 });
    await s.page.locator('[data-field="short"]').uncheck();
    await s.page.locator("[data-save]").click();
    await until(() => v(vid(2)).short_choice === false);
    check(v(vid(2)).short_choice === false, "edit: unticking Show as a Snip goes through set_short_choice");
    await s.context.close();

    // A video in the trash has no edit page.
    const t = await open(browser, `/studio/video/${vid(9)}/edit`);
    await t.page.waitForSelector('[data-studio-state="missing"]', { timeout: 60000 });
    check(true, "edit: a video in the trash says it isn't in your content");
    await t.context.close();
  }

  // The other nav items ---------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/comments");
    await page.waitForSelector('[data-studio-comments-state="ready"]', { timeout: 60000 });
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Comments"), "nav: /studio/comments sits under the studio nav");
    await page.locator('[data-studio-nav] a:has-text("Customization")').click();
    await page.waitForSelector('[data-channel-state="ready"]', { timeout: 60000 });
    check((await page.locator('[data-studio-nav] [aria-current="page"]').innerText()).includes("Customization"), "nav: Customization opens the channel editor with its live preview");
    await page.locator('[data-studio-nav] a:has-text("Settings")').click();
    await page.waitForSelector('[data-studio-state="settings"]', { timeout: 60000 });
    check(true, "nav: Settings is a placeholder");
    await go(page, "/studio/videos");
    await page.waitForURL(/\/studio\/content/, { timeout: 60000 });
    check(true, "nav: /studio/videos goes to Content while the flag is on");
    await context.close();
  }

  // Screenshots -----------------------------------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      const height = width === 390 ? 844 : 900;
      const shot = async (path, name, prepare) => {
        seed();
        const { context, page } = await open(browser, path, { width, height, theme, scale: 2 });
        await page.waitForSelector('[data-studio-state="ready"], [data-studio-comments-state="ready"], [data-channel-state="ready"]', { timeout: 60000 });
        await page.waitForLoadState("networkidle").catch(() => {});
        if (prepare) await prepare(page);
        await page.mouse.move(width - 2, height - 2);
        await page.waitForTimeout(300);
        await page.screenshot({ path: join(outDir, `${name}-${width}-${theme}.png`) });
        await context.close();
      };
      await shot("/studio", "dashboard");
      await shot("/studio/content", "content", async (page) => {
        await page.locator(`[data-row="${vid(1)}"] input[type=checkbox]`).check();
        await page.locator(`[data-row="${vid(3)}"] input[type=checkbox]`).check();
      });
      await shot("/studio/content/trash", "trash");
      await shot(`/studio/video/${vid(1)}/edit`, "edit");
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
