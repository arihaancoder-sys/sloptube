#!/usr/bin/env node
// Checks and screenshots of subscriptions, without a real database or R2.
//
//   node scripts/subscriptions-shots.mjs [out-dir]   (default: shots/subscriptions)
//
// 1. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    viewer, ten made up channels with uploads from today, this week and
//    older, and keeps the viewer's subscriptions in memory, so subscribe,
//    unsubscribe and the bell behave like the real functions in
//    009_subscriptions.sql (counts, own channel, the notify list).
// 2. Starts `next dev` pointed at it.
// 3. With Playwright: signed out, SUBSCRIBE sends you to sign in and the
//    subscriptions page asks you to sign in. Signed in (a session cookie for
//    the made up viewer): subscribe and unsubscribe on a watch page with the
//    count moving at once (the mock answers slowly on purpose), a failed
//    change going back, the bell, the guide list with SHOW MORE and the new
//    upload dot, the subscriptions feed with its sections, and the
//    notifications menu with its unread badge. Then screenshots at 1280 and
//    390, light and dark.
//
// Made up names and titles, no real data. Nothing here touches the network.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/subscriptions"));
const APP_PORT = Number(process.env.APP_PORT ?? 3459);

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

// 1. Made up people, channels and videos ---------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const VIEWER = { id: "a0000000-0000-4000-8000-000000000001", email: "viewer@example.com", username: "viewer" };
const VIEWER_CHANNEL = { id: "c0000000-0000-4000-8000-0000000000aa", handle: "viewer", name: "Viewer", owner: VIEWER.id, subs: 0 };

const NAMES = [
  ["samplekitchen", "Sample Kitchen"],
  ["desklab", "Desk Setup Lab"],
  ["trailnotes", "Trail Notes"],
  ["pixelgarden", "Pixel Garden"],
  ["breadclub", "Bread Club"],
  ["tinyrobots", "Tiny Robots"],
  ["nightsky", "Night Sky Diary"],
  ["papercraft", "Paper Craft Corner"],
  ["synthshed", "Synth Shed"],
  ["moss", "Moss and Stones"],
];
const CHANNELS = NAMES.map(([handle, name], i) => ({
  id: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  handle,
  name,
  owner: `b0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  subs: [41, 1234, 999, 87_000, 5, 12, 250_000, 3, 64, 1][i],
}));
const ALL_CHANNELS = [...CHANNELS, VIEWER_CHANNEL];

// Hours ago for each channel's uploads: today, this week and older, so the
// feed has all three sections and some channels get the guide dot.
const UPLOADS = [[1, 30, 200], [2, 50], [4, 400], [90], [26, 500], [3], [700], [1000, 2000], [8], [20]];
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
const VIDEOS = [];
CHANNELS.forEach((ch, i) =>
  UPLOADS[i].forEach((hours, j) => {
    const id = uuid(VIDEOS.length + 1);
    VIDEOS.push({
      id,
      title: j === 0 ? TITLES[i] : `${TITLES[i]} (part ${j + 1})`,
      duration_s: 300 + i * 61 + j * 17,
      thumbnail_url: null,
      hls_key: `hls/${id}/master.m3u8`,
      preview_sprite_key: null,
      published_at: new Date(NOW - hours * HOUR).toISOString().replace("Z", "123+00:00"),
      views: 1000 * (i + 1) + j,
      channel_id: ch.id,
      channel_handle: ch.handle,
      channel_name: ch.name,
      channel_avatar_url: null,
      design: i,
    });
  }),
);
const byNewest = [...VIDEOS].sort((a, b) => (a.published_at < b.published_at ? 1 : -1));
const card = ({ design, ...v }) => (void design, v);

// The viewer's subscriptions: channel id to notify. Reset per scenario.
let SUBS = new Map();
function resetSubs(entries = []) {
  for (const ch of CHANNELS) ch.subs = ch.baseSubs ??= ch.subs;
  SUBS = new Map();
  for (const [id, notify] of entries) {
    SUBS.set(id, notify);
    ALL_CHANNELS.find((c) => c.id === id).subs++;
  }
}

function subscriptionsFeed({ cursor = null, cursor_id = null, lim = 24, only_notify = false }) {
  let rows = byNewest.filter((v) => SUBS.has(v.channel_id) && (!only_notify || SUBS.get(v.channel_id)));
  if (cursor) {
    const t = Date.parse(cursor);
    rows = rows.filter((v) => Date.parse(v.published_at) < t || (Date.parse(v.published_at) === t && v.id < cursor_id));
  }
  return rows.slice(0, Math.min(Math.max(lim, 1), 50)).map(card);
}

function mySubscriptions() {
  return [...SUBS.entries()]
    .map(([id, notify]) => {
      const c = ALL_CHANNELS.find((x) => x.id === id);
      const latest = byNewest.find((v) => v.channel_id === id)?.published_at ?? null;
      return { channel_id: c.id, handle: c.handle, name: c.name, avatar_url: null, notify, subscribed_at: new Date(NOW).toISOString(), latest_upload_at: latest, unseen: 0 };
    })
    .sort((a, b) => (b.latest_upload_at ?? "").localeCompare(a.latest_upload_at ?? "") || a.name.localeCompare(b.name));
}

const channelRow = (c) => ({
  id: c.id,
  owner_id: c.owner,
  handle: c.handle,
  name: c.name,
  description: "A made up channel for the subscription checks.",
  links: [],
  avatar_url: null,
  banner_url: null,
  handle_changed_at: null,
  subscriber_count: c.subs,
  video_count: VIDEOS.filter((v) => v.channel_id === c.id).length,
  created_at: new Date(NOW - 400 * 24 * HOUR).toISOString(),
});

// 2. Session cookie for the made up viewer ------------------------------------------------

const b64url = (s) => Buffer.from(s).toString("base64url");
const exp = Math.floor(NOW / 1000) + 24 * 3600;
const ACCESS_TOKEN = [
  b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
  b64url(JSON.stringify({ sub: VIEWER.id, email: VIEWER.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
  b64url("not-a-real-signature"),
].join(".");
const AUTH_USER = { id: VIEWER.id, aud: "authenticated", role: "authenticated", email: VIEWER.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
const SESSION = { access_token: ACCESS_TOKEN, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: AUTH_USER };

// 3. The stand in server -------------------------------------------------------------------

const FLAGS = ["subscriptions", "watch", "channels", "feed", "accounts"].map((key) => ({
  key,
  label: key,
  description: "",
  mode: "everyone",
  users: [],
  updated_at: null,
}));
const control = { delay: 0, failNext: null, changes: [] };

function thumbSvg(v) {
  const h = (v.design * 47) % 360;
  const words = v.title.split(" ").slice(0, 3).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,30%)"/></linearGradient></defs><rect width="640" height="360" fill="url(#g)"/><circle cx="${160 + v.design * 30}" cy="170" r="90" fill="rgba(255,255,255,0.18)"/><text x="40" y="300" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#fff">${words}</text></svg>`;
}

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  if (req.method === "OPTIONS") return send(204, "", "text/plain");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const signedIn = (req.headers.authorization ?? "") === `Bearer ${ACCESS_TOKEN}`;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");

  if (url.pathname === "/auth/v1/user") return signedIn ? send(200, AUTH_USER) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") return send(200, FLAGS);
  if (url.pathname === "/rest/v1/profiles") {
    return one(eq("id") === VIEWER.id ? [{ username: VIEWER.username, display_name: "Viewer", avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const owner = eq("owner_id");
    const handle = eq("handle");
    const id = eq("id");
    return one(ALL_CHANNELS.filter((c) => (owner && c.owner === owner) || (handle && c.handle === handle) || (id && c.id === id)).map(channelRow));
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  if (["subscribe", "unsubscribe", "set_notify"].includes(rpc)) {
    if (!signedIn) return send(401, { code: "42501", message: "permission denied for function " + rpc });
    if (control.delay) await new Promise((r) => setTimeout(r, control.delay));
    control.changes.push(rpc);
    if (control.failNext) {
      const message = control.failNext;
      control.failNext = null;
      return send(400, { code: "P0001", message });
    }
    const ch = ALL_CHANNELS.find((c) => c.id === args.channel_id);
    if (!ch) return send(400, { code: "P0001", message: "not_found" });
    if (ch.owner === VIEWER.id) return send(400, { code: "P0001", message: "own_channel" });
    if (rpc === "subscribe" && !SUBS.has(ch.id)) {
      SUBS.set(ch.id, true);
      ch.subs++;
    }
    if (rpc === "unsubscribe" && SUBS.has(ch.id)) {
      SUBS.delete(ch.id);
      ch.subs--;
    }
    if (rpc === "set_notify") {
      if (!SUBS.has(ch.id)) return send(400, { code: "P0001", message: "not_subscribed" });
      SUBS.set(ch.id, args.on);
    }
    return send(200, [{ subscribed: SUBS.has(ch.id), notify: SUBS.get(ch.id) ?? false, subscriber_count: ch.subs }]);
  }
  if (rpc === "my_subscriptions") return send(200, signedIn ? mySubscriptions() : []);
  if (rpc === "subscriptions_feed") return send(200, signedIn ? subscriptionsFeed(args) : []);
  if (rpc === "feed_videos") {
    const rows = args.kind === "channel" ? byNewest.filter((v) => v.channel_id === args.for_channel) : byNewest;
    return send(200, rows.slice(0, args.lim ?? 24).map((v) => ({ ...card(v), score: 0 })));
  }
  if (rpc === "related_videos") return send(200, byNewest.filter((v) => v.id !== args.video_id).slice(0, 8).map(card));
  if (rpc === "watch_video") {
    const v = VIDEOS.find((x) => x.id === args.video_id);
    if (!v) return send(200, []);
    const ch = ALL_CHANNELS.find((c) => c.id === v.channel_id);
    return send(200, [
      {
        ...card(v),
        description: "A made up video for the subscription checks.",
        visibility: "public",
        status: "ready",
        is_owner: false,
        created_at: v.published_at,
        width: 1280,
        height: 720,
        renditions: [{ name: "720p", width: 1280, height: 720 }],
        channel_subscriber_count: ch.subs,
      },
    ]);
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);

  const m = /^\/hls\/([0-9a-f-]{36})\/thumb-1\.webp$/.exec(url.pathname);
  const v = m && VIDEOS.find((x) => x.id === m[1]);
  if (v) return send(200, thumbSvg(v), "image/svg+xml");
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 4. next dev --------------------------------------------------------------------------------

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

// 5. Playwright ---------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const COOKIE = { name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSION)), domain: "localhost", path: "/" };

async function open(browser, path, { width = 1280, height = 900, theme = "light", scale = 1, signedIn = true, seen = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (signedIn) await context.addCookies([COOKIE]);
  await context.addInitScript(
    ([t, s]) => {
      try {
        localStorage.setItem("sloptube-theme", t);
        if (s !== null && !sessionStorage.getItem("seeded")) {
          localStorage.setItem("sloptube-notifications-seen", String(s));
          sessionStorage.setItem("seeded", "1");
        }
      } catch {}
    },
    [theme, seen],
  );
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

const watchOf = (ch) => `/watch?v=${VIDEOS.find((v) => v.channel_id === ch.id).id}`;
const countText = (page) => page.locator("[data-sub-count]").first().innerText();
const imagesLoaded = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("main img")]
      .filter((img) => img.getBoundingClientRect().top < innerHeight)
      .every((img) => img.complete && img.naturalWidth > 0),
  );
/** Opens the guide drawer (below 1313 px the full guide is a drawer). */
async function openDrawer(page) {
  await page.getByRole("button", { name: "Guide" }).click();
  await page.waitForSelector(".fixed [data-guide-subs]", { timeout: 10000 });
}

try {
  await waitForApp();
  for (const p of ["/", "/feed/subscriptions", watchOf(CHANNELS[0]), `/@${CHANNELS[0].handle}`]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Signed out ----------------------------------------------------------------------------
  {
    resetSubs();
    const { context, page } = await open(browser, watchOf(CHANNELS[0]), { signedIn: false });
    const btn = page.locator('[data-subscribe="signed-out"]');
    await btn.waitFor({ timeout: 30000 });
    check((await page.locator("[data-guide-subs]").count()) === 0, "signed out: no Subscriptions list in the guide");
    await btn.click();
    await page.waitForURL(/\/login\?next=/, { timeout: 15000 });
    const next = new URL(page.url()).searchParams.get("next");
    check(next === watchOf(CHANNELS[0]), `signed out: SUBSCRIBE goes to /login?next=${next}`);
    await page.goto(app + "/feed/subscriptions");
    await page.waitForSelector('[data-subs-state="signed-out"]', { timeout: 30000 });
    check((await page.getByText("Don't miss new videos").count()) === 1, 'signed out feed: "Don\'t miss new videos"');
    check((await page.getByText("Sign in to see updates from channels you subscribe to.").count()) === 1, "signed out feed: the sign in line");
    check((await page.locator('[data-subs-state="signed-out"] a', { hasText: "Sign in" }).count()) === 1, "signed out feed: Sign in button");
    await page.screenshot({ path: join(outDir, "feed-signed-out-1280-light.png") });
    await context.close();
  }

  // Subscribe and unsubscribe on a watch page, with the count moving at once.
  {
    resetSubs();
    const ch = CHANNELS[0]; // 41 subscribers
    const { context, page } = await open(browser, watchOf(ch));
    const sub = page.locator('[data-subscribe="no"]');
    await sub.waitFor({ timeout: 30000 });
    check((await countText(page)) === "41 subscribers", `watch: count starts at "${await countText(page)}"`);
    check((await page.locator("[data-guide-channel]").count()) === 0, "guide list starts empty");
    control.delay = 1200;
    await sub.click();
    await page.waitForSelector('[data-subscribe="yes"]', { timeout: 300 });
    check(true, "SUBSCRIBED shows before the server answers");
    check((await countText(page)) === "42 subscribers", "count moves to 42 at once");
    check(!SUBS.has(ch.id), "the server has not answered yet");
    const bg = await page.locator('[data-subscribe="yes"]').evaluate((el) => getComputedStyle(el).backgroundColor);
    check(bg === "rgb(236, 236, 236)", `SUBSCRIBED is grey (${bg})`);
    check((await page.locator('[data-sub-bell="on"]').count()) === 1, "the bell is there, filled (notifications on)");
    await page.waitForSelector(`[data-guide-channel="${ch.handle}"]`, { state: "attached", timeout: 10000 });
    check(SUBS.get(ch.id) === true, "server: subscribed with notify on");
    check(true, "guide list picks up the new channel");
    check((await page.locator("[data-sub-toast]").innerText()).includes("Subscription added"), "toast: Subscription added");

    // The bell.
    await page.locator("[data-sub-bell]").click();
    check((await page.locator('[data-sub-bell="off"]').count()) === 1, "bell click: outlined at once");
    await page.waitForFunction(() => true);
    for (let i = 0; i < 30 && SUBS.get(ch.id) !== false; i++) await page.waitForTimeout(100);
    check(SUBS.get(ch.id) === false, "server: notify off");
    await page.locator("[data-sub-bell]").click();
    for (let i = 0; i < 30 && SUBS.get(ch.id) !== true; i++) await page.waitForTimeout(100);
    check(SUBS.get(ch.id) === true && (await page.locator('[data-sub-bell="on"]').count()) === 1, "bell back on");
    await page.screenshot({ path: join(outDir, "watch-subscribed-1280-light.png"), clip: { x: 0, y: 56, width: 1280, height: 844 } });

    // Unsubscribe.
    control.changes.length = 0;
    await page.locator('[data-subscribe="yes"]').click();
    await page.waitForSelector('[data-subscribe="no"]', { timeout: 300 });
    check((await countText(page)) === "41 subscribers", "unsubscribe: back to 41 at once");
    for (let i = 0; i < 40 && SUBS.has(ch.id); i++) await page.waitForTimeout(100);
    check(!SUBS.has(ch.id), "server: unsubscribed");
    await page.waitForSelector(`[data-guide-channel="${ch.handle}"]`, { state: "detached", timeout: 10000 });
    check(true, "guide list drops the channel");

    // Fast double click: ends subscribed, one request at a time.
    control.changes.length = 0;
    await page.locator('[data-subscribe="no"]').click();
    await page.locator('[data-subscribe="yes"]').click();
    await page.locator('[data-subscribe="no"]').click();
    for (let i = 0; i < 60 && (control.changes.length < 3 || !SUBS.has(ch.id)); i++) await page.waitForTimeout(100);
    check(SUBS.has(ch.id) && (await page.locator('[data-subscribe="yes"]').count()) === 1, `three fast clicks end subscribed (${control.changes.join(", ")})`);
    check((await countText(page)) === "42 subscribers", "count matches after the fast clicks");

    // A failed change goes back and says why.
    control.delay = 300;
    control.failNext = "rate_limited";
    await page.locator('[data-subscribe="yes"]').click();
    await page.waitForSelector('[data-subscribe="no"]', { timeout: 300 });
    await page.waitForSelector('[data-subscribe="yes"]', { timeout: 5000 });
    check((await countText(page)) === "42 subscribers", "rate limited: back to SUBSCRIBED and 42");
    check((await page.locator("[data-sub-toast]").innerText()).includes("very fast"), "rate limited: the toast explains");
    control.delay = 0;
    await context.close();
  }

  // The channel header, and no button for your own channel.
  {
    resetSubs([[CHANNELS[1].id, true]]);
    const { context, page } = await open(browser, `/@${CHANNELS[1].handle}`);
    await page.waitForSelector('[data-subscribe="yes"]', { timeout: 30000 });
    check((await countText(page)) === "1.2K subscribers", "channel header: SUBSCRIBED and 1.2K subscribers");
    await page.locator('[data-subscribe="yes"]').click();
    await page.waitForSelector('[data-subscribe="no"]', { timeout: 300 });
    for (let i = 0; i < 30 && SUBS.size; i++) await page.waitForTimeout(100);
    check(!SUBS.size, "channel header: unsubscribed");
    await page.goto(app + "/@viewer");
    await page.waitForSelector('[data-channel-state="ready"]', { timeout: 30000 });
    check((await page.locator("[data-subscribe]").count()) === 0, "own channel: Customize channel, no Subscribe");
    await context.close();
  }

  // Guide list: seven, then SHOW MORE, with the dot for uploads this week.
  {
    resetSubs(CHANNELS.slice(0, 9).map((c, i) => [c.id, i % 3 !== 2]));
    const { context, page } = await open(browser, "/", { width: 1400 });
    await page.waitForSelector('nav [data-guide-subs="ready"]', { timeout: 30000 });
    const nav = page.locator("nav.wide\\:block, nav:has([data-guide-subs])").first();
    check((await nav.locator("[data-guide-channel]").count()) === 7, "guide: 7 channels before SHOW MORE");
    check((await nav.locator("[data-guide-more]").innerText()).trim().toUpperCase() === "SHOW 2 MORE", "guide: SHOW 2 MORE");
    const want = mySubscriptions().filter((s) => NOW - Date.parse(s.latest_upload_at) < 7 * 24 * HOUR).length;
    await nav.locator("[data-guide-more]").click();
    check((await nav.locator("[data-guide-channel]").count()) === 9, "guide: all 9 after SHOW MORE");
    check((await nav.locator("[data-guide-new]").count()) === want, `guide: ${want} channels with the new upload dot`);
    const order = await nav.locator("[data-guide-channel]").evaluateAll((els) => els.map((e) => e.getAttribute("data-guide-channel")));
    check(JSON.stringify(order) === JSON.stringify(mySubscriptions().map((s) => s.handle)), "guide: newest upload first");
    await page.screenshot({ path: join(outDir, "guide-1400-light.png"), clip: { x: 0, y: 56, width: 240, height: 844 } });
    await context.close();
  }

  // The subscriptions feed: Today, This week, Older.
  {
    resetSubs(CHANNELS.map((c, i) => [c.id, i % 3 !== 2]));
    const { context, page } = await open(browser, "/feed/subscriptions");
    await page.waitForSelector('[data-subs-state="ready"]', { timeout: 30000 });
    const sections = await page.locator("[data-feed-section]").evaluateAll((els) =>
      els.map((e) => [e.getAttribute("data-feed-section"), e.querySelector("h2")?.textContent, e.querySelectorAll("[data-feed-card]").length]),
    );
    const tz = await page.evaluate(() => new Date().getTimezoneOffset());
    const day = (ms) => Math.floor((ms - tz * 60000) / (24 * HOUR));
    const expect = { today: 0, week: 0, older: 0 };
    for (const v of byNewest) {
      const d = day(NOW) - day(Date.parse(v.published_at));
      expect[d <= 0 ? "today" : d < 7 ? "week" : "older"]++;
    }
    check(
      JSON.stringify(sections) === JSON.stringify([["today", "Today", expect.today], ["week", "This week", expect.week], ["older", "Older", expect.older]]),
      `feed sections ${JSON.stringify(sections)}`,
    );
    const ids = await page.locator("[data-feed-card]").evaluateAll((els) => els.map((e) => e.getAttribute("data-feed-card")));
    check(JSON.stringify(ids) === JSON.stringify(byNewest.map((v) => v.id)), "feed: every upload, newest first");
    await context.close();
  }

  // Notifications: badge, the list of bell on channels, cleared when opened.
  {
    resetSubs(CHANNELS.map((c, i) => [c.id, i % 3 !== 2]));
    const notify = subscriptionsFeed({ only_notify: true, lim: 20 });
    const seen = NOW - 10 * HOUR;
    const unread = notify.filter((v) => Date.parse(v.published_at) > seen).length;
    const { context, page } = await open(browser, "/", { seen });
    await page.waitForSelector("[data-bell-badge]", { timeout: 30000 });
    const badge = await page.locator("[data-bell-badge]").innerText();
    check(badge === String(unread), `bell badge shows ${badge} (want ${unread})`);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.waitForSelector(`[data-notifications="${notify.length}"]`, { timeout: 10000 });
    check(true, `menu lists ${notify.length} uploads from channels with the bell on`);
    const ids = await page.locator("[data-notification]").evaluateAll((els) => els.map((e) => e.getAttribute("data-notification")));
    check(JSON.stringify(ids) === JSON.stringify(notify.map((v) => v.id)), "menu: newest first, bell on channels only");
    check((await page.locator("[data-notification][data-unread]").count()) === unread, "menu: new uploads marked");
    check((await page.locator("[data-bell-badge]").count()) === 0, "badge clears when the menu opens");
    await imagesLoaded(page).catch(() => {});
    await page.screenshot({ path: join(outDir, "bell-1280-light.png") });
    await page.keyboard.press("Escape");
    await page.reload();
    await page.waitForSelector('[data-guide-subs="ready"]', { state: "attached", timeout: 30000 });
    await page.waitForTimeout(1000);
    check((await page.locator("[data-bell-badge]").count()) === 0, "badge stays cleared after a reload");
    await context.close();
  }

  // Screenshots at 1280 and 390, light and dark.
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      resetSubs(CHANNELS.map((c, i) => [c.id, i % 3 !== 2]));
      const opts = { width, height, theme, scale: 2, seen: NOW - 10 * HOUR };
      {
        const { context, page } = await open(browser, "/feed/subscriptions", opts);
        await page.waitForSelector('[data-subs-state="ready"]', { timeout: 30000 });
        await imagesLoaded(page);
        await page.screenshot({ path: join(outDir, `feed-${width}-${theme}.png`) });
        console.log(`shot  feed-${width}-${theme}.png`);
        await openDrawer(page);
        await page.screenshot({ path: join(outDir, `guide-${width}-${theme}.png`) });
        console.log(`shot  guide-${width}-${theme}.png`);
        await context.close();
      }
      {
        resetSubs(CHANNELS.slice(1).map((c) => [c.id, true]));
        const { context, page } = await open(browser, watchOf(CHANNELS[0]), opts);
        await page.locator('[data-subscribe="no"]').click();
        await page.waitForSelector('[data-sub-bell="on"]');
        await page.waitForTimeout(500);
        await page.evaluate(() => document.querySelector("[data-sub-bell]").scrollIntoView({ block: "center" }));
        await page.screenshot({ path: join(outDir, `watch-${width}-${theme}.png`) });
        console.log(`shot  watch-${width}-${theme}.png`);
        if (width === 1280) {
          await page.getByRole("button", { name: /^Notifications/ }).click();
          await page.waitForSelector("[data-notification]");
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.waitForTimeout(300);
          await page.screenshot({ path: join(outDir, `bell-${width}-${theme}.png`) });
          console.log(`shot  bell-${width}-${theme}.png`);
        }
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
console.log(`\nall subscription checks passed, screenshots in ${outDir}`);
