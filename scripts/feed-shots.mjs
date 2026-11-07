#!/usr/bin/env node
// Screenshots and checks of the home feed, without a real database or R2.
//
//   node scripts/feed-shots.mjs [out-dir]      (default: shots/feed)
//
// 1. Starts a tiny local server that stands in for two things:
//    - Supabase's REST API: the feature_flags table (feed, watch and channels
//      on) and the feed_videos, related_videos and watch_video functions,
//      answered from a dozen made up videos (repeated three times, so there is
//      a second page for infinite scroll).
//    - The public bucket domain (MEDIA_PUBLIC_URL): a generated thumbnail and
//      a generated preview sprite with its .vtt for every video.
// 2. Starts `next dev` pointed at it.
// 3. With Playwright: checks columns at 390, 1280 and 1800, the hover preview
//    (starts after a second, steps through frames, loads no video), infinite
//    scroll with its skeleton row, /trending numbering, and that an Up next
//    card on /watch navigates without a full reload. Then screenshots of / at
//    1280 and 390, light and dark.
//
// Made up titles and channels, no real data. Nothing here touches the network.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/feed"));
const APP_PORT = Number(process.env.APP_PORT ?? 3458);

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

// 1. The made up videos ---------------------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const CHANNELS = [
  { id: "c0000000-0000-4000-8000-000000000001", handle: "samplekitchen", name: "Sample Kitchen" },
  { id: "c0000000-0000-4000-8000-000000000002", handle: "desklab", name: "Desk Setup Lab" },
  { id: "c0000000-0000-4000-8000-000000000003", handle: "trailnotes", name: "Trail Notes" },
  { id: "c0000000-0000-4000-8000-000000000004", handle: "pixelgarden", name: "Pixel Garden" },
];
const DESIGNS = [
  ["Fluffy pancakes in ten minutes, no mixer needed", 612, 1234, 5],
  ["My 2026 desk setup tour", 845, 3_456_789, 30],
  ["Sunrise hike to the old fire lookout", 1520, 87_000, 50],
  ["Growing a pixel art garden, one tile a day for a whole year", 2710, 999, 72],
  ["Why every cast iron pan needs this one step", 431, 48_200, 100],
  ["Cable management that actually lasts", 1203, 12_345, 130],
  ["Packing light: three days with one small bag", 905, 1_200_000, 170],
  ["Drawing a tiny lighthouse at 16 by 16 pixels", 367, 5_400, 220],
  ["Bread with four ingredients", 1832, 250_000, 300],
  ["Keyboard sound test: six switches compared side by side", 640, 76_000, 420],
  ["Night sky timelapse from the ridge", 128, 1, 600],
  ["Animating a walking cat in twelve frames", 3725, 410_000, 900],
];
const uuid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VIDEOS = [];
for (let round = 0; round < 3; round++) {
  DESIGNS.forEach(([title, duration, views, hours], i) => {
    const n = round * DESIGNS.length + i;
    const id = uuid(n + 1);
    const ch = CHANNELS[i % CHANNELS.length];
    VIDEOS.push({
      id,
      title: round === 0 ? title : `${title} (part ${round + 1})`,
      duration_s: duration,
      thumbnail_url: null,
      hls_key: `hls/${id}/master.m3u8`,
      preview_sprite_key: `hls/${id}/sprite.vtt`,
      // Postgres style, with microseconds, so the cursor keeps them.
      published_at: new Date(NOW - (hours + round * 1000) * HOUR).toISOString().replace("Z", "123+00:00"),
      views: round === 0 ? views : Math.floor(views / (round + 3)),
      channel_id: ch.id,
      channel_handle: ch.handle,
      channel_name: ch.name,
      channel_avatar_url: null,
      design: i,
    });
  });
}
const byNewest = [...VIDEOS].sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : b.id.localeCompare(a.id)));
const score = (v) => v.views / Math.pow(Math.max((NOW - Date.parse(v.published_at)) / HOUR, 1), 1.5);
const card = ({ design, ...v }) => (void design, v);

function feedVideos({ kind = "newest", cursor = null, cursor_id = null, lim = 24, for_channel = null }) {
  const n = Math.min(Math.max(lim, 1), 50);
  if (kind === "trending") {
    return VIDEOS.filter((v) => NOW - Date.parse(v.published_at) < 30 * 24 * HOUR)
      .sort((a, b) => score(b) - score(a))
      .slice(0, n)
      .map((v) => ({ ...card(v), score: score(v) }));
  }
  let rows = byNewest.filter((v) => kind === "newest" || (kind === "channel" && v.channel_id === for_channel));
  if (cursor) {
    const t = Date.parse(cursor);
    rows = rows.filter((v) => Date.parse(v.published_at) < t || (Date.parse(v.published_at) === t && v.id < cursor_id));
  }
  return rows.slice(0, n).map((v) => ({ ...card(v), score: 0 }));
}

// 2. Generated pictures -----------------------------------------------------------------

const hue = (i) => (i * 47) % 360;
function thumbSvg(v) {
  const h = hue(v.design);
  const words = v.title.split(" ").slice(0, 4).join(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},70%,55%)"/><stop offset="1" stop-color="hsl(${(h + 60) % 360},70%,30%)"/></linearGradient></defs>
<rect width="640" height="360" fill="url(#g)"/>
<circle cx="${140 + v.design * 30}" cy="180" r="90" fill="rgba(255,255,255,0.18)"/>
<rect x="380" y="70" width="180" height="220" rx="16" fill="rgba(0,0,0,0.15)"/>
<text x="40" y="300" font-family="Arial, sans-serif" font-size="40" font-weight="700" fill="#fff">${words}</text>
</svg>`;
}
// A 10 x 2 sheet of 160 x 90 tiles, like the encoder makes: a dot that moves
// along the frame and the frame number, so the preview visibly steps.
const TILES = 20;
function spriteSvg(v) {
  const h = hue(v.design);
  let tiles = "";
  for (let i = 0; i < TILES; i++) {
    const x = (i % 10) * 160;
    const y = Math.floor(i / 10) * 90;
    tiles += `<g transform="translate(${x},${y})"><rect width="160" height="90" fill="hsl(${(h + i * 9) % 360},65%,${35 + (i % 5) * 4}%)"/>
<circle cx="${12 + i * 7}" cy="45" r="14" fill="#fff"/><text x="150" y="80" text-anchor="end" font-family="Arial" font-size="22" font-weight="700" fill="#fff">${i + 1}</text></g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="180" viewBox="0 0 1600 180">${tiles}</svg>`;
}
function spriteVtt(v) {
  const t = (s) => `00:${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}.000`;
  const step = Math.max(1, Math.floor(v.duration_s / TILES));
  const lines = ["WEBVTT", ""];
  for (let i = 0; i < TILES; i++) {
    lines.push(`${t(i * step)} --> ${t((i + 1) * step)}`, `sprite.webp#xywh=${(i % 10) * 160},${Math.floor(i / 10) * 90},160,90`, "");
  }
  return lines.join("\n");
}

// 3. The stand in server ----------------------------------------------------------------

const FLAGS = ["feed", "watch", "channels"].map((key) => ({
  key,
  label: key,
  description: "",
  mode: "everyone",
  users: [],
  updated_at: null,
}));
const mediaRequests = [];
let pageTwoDelay = 0;

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, type, body) => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(body);
  };
  if (req.method === "OPTIONS") return send(204, "text/plain", "");
  let body = "";
  for await (const chunk of req) body += chunk;
  const args = body ? JSON.parse(body) : {};

  if (url.pathname === "/rest/v1/feature_flags") return send(200, "application/json", JSON.stringify(FLAGS));
  if (url.pathname === "/rest/v1/rpc/feed_videos") {
    if (args.cursor && pageTwoDelay) await new Promise((r) => setTimeout(r, pageTwoDelay));
    return send(200, "application/json", JSON.stringify(feedVideos(args)));
  }
  if (url.pathname === "/rest/v1/rpc/related_videos") {
    const me = VIDEOS.find((v) => v.id === args.video_id);
    const rows = byNewest
      .filter((v) => v.id !== args.video_id)
      .sort((a, b) => Number(b.channel_id === me?.channel_id) - Number(a.channel_id === me?.channel_id));
    return send(200, "application/json", JSON.stringify(rows.slice(0, args.lim ?? 12).map(card)));
  }
  if (url.pathname === "/rest/v1/rpc/watch_video") {
    const v = VIDEOS.find((x) => x.id === args.video_id);
    if (!v) return send(200, "application/json", "[]");
    return send(
      200,
      "application/json",
      JSON.stringify([
        {
          ...card(v),
          description: "A made up video for the feed checks.",
          visibility: "public",
          status: "ready",
          is_owner: false,
          created_at: v.published_at,
          width: 1280,
          height: 720,
          renditions: [{ name: "720p", width: 1280, height: 720 }],
          channel_subscriber_count: 1234,
        },
      ]),
    );
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, "application/json", "[]");

  const m = /^\/hls\/([0-9a-f-]{36})\/(.+)$/.exec(url.pathname);
  const v = m && VIDEOS.find((x) => x.id === m[1]);
  if (v) {
    mediaRequests.push(m[2]);
    if (m[2] === "thumb-1.webp") return send(200, "image/svg+xml", thumbSvg(v));
    if (m[2] === "sprite.webp") return send(200, "image/svg+xml", spriteSvg(v));
    if (m[2] === "sprite.vtt") return send(200, "text/vtt; charset=utf-8", spriteVtt(v));
  }
  send(404, "application/json", '{"error":"not_found"}');
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase REST and media at", mockUrl);

// 4. next dev ------------------------------------------------------------------------------

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

// 5. Playwright -----------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

async function open(browser, path, { width, height = 900, theme = "light", scale = 1 }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForSelector('[data-feed-state="ready"], [data-watch-state]', { timeout: 30000 });
  return { context, page };
}

/** How many cards sit in the first row of the grid. */
const columns = (page) =>
  page.evaluate(() => {
    const cards = [...document.querySelectorAll("[data-feed-card]")];
    const top = cards[0]?.getBoundingClientRect().top;
    return cards.filter((c) => Math.abs(c.getBoundingClientRect().top - top) < 2).length;
  });

/** Every thumbnail on screen has loaded. */
const imagesLoaded = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("[data-feed-card] img")]
      .filter((img) => img.getBoundingClientRect().top < innerHeight)
      .every((img) => img.complete && img.naturalWidth > 0),
  );

try {
  await waitForApp();
  // The first requests compile the pages; do them once before timing anything.
  for (const p of ["/", "/trending", `/watch?v=${VIDEOS[0].id}`]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Grid, columns and the meta line.
  for (const [width, want] of [
    [390, 1],
    [1280, 4],
    [1800, 5],
  ]) {
    const { context, page } = await open(browser, "/", { width });
    check((await columns(page)) === want, `${want} column${want > 1 ? "s" : ""} at ${width}`);
    if (width === 1280) {
      check((await page.locator("h1", { hasText: "Recommended" }).count()) === 1, '"Recommended" header');
      check((await page.locator("[data-feed-card]").count()) === 24, "first page has 24 cards");
      const meta = await page.locator("[data-feed-card] p").first().innerText();
      check(/views · \d+ hours? ago$/.test(meta.trim()), `meta line reads "${meta.replace(/\n/g, " / ")}"`);
      const titleLines = await page.evaluate(() => {
        const h = document.querySelector("[data-feed-card] :is(h2, h3)");
        return Math.round(h.getBoundingClientRect().height / parseFloat(getComputedStyle(h).lineHeight));
      });
      check(titleLines <= 2, `titles stop at two lines (${titleLines})`);
    }
    await context.close();
  }

  // Hover preview: nothing for the first second, then sprite frames, no video.
  {
    const { context, page } = await open(browser, "/", { width: 1280 });
    await imagesLoaded(page);
    mediaRequests.length = 0;
    const first = page.locator("[data-feed-card]").first();
    const preview = first.locator("[data-sprite-preview]");
    await first.locator("img").hover();
    await page.waitForTimeout(600);
    check((await preview.getAttribute("data-sprite-preview")) === "off", "no preview before 1 s");
    await page.waitForTimeout(700);
    check((await preview.getAttribute("data-sprite-preview")) === "on", "preview on after 1 s");
    const f1 = Number(await preview.getAttribute("data-preview-frame"));
    await page.waitForTimeout(1100);
    const f2 = Number(await preview.getAttribute("data-preview-frame"));
    check(f2 > f1, `preview steps through frames (${f1} then ${f2})`);
    const bg = await preview.evaluate((el) => getComputedStyle(el).backgroundImage);
    check(bg.includes("sprite.webp"), "preview shows the sprite image");
    await page.screenshot({ path: join(outDir, "home-hover-1280-light.png"), clip: { x: 0, y: 56, width: 1280, height: 420 } });
    check(
      mediaRequests.every((f) => !/\.(m3u8|m4s|mp4)$/.test(f)) && mediaRequests.includes("sprite.vtt"),
      `hover loads only the sprite (${[...new Set(mediaRequests)].join(", ")})`,
    );
    await page.mouse.move(5, 300);
    await page.waitForTimeout(100);
    check((await preview.getAttribute("data-sprite-preview")) === "off", "preview stops when the pointer leaves");
    await context.close();
  }

  // Infinite scroll with the skeleton row.
  {
    pageTwoDelay = 1500;
    const { context, page } = await open(browser, "/", { width: 1280 });
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForSelector("[data-feed-grid] [data-card-skeleton]", { timeout: 5000 }).then(
      () => check(true, "skeleton row while the next page loads"),
      () => check(false, "skeleton row while the next page loads"),
    );
    await page.waitForFunction(() => document.querySelectorAll("[data-feed-card]").length === 36, null, { timeout: 15000 });
    const ids = await page.$$eval("[data-feed-card]", (els) => els.map((e) => e.getAttribute("data-feed-card")));
    check(ids.length === 36 && new Set(ids).size === 36, "second page appended, 36 cards, no repeats");
    check((await page.locator("[data-feed-more]").count()) === 0, "no more pages after the last one");
    pageTwoDelay = 0;
    await context.close();
  }

  // Trending: numbered, highest score first.
  {
    const { context, page } = await open(browser, "/trending", { width: 1280 });
    const want = VIDEOS.filter((v) => NOW - Date.parse(v.published_at) < 30 * 24 * HOUR)
      .sort((a, b) => score(b) - score(a))
      .map((v) => v.id);
    const ranks = await page.$$eval("[data-feed-card] a span.min-w-7", (els) => els.map((e) => Number(e.textContent)));
    check(ranks.length === want.length && ranks.every((r, i) => r === i + 1), `trending numbered 1 to ${ranks.length}`);
    const ids = await page.$$eval("[data-feed-card]", (els) => els.map((e) => e.getAttribute("data-feed-card")));
    check(JSON.stringify(ids) === JSON.stringify(want), "trending order matches views / hours ^ 1.5");
    await imagesLoaded(page);
    await page.screenshot({ path: join(outDir, "trending-1280-light.png") });
    await context.close();
  }

  // Up next on /watch: related videos, and a click navigates without a reload.
  {
    const { context, page } = await open(browser, `/watch?v=${VIDEOS[0].id}`, { width: 1280 });
    const cards = page.locator("[data-up-next-card]");
    check((await cards.count()) === 10, "Up next shows 10 related videos");
    const firstChannel = await cards.first().locator("p").innerText();
    check(firstChannel.startsWith(VIDEOS[0].channel_name), "same channel first in Up next");
    await page.evaluate(() => (window.__noReload = true));
    const href = await cards.nth(2).locator("a").first().getAttribute("href");
    const target = VIDEOS.find((v) => href.endsWith(v.id));
    await cards.nth(2).locator("h3 a").click();
    await page.waitForURL((u) => u.search.includes(target.id), { timeout: 15000 });
    await page.waitForFunction((t) => document.querySelector("h1")?.textContent?.includes(t), target.title, { timeout: 15000 });
    check(await page.evaluate(() => window.__noReload === true), "Up next click is a client navigation (no full reload)");
    check((await page.locator("[data-player]").count()) === 1, "player is there again for the new video");
    await context.close();
  }

  // Screenshots of / at 1280 and 390, light and dark.
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      const { context, page } = await open(browser, "/", { width, height, theme, scale: 2 });
      await imagesLoaded(page);
      await page.screenshot({ path: join(outDir, `home-${width}-${theme}.png`) });
      console.log(`shot  home-${width}-${theme}.png`);
      await context.close();
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
console.log(`\nall feed checks passed, screenshots in ${outDir}`);
