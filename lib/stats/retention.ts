// Audience retention: which parts of a video each viewer saw, and the curve.
// Same as stats_reached() and the retention part of rollup_video_stats() in
// supabase/migrations/015_stats.sql. No imports, so Node loads it directly.
//
// A view_events row keeps a 21 bit mask. Bits 0 to 19 are the twenty 5%
// parts of the video (bit k covers k*5% up to (k+1)*5%), bit 20 is "watched
// to the end". Every ping marks the stretch it covers, from its position
// minus the seconds played since the last ping (at most 60) to its position.

export const PARTS = 20;
export const END_BIT = PARTS;
/** Points on the curve: 0%, 5%, ... 95% and the end (100%). */
export const POINTS = PARTS + 1;
const MAX_STRETCH_S = 60;

/** Marks the parts the stretch fromS to toS covers. Same as stats_reached(). */
export function markReached(mask: number, fromS: number, toS: number, durationS: number | null): number {
  let out = mask | 0;
  if (!durationS || durationS <= 0 || !Number.isFinite(fromS) || !Number.isFinite(toS)) return out;
  const lo = Math.max(0, Math.min(fromS, toS));
  const hi = Math.min(Math.max(0, fromS, toS), durationS);
  const first = Math.min(PARTS - 1, Math.floor((lo * PARTS) / durationS));
  const last = Math.min(PARTS - 1, Math.floor((hi * PARTS) / durationS));
  for (let k = first; k <= last; k++) out |= 1 << k;
  if (Math.max(fromS, toS) >= durationS - Math.min(1, durationS * 0.05)) out |= 1 << END_BIT;
  return out;
}

/** One ping as watch_ping marks it: the played seconds before the position, at most 60. */
export function markPing(mask: number, positionS: number, playedS: number, durationS: number | null): number {
  const pos = Math.max(0, durationS && durationS > 0 ? Math.min(positionS, durationS) : positionS);
  const played = Math.min(Math.max(0, playedS || 0), MAX_STRETCH_S);
  return markReached(mask, pos - played, pos, durationS);
}

export type RetentionCounts = { viewers: number; buckets: number[] };

/** The rollup for one video and day: rows with anything marked, and how many marked each bit. */
export function bucketsFromMasks(masks: number[]): RetentionCounts {
  const buckets = Array.from({ length: POINTS }, () => 0);
  let viewers = 0;
  for (const m of masks) {
    if (!m) continue;
    viewers++;
    for (let k = 0; k < POINTS; k++) if (m & (1 << k)) buckets[k]++;
  }
  return { viewers, buckets };
}

/** Days added up, as video_analytics() does for a range. */
export function addCounts(days: RetentionCounts[]): RetentionCounts {
  const buckets = Array.from({ length: POINTS }, () => 0);
  let viewers = 0;
  for (const d of days) {
    viewers += d.viewers;
    for (let k = 0; k < POINTS; k++) buckets[k] += Number(d.buckets[k]) || 0;
  }
  return { viewers, buckets };
}

export type RetentionPoint = { at: number; share: number };

/**
 * The curve: for each 5% point, the share (0 to 100) of the viewers who were
 * still watching there. Empty without viewers, so the card can say so.
 */
export function retentionCurve(counts: RetentionCounts): RetentionPoint[] {
  if (!(counts.viewers > 0)) return [];
  return Array.from({ length: POINTS }, (_, k) => ({
    at: k * (100 / PARTS),
    share: Math.min(100, ((Number(counts.buckets[k]) || 0) / counts.viewers) * 100),
  }));
}

/** Where the curve says the average viewer stopped, as the 2019 card puts it: the first point under half. */
export function halfwayPoint(points: RetentionPoint[]): number | null {
  const hit = points.find((p) => p.share < 50);
  return hit ? hit.at : null;
}
