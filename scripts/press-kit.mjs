#!/usr/bin/env node
// Copies a few screenshots from shots/ into public/press/ as WebP, for /press.
//
//   node scripts/press-kit.mjs
//
// The list below is what /press shows (lib/launch/press.ts). Run it again
// after the screenshot scripts change a picture. Needs ffmpeg with libwebp.

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { PRESS_SHOTS } from "../lib/launch/press.ts";
import { logoSvg, markSvg } from "../lib/brand.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const out = join(root, "public/press");
mkdirSync(out, { recursive: true });

// --logo-only rewrites the two SVGs and skips the screenshots (no ffmpeg needed).
const logoOnly = process.argv.includes("--logo-only");
for (const shot of logoOnly ? [] : PRESS_SHOTS) {
  const from = join(root, "shots", shot.from);
  const to = join(out, `${shot.name}.webp`);
  execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", from, "-vf", "scale=min(1600\\,iw):-2", "-c:v", "libwebp", "-quality", "80", to]);
  console.log(`${shot.from} -> public/press/${shot.name}.webp`);
}

// The logo and the mark, drawn from lib/brand.ts like LogoMark in components/icons.tsx.
writeFileSync(join(out, "sloptube-logo.svg"), logoSvg() + "\n");
writeFileSync(join(out, "sloptube-mark.svg"), markSvg(240) + "\n");
console.log("public/press/sloptube-logo.svg, public/press/sloptube-mark.svg");
