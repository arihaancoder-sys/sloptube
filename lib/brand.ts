/**
 * The sloptube marks, in one place so the header, the favicon, the press kit
 * and the maintenance page all draw the same thing.
 *
 * The mark is a green blob of slop with two drips and a white wave across it.
 * The Snips mark (short vertical videos) is a single drop with a smaller wave.
 * Both are our own drawings: no play button, no red rectangle.
 */

/** Both marks are drawn on a 24 by 24 grid. */
export const MARK_VIEWBOX = "0 0 24 24";

/** The blob and its two drips, filled with the brand green. */
export const MARK_BLOB =
  "M12 2a8.5 8.5 0 0 1 4.8 15.5V20a1.2 1.2 0 0 1-2.4 0v-1.6a8.5 8.5 0 0 1-4.6.3v1.7a1.6 1.6 0 0 1-3.2 0v-2.9A8.5 8.5 0 0 1 12 2z";

/** The wave across the blob, stroked in white. */
export const MARK_WAVE = "M6.9 10.6c1.3-1.8 2.5-1.8 3.8 0s2.5 1.8 3.8 0 2.5-1.8 3.8 0";

/** The Snips drop. */
export const SNIPS_DROP = "M12 1.8c3.9 5.2 7 8.8 7 13.2a7 7 0 0 1-14 0c0-4.4 3.1-8 7-13.2z";

/** The wave inside the Snips drop. */
export const SNIPS_WAVE = "M8.6 15.4c1.1-1.5 2.3-1.5 3.4 0s2.3 1.5 3.4 0";

/** Brand colors, also set as --mark and --logo-word in app/globals.css. */
export const BRAND = {
  mark: "#16a34a",
  markDark: "#22c55e",
  word: "#15803d",
  wordDark: "#4ade80",
} as const;

/** The mark as a standalone SVG string (press kit, favicon, maintenance page). */
export function markSvg(size = 24, color: string = BRAND.mark): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${MARK_VIEWBOX}">` +
    `<path d="${MARK_BLOB}" fill="${color}"/>` +
    `<path d="${MARK_WAVE}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>` +
    `</svg>`
  );
}

/** The mark and the two tone wordmark ("slop" in green, "tube" in near black). */
export function logoSvg(): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="560" height="120" viewBox="0 0 140 30">` +
    `<g transform="translate(1 2) scale(1.08)"><path d="${MARK_BLOB}" fill="${BRAND.mark}"/>` +
    `<path d="${MARK_WAVE}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/></g>` +
    `<text x="30" y="21" font-family="Roboto, Arial, sans-serif" font-size="20" font-weight="700" letter-spacing="-0.9">` +
    `<tspan fill="${BRAND.word}">slop</tspan><tspan fill="#030303">tube</tspan></text>` +
    `</svg>`
  );
}
