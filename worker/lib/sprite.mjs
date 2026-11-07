// The hover preview sprite and its WebVTT file. Pure functions.
import { SPRITE } from "./limits.mjs";

/**
 * How the sprite is cut: one frame every `everySeconds`, or fewer when the
 * video is so long that it would need more than `maxFrames`.
 * @returns {{ interval: number, count: number, columns: number, rows: number, width: number, height: number }}
 */
export function spritePlan(durationS, opts = SPRITE) {
  const { width, height, everySeconds, maxFrames, columns } = { ...SPRITE, ...opts };
  const d = Math.max(0, Number(durationS) || 0);
  let interval = everySeconds;
  if (d / everySeconds > maxFrames) interval = Math.ceil((d / maxFrames) * 1000) / 1000;
  const count = Math.min(maxFrames, Math.max(1, Math.ceil(d / interval)));
  const cols = Math.min(columns, count);
  return { interval, count, columns: cols, rows: Math.ceil(count / cols), width, height };
}

/** 83.5 -> "00:01:23.500" */
export function vttTime(seconds) {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`;
}

/**
 * The WebVTT file players use to show the right sprite frame on hover:
 * one cue per frame, pointing at its tile with a #xywh= fragment.
 */
export function buildVtt(plan, durationS, image = "sprite.webp") {
  const lines = ["WEBVTT", ""];
  for (let i = 0; i < plan.count; i++) {
    const start = i * plan.interval;
    const end = i === plan.count - 1 ? Math.max(durationS, start + 0.001) : (i + 1) * plan.interval;
    const x = (i % plan.columns) * plan.width;
    const y = Math.floor(i / plan.columns) * plan.height;
    lines.push(`${vttTime(start)} --> ${vttTime(end)}`, `${image}#xywh=${x},${y},${plan.width},${plan.height}`, "");
  }
  return lines.join("\n");
}
