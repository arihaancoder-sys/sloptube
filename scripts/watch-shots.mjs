#!/usr/bin/env node
// Screenshots and a real playback check of /watch, without a database or R2.
//
//   node scripts/watch-shots.mjs [out-dir]      (default: shots/watch)
//
// 1. Makes a 3 second test clip with ffmpeg (lavfi test pattern and a tone)
//    and encodes it with the encoder's own ffmpeg arguments (worker/lib), so
//    the fixture is the same shape as a real upload: master.m3u8, 360p and
//    720p fMP4 renditions, a thumbnail, sprite.webp and sprite.vtt.
// 2. Serves it from a tiny local static server.
// 3. Starts `next dev` with no Supabase settings (the watch page preview) and
//    MEDIA_PUBLIC_URL pointing at that server, so the real player plays it.
// 4. With Playwright: checks play, pause and a quality switch, then takes
//    screenshots at 1280 (normal and theater) and 390, light and dark.
//
// Needs ffmpeg and Playwright with Chromium. Nothing here touches the network.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildEncodeArgs, buildThumbnailArgs, thumbnailName, SPRITE_IMAGE, SPRITE_VTT } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";
import { buildVtt, spritePlan } from "../worker/lib/sprite.mjs";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/watch"));
// The preview's sample video id (lib/watch/server.ts, PREVIEW_READY_ID).
const VIDEO_ID = "00000000-0000-4000-8000-000000000004";
const APP_PORT = Number(process.env.APP_PORT ?? 3457);
const DURATION = 3;

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

// 1. The fixture --------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-watch-"));
const hlsDir = join(work, "hls", VIDEO_ID);
mkdirSync(hlsDir, { recursive: true });
const source = join(work, "source.mp4");
console.log("fixture: making a 3 second clip in", work);
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", `testsrc2=size=1280x720:rate=30:duration=${DURATION}`,
  "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${DURATION}`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
]);
const renditions = pickRenditions({ width: 1280, height: 720, fps: 30 });
// A frame every half second, so the hover preview changes along the short clip.
const sprite = spritePlan(DURATION, { everySeconds: 0.5 });
run("ffmpeg", buildEncodeArgs({ input: source, renditions, hasAudio: true, sprite, segmentSeconds: 1 }), { cwd: hlsDir });
run("ffmpeg", buildThumbnailArgs({ input: source, atSeconds: 1, output: join(hlsDir, thumbnailName(0)) }));
writeFileSync(join(hlsDir, SPRITE_VTT), buildVtt(sprite, DURATION, SPRITE_IMAGE));
console.log("fixture: renditions", renditions.map((r) => r.name).join(", "));

// 2. The static server ---------------------------------------------------------------

const TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".webp": "image/webp",
  ".vtt": "text/vtt; charset=utf-8",
};
const media = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^([/\\])+/, "");
  const file = join(work, path);
  res.setHeader("access-control-allow-origin", "*");
  if (!file.startsWith(work) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => media.listen(0, "127.0.0.1", r));
const mediaUrl = `http://127.0.0.1:${media.address().port}`;
console.log("media: serving the fixture at", mediaUrl);

// 3. next dev ------------------------------------------------------------------------

const env = { ...process.env, MEDIA_PUBLIC_URL: mediaUrl, PORT: String(APP_PORT) };
// The preview only shows without Supabase settings.
delete env.NEXT_PUBLIC_SUPABASE_URL;
delete env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (existsSync(join(root, ".env.local"))) {
  console.error("Move .env.local aside first: the watch preview only shows without the Supabase settings.");
  process.exit(2);
}
// detached: its own process group, so the whole of next dev stops with it.
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
  media.closeAllConnections();
  media.close();
  rmSync(work, { recursive: true, force: true });
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${app}/api/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next dev did not start:\n" + devLog.slice(-2000));
}

// 4. Playwright ----------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

async function openWatch(browser, { width, height, theme }) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 });
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
      // Start every run fresh: no resume position, quality or theater from before.
      for (const k of Object.keys(localStorage)) if (k.startsWith("sloptube.player.")) localStorage.removeItem(k);
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.goto(`${app}/watch?v=${VIDEO_ID}`, { waitUntil: "load" });
  await page.waitForSelector("[data-player]");
  // The Next dev badge is not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  // hls.js has read the master playlist once the quality menu has its levels.
  await page.waitForFunction(() => document.querySelector("video")?.readyState >= 2, null, { timeout: 30000 });
  return { context, page };
}

/** Plays a moment, then pauses at about 1.5 s so every shot shows the same frame area. */
async function settle(page) {
  await page.evaluate(async () => {
    const v = document.querySelector("video");
    v.muted = true;
    await v.play().catch(() => {});
  });
  await page.waitForFunction(() => document.querySelector("video").currentTime > 0.3, null, { timeout: 15000 });
  await page.evaluate(() => {
    const v = document.querySelector("video");
    v.pause();
    v.currentTime = 1.5;
  });
  await page.waitForFunction(() => {
    const v = document.querySelector("video");
    return !v.seeking && v.readyState >= 2;
  });
  await page.waitForTimeout(300);
}

try {
  await waitForApp();
  // The first request compiles the page; do it once before timing anything.
  await fetch(`${app}/watch?v=${VIDEO_ID}`);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch();

  // Playback checks.
  {
    const { context, page } = await openWatch(browser, { width: 1280, height: 800, theme: "light" });
    const player = page.locator("[data-player]");
    // Autoplay with sound may be blocked; start it like a person would.
    if ((await player.getAttribute("data-player-state")) !== "playing") await page.click("[data-big-play]");
    await page.waitForFunction(() => document.querySelector("video").currentTime > 0.5, null, { timeout: 15000 });
    check((await player.getAttribute("data-player-state")) === "playing", "plays");
    await page.keyboard.press("k");
    await page.waitForTimeout(200);
    check((await player.getAttribute("data-player-state")) === "paused", "k pauses");
    const t1 = await page.evaluate(() => document.querySelector("video").currentTime);
    await page.waitForTimeout(500);
    const t2 = await page.evaluate(() => document.querySelector("video").currentTime);
    check(Math.abs(t2 - t1) < 0.01, "time stands still while paused");
    await page.keyboard.press(" ");
    await page.waitForTimeout(300);
    check((await player.getAttribute("data-player-state")) !== "paused", "space plays again");

    await player.hover();
    await page.click("[data-settings]");
    await page.click('[data-settings-menu="main"] >> text=Quality');
    const labels = await page.locator("[data-quality-option]").evaluateAll((els) => els.map((e) => e.getAttribute("data-quality-option")));
    check(JSON.stringify(labels) === JSON.stringify(["720p", "360p", "Auto"]), `quality menu lists ${labels.join(", ")}`);
    await page.click('[data-quality-option="360p"]');
    await page.waitForFunction(() => document.querySelector("[data-player]").getAttribute("data-level") === "0", null, { timeout: 15000 });
    check((await player.getAttribute("data-quality")) === "360p", "switches to 360p");
    const height = await page.evaluate(async () => {
      const v = document.querySelector("video");
      if (v.paused) await v.play().catch(() => {});
      for (let i = 0; i < 40 && v.videoHeight !== 360; i++) await new Promise((r) => setTimeout(r, 100));
      return v.videoHeight;
    });
    check(height === 360, `the picture is 360 high (${height})`);
    const saved = await page.evaluate(() => localStorage.getItem("sloptube.player.quality"));
    check(saved === "360p", "remembers the quality");
    await context.close();
  }

  // Screenshots.
  for (const theme of ["light", "dark"]) {
    for (const [width, height] of [
      [1280, 800],
      [390, 844],
    ]) {
      const { context, page } = await openWatch(browser, { width, height, theme });
      await settle(page);
      if (width >= 1016) {
        // Hover the progress bar for the sprite preview, like a person scrubbing.
        const bar = await page.locator("[data-progress]").boundingBox();
        await page.mouse.move(bar.x + bar.width * 0.7, bar.y + bar.height / 2);
        await page.waitForTimeout(400);
        check((await page.locator("[data-sprite-frame]").count()) === 1, `sprite preview shows (${theme})`);
      }
      await page.screenshot({ path: join(outDir, `watch-${width}-${theme}.png`) });
      console.log("shot", `watch-${width}-${theme}.png`);

      if (width >= 1016) {
        await page.mouse.move(5, 300);
        await page.keyboard.press("t");
        await page.waitForSelector('[data-watch-layout][data-theater="true"]');
        await page.waitForTimeout(300);
        await page.locator("[data-player]").hover();
        await page.waitForTimeout(200);
        await page.screenshot({ path: join(outDir, `watch-${width}-theater-${theme}.png`) });
        console.log("shot", `watch-${width}-theater-${theme}.png`);
      }
      await context.close();
    }
  }
  await browser.close();
} catch (err) {
  failures.push(err.message);
  console.error(err);
} finally {
  cleanup();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall watch checks passed, shots in ${outDir}`);
process.exit(0);
