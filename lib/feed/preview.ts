// The hover preview on feed cards: after a second on a card, the sprite's
// frames play in the thumbnail. Only the small sprite image loads, never video.
// No imports, so Node can load this file directly.

/** Hover this long before the preview starts. */
export const PREVIEW_DELAY_MS = 1000;
/** Each frame shows this long. */
export const PREVIEW_STEP_MS = 500;
/** At most this many frames, spread over the whole video. */
export const PREVIEW_FRAMES = 10;

/**
 * Which sprite cues the preview plays: all of them when there are few, else
 * `max` spread evenly from the first to the last.
 */
export function previewFrames(count: number, max: number = PREVIEW_FRAMES): number[] {
  const n = Math.max(0, Math.floor(count));
  const m = Math.max(1, Math.floor(max));
  if (n <= m) return Array.from({ length: n }, (_, i) => i);
  if (m === 1) return [0];
  return Array.from({ length: m }, (_, i) => Math.round((i * (n - 1)) / (m - 1)));
}

/** The frame on screen `elapsedMs` after the preview started. Loops. -1 without frames. */
export function frameAt(frames: number[], elapsedMs: number, stepMs: number = PREVIEW_STEP_MS): number {
  if (frames.length === 0) return -1;
  const step = Math.max(1, stepMs);
  const i = Math.floor(Math.max(0, Number(elapsedMs) || 0) / step) % frames.length;
  return frames[i];
}

export type Tile = { x: number; y: number; w: number; h: number };

/** The whole sprite sheet's size, from its tiles. */
export function sheetSize(tiles: Tile[]): { w: number; h: number } {
  let w = 0;
  let h = 0;
  for (const t of tiles) {
    w = Math.max(w, t.x + t.w);
    h = Math.max(h, t.y + t.h);
  }
  return { w, h };
}

/**
 * CSS that shows one tile scaled to fill its box, whatever the box's size:
 * background-size and background-position in percent.
 */
export function tileStyle(tile: Tile, sheet: { w: number; h: number }): { backgroundSize: string; backgroundPosition: string } {
  const pct = (n: number) => `${Math.round(n * 100) / 100}%`;
  const sizeX = tile.w > 0 ? (sheet.w / tile.w) * 100 : 100;
  const sizeY = tile.h > 0 ? (sheet.h / tile.h) * 100 : 100;
  const posX = sheet.w > tile.w ? (tile.x / (sheet.w - tile.w)) * 100 : 0;
  const posY = sheet.h > tile.h ? (tile.y / (sheet.h - tile.h)) * 100 : 0;
  return { backgroundSize: `${pct(sizeX)} ${pct(sizeY)}`, backgroundPosition: `${pct(posX)} ${pct(posY)}` };
}
