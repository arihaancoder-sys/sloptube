// Likes, views, history and resume: the numbers and rules shared by the
// routes, the player and the tests. Keep the numbers in step with
// 011_engagement.sql. No imports, so Node can load this file directly.

/** The player pings this often while playing (and on pause, end and leave). */
export const PING_EVERY_S = 10;

/** Seconds of watching that make a view (or the whole video when shorter). */
export const VIEW_SECONDS = 10;

/** watch_ping calls per minute per viewer key. */
export const PINGS_PER_MINUTE = 20;

/** react calls per minute per person. */
export const REACTIONS_PER_MINUTE = 30;

/** At most this many played seconds count from one ping. */
export const MAX_PLAYED_PER_PING = 60;

/** Resume only past this many seconds... */
export const RESUME_MIN_S = 10;
/** ...and before this share of the video. */
export const RESUME_MAX_FRACTION = 0.9;

/** History rows per page. */
export const HISTORY_PAGE_SIZE = 20;

/** Ids per progress request (my_progress takes at most 100). */
export const PROGRESS_BATCH = 100;

export type Reaction = "like" | "dislike";

export function isReaction(v: unknown): v is Reaction {
  return v === "like" || v === "dislike";
}

/** A short (feature 11) counts at this many seconds instead. Same as SHORT_VIEW_S. */
export const SHORT_VIEW_SECONDS = 3;

/**
 * Seconds of watching that make a view: 10, or the whole video rounded down
 * (at least 1) when it is shorter. 3 for a short (013). Same as
 * view_threshold_s() in SQL.
 */
export function viewThreshold(durationS: number | null | undefined, isShort = false): number {
  if (isShort) {
    if (durationS === null || durationS === undefined || !Number.isFinite(durationS) || durationS <= 0) return SHORT_VIEW_SECONDS;
    return Math.min(SHORT_VIEW_SECONDS, Math.max(1, Math.floor(durationS)));
  }
  if (durationS === null || durationS === undefined || !Number.isFinite(durationS) || durationS <= 0) return VIEW_SECONDS;
  return Math.min(VIEW_SECONDS, Math.max(1, Math.floor(durationS)));
}

/** One viewer's row for one video and one UTC day, as watch_ping keeps it. */
export type ViewDay = { watchedS: number; counted: boolean; openedAt: number };

/**
 * What one ping does to the day's row, the same as watch_ping():
 *   - no row yet: the ping opens it and earns nothing;
 *   - else up to 60 played seconds are added, but the day's total never runs
 *     ahead of the wall clock since the row opened (plus one second);
 *   - the view counts once, when the total reaches viewThreshold().
 * `now` and `openedAt` are milliseconds.
 */
export function applyPing(
  day: ViewDay | null,
  ping: { playedS: number; now: number },
  durationS: number | null,
  isShort = false,
): { day: ViewDay; countedNow: boolean } {
  if (!day) return { day: { watchedS: 0, counted: false, openedAt: ping.now }, countedNow: false };
  const played = Math.min(Math.max(Number(ping.playedS) || 0, 0), MAX_PLAYED_PER_PING);
  const wall = Math.floor(Math.max(0, ping.now - day.openedAt) / 1000) + 1;
  const watchedS = Math.max(day.watchedS, Math.min(day.watchedS + Math.floor(played), wall));
  const countedNow = !day.counted && watchedS >= viewThreshold(durationS, isShort);
  return { day: { ...day, watchedS, counted: day.counted || countedNow }, countedNow };
}

/** The UTC day a ping belongs to, "2026-11-04". A new day starts a new view. */
export function viewDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Where the player starts from a saved position: past 10 seconds and before
 * 90 percent it resumes there, else from the top (0).
 */
export function resumeAt(positionS: number | null | undefined, durationS: number | null | undefined): number {
  const p = Number(positionS);
  const d = Number(durationS);
  if (!Number.isFinite(p) || p <= RESUME_MIN_S) return 0;
  if (Number.isFinite(d) && d > 0 && p >= d * RESUME_MAX_FRACTION) return 0;
  return Math.floor(p);
}

/** How much of the video was watched, 0 to 1, for the red bar. */
export function progressFraction(positionS: number | null | undefined, durationS: number | null | undefined): number {
  const p = Number(positionS);
  const d = Number(durationS);
  if (!Number.isFinite(p) || !Number.isFinite(d) || d <= 0 || p <= 0) return 0;
  return Math.min(1, p / d);
}

/** The codes the database raises, and what the page says. */
const MESSAGES: Record<string, string> = {
  not_signed_in: "Sign in to like videos.",
  engagement_off: "Likes aren't on yet.",
  not_found: "This video isn't there anymore.",
  rate_limited: "You're doing that very fast. Try again in a bit.",
  bad_kind: "Something went wrong. Try again.",
  no_viewer_key: "Something went wrong. Try again.",
  not_set_up: "Likes and history aren't set up yet.",
  no_db: "Database not connected.",
};

/** The error code from a database message, or "failed". */
export function engagementErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function engagementErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status a route answers for an error code. */
export function engagementStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "engagement_off":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "bad_request":
    case "bad_kind":
    case "no_viewer_key":
      return 400;
    default:
      return 503;
  }
}
