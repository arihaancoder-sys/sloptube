// The trending score, the same math as feed_videos('trending') in
// supabase/migrations/008_feed.sql. Kept here so the tests pin it down.
// No imports, so Node can load this file directly.

/** Trending looks back this many days. */
export const TRENDING_DAYS = 30;
/** How hard age pulls a video down. */
export const TRENDING_GRAVITY = 1.5;
/** /trending shows this many videos, numbered. */
export const TRENDING_COUNT = 50;

/**
 * views / hours_since_publish ^ 1.5, with the hours at least 1 so a brand new
 * video does not divide by zero. 0 for anything outside the window or broken.
 */
export function trendingScore(views: number, publishedAt: string | number | Date, now: number = Date.now()): number {
  const t = new Date(publishedAt).getTime();
  const v = Number(views);
  if (!Number.isFinite(t) || !Number.isFinite(v) || v <= 0) return 0;
  const hours = (now - t) / 3_600_000;
  if (hours > TRENDING_DAYS * 24) return 0;
  return v / Math.pow(Math.max(hours, 1), TRENDING_GRAVITY);
}
