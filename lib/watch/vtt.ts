// The hover preview sprite's WebVTT file (written by worker/lib/sprite.mjs):
// one cue per frame, each pointing at a tile with a #xywh= fragment.
// No imports, so Node can load it directly.

export type SpriteCue = {
  start: number;
  end: number;
  /** The image, resolved against the .vtt file's own URL. */
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

/** "00:01:23.500" or "01:23.500" -> 83.5 */
export function vttSeconds(text: string): number {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3) return NaN;
  const [h, m, s] = parts.length === 3 ? parts : ["0", ...parts];
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Every cue in the file, in order. Broken cues are skipped. */
export function parseSpriteVtt(text: string, vttUrl: string): SpriteCue[] {
  const cues: SpriteCue[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const timing = /^\s*([\d:.]+)\s+-->\s+([\d:.]+)/.exec(lines[i]);
    if (!timing) continue;
    const target = (lines[i + 1] ?? "").trim();
    const m = /^(.*)#xywh=(\d+),(\d+),(\d+),(\d+)$/.exec(target);
    const start = vttSeconds(timing[1]);
    const end = vttSeconds(timing[2]);
    if (!m || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    let url: string;
    try {
      url = new URL(m[1], vttUrl).toString();
    } catch {
      continue;
    }
    cues.push({ start, end, url, x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return cues;
}

/** The cue for a time: the last one that started at or before it. */
export function cueAt(cues: SpriteCue[], t: number): SpriteCue | null {
  if (cues.length === 0 || !Number.isFinite(t)) return null;
  let lo = 0;
  let hi = cues.length - 1;
  if (t < cues[0].start) return cues[0];
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  return cues[lo];
}
