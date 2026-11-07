#!/usr/bin/env node
// Lighthouse (feature 15): home, a watch page and a channel page at phone
// size (Lighthouse's mobile preset: a 412 x 823 phone, slow 4G and a 4x
// slower CPU, simulated), on the production build against the made up site
// in scripts/launch-mock.mjs, with Playwright's Chromium.
//
//   npm run build && node scripts/lighthouse.mjs [out.json]
//
// Prints Performance, Accessibility, Best Practices and SEO for each page and
// the audits that cost points. Fails when one of the first three is under 90.
// SEO is printed but not held to 90: on localhost the canonical links point
// at the request's own address and robots.txt is served by the mock site.
// Needs ffmpeg and Playwright with Chromium.

import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import lighthouse from "lighthouse";
import { startSite } from "./launch-mock.mjs";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const CATEGORIES = ["performance", "accessibility", "best-practices", "seo"];
const HELD = ["performance", "accessibility", "best-practices"];
const PORT = Number(process.env.CDP_PORT ?? 9333);
const RUNS = Number(process.env.RUNS ?? 3);

const site = await startSite({ port: Number(process.env.APP_PORT ?? 3472) });
const browser = await chromium.launch({ args: [`--remote-debugging-port=${PORT}`] });
const results = [];
let failed = 0;
try {
  for (const [name, path] of [
    ["home", "/"],
    ["watch", site.watchPath],
    ["channel", site.channelPath],
  ]) {
    // Several runs and the median, since the simulated numbers move a little.
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const out = await lighthouse(site.base + path, { port: PORT, output: "json", logLevel: "error", onlyCategories: CATEGORIES });
      runs.push(out.lhr);
    }
    const median = (key) => {
      const s = runs.map((r) => Math.round((r.categories[key].score ?? 0) * 100)).sort((a, b) => a - b);
      return s[Math.floor(s.length / 2)];
    };
    const scores = Object.fromEntries(CATEGORIES.map((c) => [c, median(c)]));
    const lhr = runs[runs.length - 1];
    const metrics = Object.fromEntries(
      ["first-contentful-paint", "largest-contentful-paint", "total-blocking-time", "cumulative-layout-shift", "speed-index"].map((id) => [id, lhr.audits[id]?.displayValue ?? ""]),
    );
    // What cost points, for the categories we hold to 90.
    const misses = [];
    for (const cat of HELD) {
      for (const ref of lhr.categories[cat].auditRefs) {
        const a = lhr.audits[ref.id];
        if (ref.weight > 0 && a.score !== null && a.score < 0.9) misses.push(`${cat}: ${a.id} (${Math.round(a.score * 100)}) ${a.displayValue ?? ""}`.trim());
      }
    }
    results.push({ page: name, path, scores, metrics, misses, lighthouse: lhr.lighthouseVersion, userAgent: lhr.environment?.hostUserAgent });
    const low = HELD.filter((c) => scores[c] < 90);
    if (low.length) failed++;
    console.log(`${low.length ? "FAIL" : "ok  "} ${name}: ${CATEGORIES.map((c) => `${c} ${scores[c]}`).join(", ")}`);
    console.log(`     ${Object.entries(metrics).map(([k, v]) => `${k} ${v}`).join(", ")}`);
    for (const m of misses) console.log(`     - ${m}`);
  }
} finally {
  await browser.close();
  site.stop();
}

console.log("\nLighthouse (mobile preset, median of " + RUNS + " runs):");
console.log("page     performance  accessibility  best-practices  seo");
for (const r of results) {
  console.log(`${r.page.padEnd(8)} ${String(r.scores.performance).padStart(11)}  ${String(r.scores.accessibility).padStart(13)}  ${String(r.scores["best-practices"]).padStart(14)}  ${String(r.scores.seo).padStart(3)}`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(results, null, 2) + "\n");
if (failed) {
  console.log(`\n${failed} page(s) under 90`);
  process.exit(1);
}
console.log("\nevery page is 90 or more in Performance, Accessibility and Best Practices");
