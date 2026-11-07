#!/usr/bin/env node
// Checks and screenshots of search, without a real database or R2.
//
//   node scripts/search-shots.mjs [out-dir]   (default: shots/search)
//
// 1. Starts a tiny local server that stands in for Supabase (the flags, the
//    search RPCs) and the public bucket domain. Its search_videos,
//    search_channels and search_suggest follow 010_search.sql closely enough
//    for the page: prefix word matches, the upload date and duration
//    filters, the three sorts and the keyset pages on (sort_key, id).
// 2. Starts `next dev` pointed at it.
// 3. With Playwright: the suggestions dropdown (debounced, bold completion,
//    up, down, escape and enter), recent searches with the remove X, the
//    results page (channel row with SUBSCRIBE, 360 px thumbnails, bold
//    matches, infinite scroll), the filter panel, "No results found", and on
//    a phone the search overlay and the stacked cards. Then screenshots at
//    1280 and 390, light and dark.
//
// Made up names and titles, no real data. Nothing here touches the network.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/search"));
const APP_PORT = Number(process.env.APP_PORT ?? 3461);

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

// 1. Made up channels and videos ---------------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const CHANNELS = [
  ["breadclub", "Bread Club", "Weekly bakes for people with small kitchens. Sourdough, flatbread and test bakes.", 87_000],
  ["breadlab", "Bread Lab Notes", "Testing flour, water and patience.", 1_234],
  ["desklab", "Desk Setup Lab", "Desks, cables and lamps.", 41],
  ["trailnotes", "Trail Notes", "Short hikes and long views.", 250_000],
].map(([handle, name, description, subs], i) => ({
  id: `c0000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  handle,
  name,
  description,
  subs,
}));

const TOPICS = [
  ["Bread with four ingredients", "The simplest bread you can bake: flour, water, salt and yeast. We test three flours and show the crumb."],
  ["Sourdough starter from scratch", "Day by day notes on a starter, with a test loaf at the end. Bread that rises without store yeast."],
  ["Test bake: rye bread in a cast iron pot", "Rye bread is sticky. Here is how we handle the dough and what the test bake looked like."],
  ["Flatbread in ten minutes", "No oven needed. A pan, flour and water, and dinner is ready."],
  ["Cable management that lasts", "Velcro, trays and a test of five clips. Nothing to do with bread."],
  ["Sunrise hike to the old fire lookout", "Three miles up, one cup of tea, and a test of a new camera at the top."],
];
const uuid = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const VIDEOS = [];
for (let i = 0; i < 46; i++) {
  const [title, description] = TOPICS[i % TOPICS.length];
  const ch = i % TOPICS.length < 4 ? CHANNELS[i % 2] : i % TOPICS.length === 4 ? CHANNELS[2] : CHANNELS[3];
  const round = Math.floor(i / TOPICS.length);
  const hours = [0.5, 5, 30, 24 * 5, 24 * 20, 24 * 200, 24 * 900][i % 7] + i;
  VIDEOS.push({
    id: uuid(i + 1),
    title: round ? `${title} (part ${round + 1})` : title,
    description: round % 2 ? `${"Some words before the good part, ".repeat(6)}${description}` : description,
    duration_s: [95, 610, 1500, 200, 2400, 760][i % 6] + i,
    thumbnail_url: null,
    hls_key: `hls/${uuid(i + 1)}/master.m3u8`,
    preview_sprite_key: null,
    published_at: new Date(NOW - hours * HOUR).toISOString().replace("Z", "123+00:00"),
    views: [12, 1_500, 87_000, 1_200_000, 340, 9_900][i % 6] + i * 7,
    channel_id: ch.id,
    channel_handle: ch.handle,
    channel_name: ch.name,
    channel_avatar_url: null,
    design: i % TOPICS.length,
  });
}

const norm = (q) => String(q ?? "").toLowerCase().replace(/['’]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 100);
const wordsOf = (q) => norm(q).split(" ").filter(Boolean);
const hits = (text, words) => {
  const tokens = norm(text).split(" ");
  return words.filter((w) => tokens.some((t) => t.startsWith(w))).length;
};

/** Requests the mock saw, so the checks can ask what the app sent. */
const seen = { suggest: [], videos: [], channels: [] };

function searchVideos({ q, cursor_rank = null, cursor_id = null, lim = 20, filters = {} }) {
  seen.videos.push({ q, cursor_rank, filters });
  const words = wordsOf(q);
  if (!words.length) return [];
  const since = { hour: 1, today: 24, week: 24 * 7, month: 24 * 30, year: 24 * 365 }[filters.uploaded];
  let rows = VIDEOS.filter((v) => words.every((w) => hits(`${v.title} ${v.description}`, [w])))
    .filter((v) => !since || Date.parse(v.published_at) >= NOW - since * HOUR)
    .filter((v) => {
      const d = v.duration_s;
      return !filters.duration || (filters.duration === "short" ? d < 240 : filters.duration === "medium" ? d >= 240 && d <= 1200 : d > 1200);
    })
    .map((v) => {
      const score = hits(v.title, words) * 1.5 + hits(v.description, words) * 0.4 + 1 / (1 + v.title.length);
      const sort_key = filters.sort === "date" ? Date.parse(v.published_at) * 1000 : filters.sort === "views" ? v.views : score;
      return { ...v, score, sort_key };
    })
    .sort((a, b) => b.sort_key - a.sort_key || (a.id < b.id ? 1 : -1));
  if (cursor_rank !== null) rows = rows.filter((v) => v.sort_key < cursor_rank || (v.sort_key === cursor_rank && v.id < cursor_id));
  return rows.slice(0, lim).map(({ design, ...v }) => (void design, v));
}

function searchChannels({ q, lim = 3 }) {
  seen.channels.push(q);
  const words = wordsOf(q);
  return CHANNELS.filter((c) => words.length && words.every((w) => hits(`${c.name} ${c.handle}`, [w])))
    .sort((a, b) => b.subs - a.subs)
    .slice(0, lim)
    .map((c) => ({
      id: c.id,
      handle: c.handle,
      name: c.name,
      description: c.description,
      avatar_url: null,
      subscriber_count: c.subs,
      video_count: VIDEOS.filter((v) => v.channel_id === c.id).length,
      score: 1,
    }));
}

function searchSuggest({ q, lim = 10 }) {
  seen.suggest.push(q);
  const n = norm(q);
  if (!n) return [];
  const all = [...VIDEOS.map((v) => v.title), ...CHANNELS.map((c) => c.name)].map((s) => s.toLowerCase());
  const prefix = all.filter((s) => s.startsWith(n));
  const other = all.filter((s) => !s.startsWith(n) && s.split(" ").some((w) => w.startsWith(n.split(" ").pop())));
  return [...new Set([...prefix, ...other])].slice(0, Math.min(lim, 10)).map((suggestion) => ({ suggestion }));
}

// 2. The stand in server -------------------------------------------------------------------

const FLAGS = ["search", "subscriptions", "watch", "channels", "feed", "accounts"].map((key) => ({
  key,
  label: key,
  description: "",
  mode: "everyone",
  users: [],
  updated_at: null,
}));

function thumbSvg(v) {
  const h = (v.design * 47 + 20) % 360;
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

  if (url.pathname === "/auth/v1/user") return send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") return send(200, FLAGS);
  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  if (rpc === "search_videos") return send(200, searchVideos(args));
  if (rpc === "search_channels") return send(200, searchChannels(args));
  if (rpc === "search_suggest") return send(200, searchSuggest(args));
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);

  const m = /^\/hls\/([0-9a-f-]{36})\/thumb-1\.webp$/.exec(url.pathname);
  const v = m && VIDEOS.find((x) => x.id === m[1]);
  if (v) return send(200, thumbSvg(v), "image/svg+xml");
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 3. next dev --------------------------------------------------------------------------------

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

// 4. Playwright ---------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

async function open(browser, path, { width = 1280, height = 900, theme = "light", scale = 1, recent = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  await context.addInitScript(
    ([t, r]) => {
      try {
        localStorage.setItem("sloptube-theme", t);
        if (r !== null && !sessionStorage.getItem("seeded")) {
          localStorage.setItem("sloptube-recent-searches", JSON.stringify(r));
          sessionStorage.setItem("seeded", "1");
        }
      } catch {}
    },
    [theme, recent],
  );
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

const imagesLoaded = (page) =>
  page.waitForFunction(() =>
    [...document.querySelectorAll("main img")]
      .filter((img) => {
        const r = img.getBoundingClientRect();
        return r.width > 0 && r.top < innerHeight;
      })
      .every((img) => img.complete && img.naturalWidth > 0),
  );
const barInput = (page) => page.locator('[data-search-box="bar"] input[role="combobox"]');
/** Waits until the top bar has streamed in and handed the flags to the browser store. */
const sessionReady = async (page) => {
  await page.waitForSelector('header a[href="/login"]', { timeout: 30000 });
  await page.waitForTimeout(800);
};

try {
  await waitForApp();
  for (const p of ["/", "/results?search_query=bread"]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // The suggestions dropdown with the keyboard ------------------------------------------------
  {
    const { context, page } = await open(browser, "/results?search_query=x");
    await sessionReady(page);
    const input = barInput(page);
    check((await input.inputValue()) === "x", "the results page puts its query in the box");
    await input.click();
    await input.fill("");
    await page.waitForTimeout(300);
    seen.suggest.length = 0;
    await input.pressSequentially("bre", { delay: 40 });
    await page.waitForSelector('[data-search-list="suggest"]', { timeout: 10000 });
    check(seen.suggest.length === 1 && seen.suggest[0] === "bre", `debounced: one suggest call for "bre" (${JSON.stringify(seen.suggest)})`);
    const options = page.locator('[data-search-option="suggest"]');
    const n = await options.count();
    check(n > 1 && n <= 10, `dropdown shows ${n} suggestions (at most 10)`);
    const first = await options.first().innerText();
    check(first.startsWith("bre"), `first suggestion starts with what was typed ("${first}")`);
    const boldRest = await options.first().locator("b").innerText();
    check(first === "bre" + boldRest, `the completion is bold ("${boldRest}")`);
    check((await options.first().locator("svg").count()) === 1, "each row has the search icon");
    await page.screenshot({ path: join(outDir, "suggest-1280-light.png"), clip: { x: 0, y: 0, width: 1280, height: 420 } });

    await input.press("ArrowDown");
    await input.press("ArrowDown");
    const second = await options.nth(1).innerText();
    check((await input.inputValue()) === second, `down twice: the box shows the second suggestion ("${second}")`);
    check((await options.nth(1).getAttribute("aria-selected")) === "true", "down twice: the second row is highlighted");
    await input.press("ArrowUp");
    check((await input.inputValue()) === first, "up once: back to the first suggestion");
    await input.press("ArrowUp");
    check((await input.inputValue()) === "bre", "up again: back to what was typed");
    await input.press("ArrowUp");
    check((await input.inputValue()) === (await options.last().innerText()), "up from the typed text wraps to the last row");
    await input.press("Escape");
    check((await page.locator('[data-search-list]').count()) === 0, "escape closes the dropdown");
    await input.press("ArrowDown");
    check((await page.locator('[data-search-list="suggest"]').count()) === 1, "down opens it again");
    await input.press("ArrowDown");
    await input.press("Enter");
    await page.waitForURL((u) => u.searchParams.get("search_query") === first, { timeout: 15000 });
    check(true, `enter goes to /results?search_query=${first}`);
    await page.waitForSelector('[data-search-state="ready"]', { timeout: 30000 });
    check((await barInput(page).inputValue()) === first, "the results page keeps the query in the box");
    check((await page.title()) === `${first} | sloptube`, `page title echoes the query ("${await page.title()}")`);

    // Recent searches: the empty box shows them, the X removes one.
    await barInput(page).fill("");
    await barInput(page).focus();
    await page.waitForSelector('[data-search-list="recent"]', { timeout: 5000 });
    const recent = await page.locator('[data-search-option="recent"]').allInnerTexts();
    check(recent[0] === first, `recent searches: newest first ("${recent[0]}")`);
    await barInput(page).pressSequentially("desk", { delay: 20 });
    await barInput(page).press("Enter");
    await page.waitForURL(/search_query=desk/, { timeout: 15000 });
    await page.waitForSelector('[data-search-state="ready"]', { timeout: 30000 });
    await barInput(page).fill("");
    await barInput(page).focus();
    await page.waitForSelector('[data-search-list="recent"]');
    check((await page.locator('[data-search-option="recent"]').count()) === 2, "two searches, two recent rows");
    await page.screenshot({ path: join(outDir, "recent-1280-light.png"), clip: { x: 0, y: 0, width: 1280, height: 300 } });
    await page.locator("[data-search-remove]").first().click();
    const left = await page.locator('[data-search-option="recent"]').allInnerTexts();
    check(left.length === 1 && left[0] === first, "the X removes that row, the box keeps focus");
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("sloptube-recent-searches")));
    check(stored.length === 1 && stored[0] === first, "and it is gone from localStorage");
    await context.close();
  }

  // The results page --------------------------------------------------------------------------
  {
    seen.videos.length = 0;
    const { context, page } = await open(browser, "/results?search_query=bread");
    await page.waitForSelector('[data-search-state="ready"]', { timeout: 30000 });
    check((await page.locator("[data-search-channel]").count()) >= 1, "channel rows on top");
    check((await page.locator('[data-search-channel="breadclub"]').innerText()).includes("87K subscribers"), "channel row shows the subscriber count");
    check((await page.locator('[data-search-channel="breadclub"] [data-subscribe]').count()) >= 1, "channel row has SUBSCRIBE");
    const thumbW = await page.locator("[data-search-video] > article > a").first().evaluate((el) => el.getBoundingClientRect().width);
    check(thumbW === 360, `thumbnail is 360 px wide at 1280 (${thumbW})`);
    const bolds = await page.locator("[data-search-snippet] [data-search-hit]").allInnerTexts();
    check(bolds.length > 0 && bolds.every((b) => b.toLowerCase().startsWith("bread")), `matched words are bold in the snippet (${bolds.slice(0, 3)})`);
    const count0 = Number(await page.locator("[data-search-results]").getAttribute("data-search-count"));
    check(count0 === 20, `first page has 20 videos (${count0})`);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForFunction(() => Number(document.querySelector("[data-search-results]").dataset.searchCount) > 20, null, { timeout: 15000 });
    const count1 = Number(await page.locator("[data-search-results]").getAttribute("data-search-count"));
    check(count1 > 20, `infinite scroll loads the next page (${count1})`);
    const ids = await page.locator("[data-search-video]").evaluateAll((els) => els.map((e) => e.dataset.searchVideo));
    check(new Set(ids).size === ids.length, "no video twice across pages");
    check(seen.videos.some((c) => c.cursor_rank !== null), "the next page sent the cursor");

    // The filter panel.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator("[data-search-filter-button]").click();
    await page.waitForSelector("[data-search-filter-panel]", { state: "visible" });
    const headers = await page.locator("[data-search-filter-panel] h4").allInnerTexts();
    check(headers.join("|") === "UPLOAD DATE|TYPE|DURATION|SORT BY", `filter columns: ${headers.join(", ")}`);
    seen.videos.length = 0;
    await page.locator('[data-search-filter="uploaded:week"]').click();
    await page.waitForURL(/uploaded=week/, { timeout: 15000 });
    await page.waitForSelector('[data-search-filter="uploaded:week"][data-on]', { state: "attached", timeout: 15000 });
    check(seen.videos.some((c) => c.filters.uploaded === "week" && c.filters.sort === "relevance"), "This week reaches search_videos as filters.uploaded");
    check((await page.locator("[data-search-channel]").count()) === 0, "with an upload date, channel rows go");
    await page.locator('[data-search-filter="uploaded:week"]').click();
    await page.waitForURL((u) => !u.searchParams.has("uploaded"), { timeout: 15000 });
    check(true, "clicking it again clears it");
    await context.close();
  }

  // No results ----------------------------------------------------------------------------------
  {
    const { context, page } = await open(browser, "/results?search_query=zzzz%20qqqq");
    await page.waitForSelector('[data-search-state="none"]', { timeout: 30000 });
    check((await page.getByText("No results found").count()) === 1, '"No results found"');
    check((await page.getByText("Try different keywords or remove search filters").count()) === 1, "with the hint");
    await page.screenshot({ path: join(outDir, "none-1280-light.png") });
    await context.close();
  }

  // Phone: the overlay and stacked cards ------------------------------------------------------
  {
    const { context, page } = await open(browser, "/", { width: 390, height: 844, recent: ["sourdough", "desk lamp"] });
    await page.waitForSelector("[data-search-open]");
    await sessionReady(page);
    await page.locator("[data-search-open]").click();
    const overlay = page.locator('[data-search-box="overlay"] input');
    await overlay.waitFor();
    check(await overlay.evaluate((el) => el === document.activeElement), "overlay input has the focus");
    await page.waitForSelector('[data-search-list="recent"]', { timeout: 5000 });
    check((await page.locator('[data-search-option="recent"]').count()) === 2, "overlay shows recent searches when empty");
    await overlay.pressSequentially("test", { delay: 30 });
    await page.waitForSelector('[data-search-list="suggest"]', { timeout: 10000 });
    const w = await page.locator('[data-search-list="suggest"]').evaluate((el) => el.getBoundingClientRect().width);
    check(w === 390, `suggestions are full width on a phone (${w})`);
    await overlay.press("Enter");
    await page.waitForURL(/search_query=test/, { timeout: 15000 });
    await page.waitForSelector('[data-search-state="ready"]', { timeout: 30000 });
    check((await page.locator('[data-search-box="overlay"]').count()) === 0, "the overlay closes on search");
    const cardW = await page.locator("[data-search-video] [data-feed-card]").first().evaluate((el) => el.getBoundingClientRect().width);
    check(cardW === 390, `results stack as full width cards (${cardW})`);
    await context.close();
  }

  // Screenshots at 1280 and 390, light and dark ------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      const opts = { width, height, theme, scale: 2 };
      {
        const { context, page } = await open(browser, "/results?search_query=bread", opts);
        await page.waitForSelector('[data-search-state="ready"]', { timeout: 30000 });
        await page.waitForSelector('[data-subscribe="signed-out"]', { state: "attached", timeout: 30000 });
        await imagesLoaded(page);
        await page.screenshot({ path: join(outDir, `results-${width}-${theme}.png`) });
        console.log(`shot  results-${width}-${theme}.png`);
        await page.locator("[data-search-filter-button]").click();
        await page.waitForSelector("[data-search-filter-panel]", { state: "visible" });
        await page.screenshot({ path: join(outDir, `filters-${width}-${theme}.png`) });
        console.log(`shot  filters-${width}-${theme}.png`);
        await context.close();
      }
      {
        const { context, page } = await open(browser, "/", opts);
        await sessionReady(page);
        if (width < 656) await page.locator("[data-search-open]").click();
        const input = page.locator(`[data-search-box="${width < 656 ? "overlay" : "bar"}"] input`);
        await input.click();
        await input.pressSequentially("bread", { delay: 30 });
        await page.waitForSelector('[data-search-list="suggest"]', { timeout: 10000 });
        await input.press("ArrowDown");
        await input.press("ArrowDown");
        await page.screenshot({ path: join(outDir, `suggest-${width}-${theme}.png`) });
        console.log(`shot  suggest-${width}-${theme}.png`);
        await context.close();
      }
    }
  }

  await browser.close();
} catch (err) {
  failures.push(String(err?.stack ?? err));
  console.error(err);
  if (process.env.SHOW_DEV_LOG) console.error(devLog.slice(-4000));
} finally {
  cleanup();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall search checks passed, screenshots in ${outDir}`);
