#!/usr/bin/env node
// Checks and screenshots of the launch pack (feature 15) on the production
// build against the made up site in scripts/launch-mock.mjs:
// - the public pages and the footer with the launch flag on, the "isn't on
//   yet" page and no footer with it off
// - /contact: the form's errors, a message sent, the 5 a day cap, the
//   message in /admin/messages and Mark handled
// - share cards in <head> for a social bot, the canonical link and JSON-LD
//   on a watch page, channel and Snips cards, sitemap.xml and robots.txt
// - the 404 page with a real 404 status
// - maintenance mode: the static page (503) for visitors and the API, sign
//   in still open, the admin still sees the site
// Screenshots of /about, /press, /contact, the 404, the maintenance page and
// /admin/messages at 1280 and 390, light and dark, in shots/launch.
//
//   npm run build && node scripts/launch-shots.mjs [out-dir]
//
// Needs ffmpeg and Playwright with Chromium.

import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { adminCookie, root, startSite } from "./launch-mock.mjs";

const outDir = resolve(process.argv[2] ?? join(root, "shots/launch"));
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const site = await startSite({ port: Number(process.env.APP_PORT ?? 3475) });
const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

async function open(path, { width = 1280, height = 900, theme = "light", admin = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
    } catch {}
  }, theme);
  if (admin) await context.addCookies([adminCookie()]);
  const page = await context.newPage();
  const res = await page.goto(site.base + path, { waitUntil: "networkidle" });
  return { context, page, status: res?.status() };
}

async function shots(name, path, ready, opts = {}) {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      const { context, page } = await open(path, { width, height: width === 390 ? 844 : 900, theme, ...opts });
      if (ready) await page.waitForSelector(ready, { timeout: 15000 });
      await page.screenshot({ path: join(outDir, `${name}-${width}-${theme}.png`), fullPage: width === 390 });
      await context.close();
    }
  }
}

const BOT = { "user-agent": "Twitterbot/1.0" };
const text = async (path, headers = {}) => {
  const res = await fetch(site.base + path, { headers });
  return { status: res.status, type: res.headers.get("content-type") ?? "", body: await res.text(), headers: res.headers };
};
const head = (html) => html.slice(0, html.indexOf("</head>"));
const waitFlag = () => new Promise((r) => setTimeout(r, 16_000)); // proxy.ts keeps the maintenance flag 15 seconds

try {
  // Public pages and the footer.
  for (const p of ["/about", "/terms", "/privacy", "/guidelines", "/press", "/contact"]) {
    const { context, page, status } = await open(p);
    await page.waitForSelector("[data-public-page]", { timeout: 15000 });
    check(status === 200, `${p} answers 200`);
    check((await page.locator("[data-site-footer] a").count()) === 7, `${p} has the footer links`);
    if (p === "/terms") check((await page.locator('[data-placeholder="OWNER_NAME"]').count()) > 0, "/terms marks the OWNER_NAME placeholder");
    if (p === "/press") {
      const n = await page.locator("[data-press-shots] img").count();
      const loaded = await page.evaluate(() => [...document.querySelectorAll("[data-press-shots] img")].every((i) => i.complete && i.naturalWidth > 0));
      check(n === 6 && loaded, `/press shows its ${n} screenshots`);
    }
    await context.close();
  }
  {
    const { context, page } = await open("/");
    await page.waitForSelector('[data-feed-state="ready"]');
    check((await page.locator("[data-site-footer]").count()) === 1, "the home page has the footer");
    await context.close();
  }

  // Contact form, the cap, the admin inbox.
  {
    const { context, page } = await open("/contact");
    await page.waitForSelector("[data-contact-state]");
    await page.click('form[data-contact-state] button[type="submit"]');
    check((await page.locator('[data-contact-error="bad_name"]').count()) === 1, "an empty form asks for a name first");
    await page.fill("#contact-name", "Sam Sample");
    await page.fill("#contact-email", "sam@example.com");
    await page.selectOption("#contact-topic", "press");
    await page.fill("#contact-body", "short");
    await page.click('form[data-contact-state] button[type="submit"]');
    check((await page.locator('[data-contact-error="too_short"]').count()) === 1, "a short message is refused before it goes out");
    await page.fill("#contact-body", "Hello, I would like a few screenshots for an article next week.");
    await page.click('form[data-contact-state] button[type="submit"]');
    await page.waitForSelector('[data-contact-state="sent"]', { timeout: 10000 });
    check(site.state.messages.length === 1 && site.state.messages[0].topic === "press", "the message reaches contact_send with its topic");
    await page.screenshot({ path: join(outDir, "contact-sent-1280-light.png") });
    await context.close();
    for (let i = 0; i < 4; i++) {
      await fetch(site.base + "/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", email: "sam@example.com", topic: "general", body: `Message number ${i + 2} for the cap.` }) });
    }
    const sixth = await fetch(site.base + "/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", email: "SAM@example.com", topic: "general", body: "The sixth message today." }) });
    check(sixth.status === 429 && (await sixth.json()).error === "rate_limited", "the sixth message in a day answers 429 rate_limited");
    const bad = await fetch(site.base + "/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", email: "nope", body: "Hello there friend" }) });
    check(bad.status === 400 && (await bad.json()).error === "bad_email", "a bad address answers 400 bad_email");
  }
  {
    const anon = await text("/admin/messages");
    check(anon.status === 404, "/admin/messages is a 404 signed out");
    const { context, page } = await open("/admin/messages", { admin: true });
    await page.waitForSelector("[data-admin-messages]", { timeout: 15000 });
    check((await page.locator("[data-message]").count()) === 5, "the admin sees the 5 messages");
    await page.locator("[data-message]").first().getByRole("button", { name: "Mark handled" }).click();
    await page.waitForSelector("[data-message][data-handled]");
    check(site.state.messages.filter((m) => m.handled_at).length === 1, "Mark handled reaches admin_contact_mark");
    await context.close();
    await shots("admin-messages", "/admin/messages?all=1", "[data-admin-messages]", { admin: true });
  }

  // Share cards, canonical links, JSON-LD.
  {
    const w = await text(site.watchPath, BOT);
    const h = head(w.body);
    check(/<meta property="og:type" content="video.other"\/>/.test(h), "watch: og:type video.other in <head>");
    check(/<meta property="og:image" content="http:\/\/127\.0\.0\.1:\d+\/hls\/[^"]+\/thumb-1\.webp"\/>/.test(h), "watch: og:image is the thumbnail");
    check(h.includes('<meta name="twitter:card" content="summary_large_image"/>'), "watch: twitter:card summary_large_image");
    check(h.includes('<meta name="video:duration" content="612"/>'), "watch: the duration");
    check(h.includes(`<link rel="canonical" href="${site.base}${site.watchPath}"/>`), "watch: the canonical link");
    const ld = w.body.match(/<script type="application\/ld\+json">([^<]+)<\/script>/);
    const json = ld ? JSON.parse(ld[1]) : null;
    check(json?.["@type"] === "VideoObject" && json.duration === "PT10M12S" && json.thumbnailUrl?.length === 1, "watch: JSON-LD VideoObject with the duration and thumbnail");
    const c = head((await text(site.channelPath, BOT)).body);
    check(c.includes('<meta property="og:type" content="profile"/>') && c.includes(`<link rel="canonical" href="${site.base}${site.channelPath}"/>`), "channel: og:type profile and the canonical link");
    const s = head((await text(site.shortPath, BOT)).body);
    check(s.includes(`<link rel="canonical" href="${site.base}${site.shortPath}"/>`) && s.includes("Snips</title>"), "short: its own canonical link and title");
  }

  // sitemap.xml and robots.txt.
  {
    const index = await text("/sitemap.xml");
    check(index.status === 200 && index.type.includes("xml") && index.body.includes(`${site.base}/sitemaps/videos-1.xml`) && index.body.includes("channels-1.xml"), "sitemap.xml lists the pages, videos and channels files");
    const videos = await text("/sitemaps/videos-1.xml");
    check((videos.body.match(/<url>/g) ?? []).length === 15 && videos.body.includes("<video:duration>612</video:duration>") && videos.body.includes("/shorts/"), "videos-1.xml has the 15 videos, durations and the shorts at /shorts/");
    check((await text("/sitemaps/channels-1.xml")).body.includes(`${site.base}/@samplekitchen`), "channels-1.xml has the channels");
    check((await text("/sitemaps/nope.xml")).status === 404, "an unknown sitemap file is a 404");
    const robots = await text("/robots.txt");
    check(robots.body.includes(`Sitemap: ${site.base}/sitemap.xml`) && robots.body.includes("Disallow: /studio"), "robots.txt points at the sitemap and keeps crawlers out of the studio");
  }

  // 404.
  {
    const { context, page, status } = await open("/no-such-page");
    check(status === 404 && (await page.locator('[data-error-state="404"]').count()) === 1, "an unknown page is the 404 page with a 404 status");
    await context.close();
    await shots("404", "/no-such-page", '[data-error-state="404"]');
  }
  await shots("about", "/about", "[data-public-page]");
  await shots("press", "/press", "[data-public-page]");
  await shots("contact", "/contact", "[data-contact-state]");

  // The launch flag off: no footer, the pages say so.
  site.state.flags.launch = "off";
  {
    const { context, page } = await open("/about");
    await page.waitForSelector("[data-launch-state]");
    check((await page.locator('[data-launch-state="off"]').count()) === 1, "launch off: /about says it isn't on yet");
    check((await page.locator("[data-site-footer]").count()) === 0, "launch off: no footer");
    await context.close();
    const off = await fetch(site.base + "/api/contact", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Sam", email: "kim@example.com", topic: "general", body: "Hello there, a message." }) });
    check(off.status === 403, "launch off: /api/contact answers 403");
  }
  site.state.flags.launch = "everyone";

  // Maintenance.
  site.state.flags.maintenance = "everyone";
  await waitFlag();
  {
    const home = await text("/");
    check(home.status === 503 && home.body.includes('data-error-state="maintenance"') && home.headers.get("retry-after") === "600", "maintenance: visitors get the static page with 503 and Retry-After");
    const api = await text("/api/feed?kind=newest");
    check(api.status === 503 && JSON.parse(api.body).error === "maintenance", "maintenance: the API answers 503 maintenance");
    check((await text("/login")).status === 200, "maintenance: /login still works");
    check((await text("/api/health")).status === 200, "maintenance: /api/health still works");
    check((await text("/robots.txt")).body === "User-agent: *\nDisallow: /\n", "maintenance: robots.txt keeps crawlers away");
    const { context, page, status } = await open("/", { admin: true });
    check(status === 200 && (await page.locator('[data-feed-state="ready"]').count()) === 1, "maintenance: the admin still sees the site");
    await context.close();
    await shots("maintenance", "/", '[data-error-state="maintenance"]');
  }
  site.state.flags.maintenance = "off";
} finally {
  await browser.close();
  site.stop();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall launch checks passed, screenshots in ${outDir}`);
