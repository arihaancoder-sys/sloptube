#!/usr/bin/env node
// Draws app/favicon.ico from the mark in lib/brand.ts.
//
//   node scripts/favicon.mjs
//
// Renders the mark at 48 and 32 px with Playwright's Chromium and packs the
// two PNGs into one .ico (PNG entries, which the Turbopack image decoder reads).

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { markSvg } from "../lib/brand.ts";

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const root = resolve(new URL("..", import.meta.url).pathname);
const sizes = [48, 32];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const pngs = [];
for (const size of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${markSvg(size)}`);
  pngs.push(await page.locator("svg").screenshot({ omitBackground: true }));
}
await browser.close();

// ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per image, then the PNGs.
const head = Buffer.alloc(6 + 16 * pngs.length);
head.writeUInt16LE(0, 0);
head.writeUInt16LE(1, 2);
head.writeUInt16LE(pngs.length, 4);
let offset = head.length;
pngs.forEach((png, i) => {
  const at = 6 + 16 * i;
  head.writeUInt8(sizes[i], at);
  head.writeUInt8(sizes[i], at + 1);
  head.writeUInt16LE(1, at + 4);
  head.writeUInt16LE(32, at + 6);
  head.writeUInt32LE(png.length, at + 8);
  head.writeUInt32LE(offset, at + 12);
  offset += png.length;
});
writeFileSync(resolve(root, "app/favicon.ico"), Buffer.concat([head, ...pngs]));
console.log(`app/favicon.ico (${sizes.join(" and ")} px)`);
