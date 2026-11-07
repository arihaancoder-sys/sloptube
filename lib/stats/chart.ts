// Scale helpers for the inline SVG charts: round axis maximums and ticks,
// positions, the line path, the bars and which labels fit. No imports, so
// Node loads it directly.

export type Scale = { max: number; step: number; ticks: number[] };

/** 1, 2, 2.5, 5 or 10 times a power of ten: the step a person would pick. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * pow;
}

/**
 * An axis from 0 that holds `max`, with about `count` steps. `whole` keeps
 * the steps whole numbers (views). All zeros still gets a 0 to 1 axis.
 */
export function niceScale(max: number, count = 4, whole = false): Scale {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  let step = niceStep(top / Math.max(1, count));
  if (whole) step = Math.max(1, Math.ceil(step));
  if (top === 0) step = whole ? 1 : step;
  const n = Math.max(1, Math.ceil(top / step - 1e-9));
  const ticks = Array.from({ length: n + 1 }, (_, i) => round(i * step));
  return { max: round(n * step), step, ticks };
}

const round = (n: number) => Math.round(n * 1e9) / 1e9;

/** Where a value sits on a vertical axis of `height` pixels (0 at the bottom). */
export function yFor(value: number, scale: Scale, height: number): number {
  const v = Math.min(Math.max(0, value), scale.max);
  return height - (scale.max > 0 ? (v / scale.max) * height : 0);
}

/** Where the i-th of n points sits across `width` pixels: the first at 0, the last at width. */
export function xFor(i: number, n: number, width: number): number {
  return n <= 1 ? width / 2 : (i / (n - 1)) * width;
}

/** "M0,10L5,8..." through the values, on a chart of width by height. */
export function linePath(values: number[], scale: Scale, width: number, height: number): string {
  return values
    .map((v, i) => `${i === 0 ? "M" : "L"}${fix(xFor(i, values.length, width))},${fix(yFor(v, scale, height))}`)
    .join("");
}

/** The same line closed down to the axis, for the light fill under it. */
export function areaPath(values: number[], scale: Scale, width: number, height: number): string {
  if (values.length === 0) return "";
  const line = linePath(values, scale, width, height);
  return `${line}L${fix(xFor(values.length - 1, values.length, width))},${height}L${fix(xFor(0, values.length, width))},${height}Z`;
}

export type Bar = { x: number; y: number; width: number; height: number };

/** n bars across `width`, each in its own slot with a gap, at least 1 pixel wide. */
export function bars(values: number[], scale: Scale, width: number, height: number, gap = 0.2): Bar[] {
  const n = values.length;
  if (n === 0) return [];
  const slot = width / n;
  const w = Math.max(1, slot * (1 - gap));
  return values.map((v, i) => {
    const y = yFor(v, scale, height);
    return { x: fix(i * slot + (slot - w) / 2), y: fix(y), width: fix(w), height: fix(height - y) };
  });
}

/** Which of n points the mouse at `x` (0 to width) is nearest to. */
export function nearestIndex(x: number, n: number, width: number): number {
  if (n <= 1 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((x / width) * (n - 1))));
}

/** The slot a bar chart's mouse position is in. */
export function slotIndex(x: number, n: number, width: number): number {
  if (n <= 0 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.floor((x / width) * n)));
}

/**
 * Which of n labels to show so that at most `max` fit: always the first and
 * the last, and evenly spaced ones between.
 */
export function labelIndexes(n: number, max: number): number[] {
  if (n <= 0) return [];
  if (n <= Math.max(2, max)) return Array.from({ length: n }, (_, i) => i);
  const every = Math.ceil((n - 1) / Math.max(1, max - 1));
  const out: number[] = [];
  for (let i = 0; i < n - 1; i += every) out.push(i);
  // Keep the last one, dropping a neighbour that would crowd it.
  if (out.length > 1 && n - 1 - out[out.length - 1] < every / 2) out.pop();
  out.push(n - 1);
  return out;
}

/** "950", "1.2K", "34K", "1.5M": axis labels. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const fmt = (v: number, unit: string) => {
    const r = v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
    return `${r}${unit}`;
  };
  if (a >= 1e9) return fmt(n / 1e9, "B");
  if (a >= 1e6) return fmt(n / 1e6, "M");
  if (a >= 1e3) return fmt(n / 1e3, "K");
  return String(Math.round(n * 10) / 10);
}

const fix = (n: number) => Math.round(n * 100) / 100;
