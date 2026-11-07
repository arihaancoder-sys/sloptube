#!/usr/bin/env node
// Accessibility check with axe-core (feature 15): home, a watch page and a
// channel page at phone size (390 x 844), light and dark, on the production
// build against the made up site in scripts/launch-mock.mjs. Also checks the
// skip link, focus rings and the player keys (space, arrows, m, f, c).
//
//   npm run build && node scripts/a11y-check.mjs
//
// Fails on any axe violation (WCAG 2.0 to 2.2 A and AA, and best practices).
// Needs ffmpeg and Playwright with Chromium.

import { createRequire } from "node:module";
import { startSite } from "./launch-mock.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}
const axePath = require.resolve("axe-core/axe.min.js");

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const site = await startSite({ port: Number(process.env.APP_PORT ?? 3471) });
const browser = await chromium.launch();
const summary = [];
try {
  const pages = [
    ["home", "/"],
    ["watch", site.watchPath],
    ["channel", site.channelPath],
  ];
  for (const theme of ["light", "dark"]) {
    for (const [name, path] of pages) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await context.addInitScript((t) => {
        try {
          localStorage.setItem("sloptube-theme", t);
        } catch {}
      }, theme);
      const page = await context.newPage();
      await page.goto(site.base + path, { waitUntil: "networkidle" });
      await page.waitForSelector('[data-feed-state="ready"], [data-watch-state="ready"], [data-channel-state="ready"]', { timeout: 20000 });
      await page.addScriptTag({ path: axePath });
      const result = await page.evaluate(async () =>
        axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] }, resultTypes: ["violations"] }),
      );
      const v = result.violations;
      summary.push({ page: name, theme, violations: v.length, nodes: v.reduce((n, x) => n + x.nodes.length, 0), passes: result.passes?.length ?? 0 });
      for (const x of v) {
        console.log(`     ${name} ${theme}: ${x.id} (${x.impact}) ${x.help}`);
        for (const n of x.nodes.slice(0, 4)) console.log(`       ${n.target.join(" ")}  ${n.failureSummary?.split("\n").slice(1, 2).join("").trim()}`);
      }
      check(v.length === 0, `${name} (${theme}): ${v.length} axe violation${v.length === 1 ? "" : "s"}`);
      await context.close();
    }
  }

  // Keyboard: the skip link, focus rings, the player keys.
  {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(site.base + site.watchPath, { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const skip = await page.evaluate(() => ({ text: document.activeElement?.textContent?.trim(), top: document.activeElement?.getBoundingClientRect().top }));
    check(skip.text === "Skip to content" && skip.top >= 0, "the first Tab shows the skip link");
    await page.keyboard.press("Enter");
    check(await page.evaluate(() => document.activeElement?.id === "content"), "the skip link moves focus to the main content");
    await page.keyboard.press("Tab");
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    check(ring !== "none", `the next focused control shows a focus ring (${ring})`);

    const video = page.locator("video");
    await page.locator("body").click({ position: { x: 5, y: 700 } });
    const paused = () => video.evaluate((v) => v.paused);
    await page.keyboard.press(" ");
    await page.waitForFunction(() => !document.querySelector("video").paused, null, { timeout: 10000 }).catch(() => {});
    check(!(await paused()), "space plays");
    await page.keyboard.press(" ");
    check(await paused(), "space pauses");
    const t0 = await video.evaluate((v) => v.currentTime);
    await page.keyboard.press("ArrowRight");
    check((await video.evaluate((v) => v.currentTime)) > t0, "right arrow seeks forward");
    const vol = await video.evaluate((v) => v.volume);
    await page.keyboard.press("ArrowDown");
    check((await video.evaluate((v) => v.volume)) < vol, "down arrow turns the volume down");
    check((await page.locator("[data-player-note]").innerText()).endsWith("%"), "the volume shows as a note");
    await page.keyboard.press("m");
    check(await video.evaluate((v) => v.muted), "m mutes");
    await page.keyboard.press("m");
    check(!(await video.evaluate((v) => v.muted)), "m unmutes");
    await page.keyboard.press("c");
    check((await page.locator('[role="status"]', { hasText: "subtitles" }).count()) > 0, "c says the video has no subtitles");
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.fullscreenElement !== null), "f goes fullscreen");
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    check(await page.evaluate(() => document.fullscreenElement === null), "f leaves fullscreen");
    // Space on a focused button presses the button, not the player.
    const subscribe = page.locator("button", { hasText: /subscribe/i }).first();
    if (await subscribe.count()) {
      await subscribe.focus();
      const before = await paused();
      await page.keyboard.press(" ");
      check((await paused()) === before, "space on a focused button leaves the player alone");
    }
    await context.close();
  }
} finally {
  await browser.close();
  site.stop();
}

console.log("\naxe-core results (390 x 844):");
console.log("page     theme  violations  nodes");
for (const s of summary) console.log(`${s.page.padEnd(8)} ${s.theme.padEnd(6)} ${String(s.violations).padStart(10)}  ${String(s.nodes).padStart(5)}`);
if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("\nall accessibility checks passed");
