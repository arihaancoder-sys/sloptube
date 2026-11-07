// The analytics numbers, ranges and words. Keep them in step with
// supabase/migrations/015_stats.sql. No imports, so Node loads it directly.

export const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// Ranges ---------------------------------------------------------------------------------

export const RANGES = ["7d", "28d", "90d", "lifetime"] as const;
export type Range = (typeof RANGES)[number];
export const DEFAULT_RANGE: Range = "28d";

export const RANGE_LABELS: Record<Range, string> = {
  "7d": "Last 7 days",
  "28d": "Last 28 days",
  "90d": "Last 90 days",
  lifetime: "Lifetime",
};

const RANGE_DAYS: Record<Exclude<Range, "lifetime">, number> = { "7d": 7, "28d": 28, "90d": 90 };

/** ?range=90d -> "90d"; anything else -> the default. */
export function parseRange(value: unknown): Range {
  const v = Array.isArray(value) ? value[0] : value;
  return (RANGES as readonly string[]).includes(String(v)) ? (v as Range) : DEFAULT_RANGE;
}

/** "2026-11-04" for a moment, in UTC (the days the database counts in). */
export function utcDay(at: number | Date): string {
  return new Date(at).toISOString().slice(0, 10);
}

/** Moves a "YYYY-MM-DD" day by n days. */
export function addDays(day: string, n: number): string {
  return utcDay(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS);
}

/** Days from `from` to `to`, both counted. 0 when `to` is before `from`. */
export function daysBetween(from: string, to: string): number {
  const n = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export type Bounds = { from: string; to: string; days: number };

/**
 * The first and last day of a range seen at `now`, same as stats_range_from():
 * n days end today (UTC) and start n - 1 days before. Lifetime starts on
 * `lifetimeFrom` (the day the channel or the video was made), never after today.
 */
export function rangeBounds(range: Range, now: number = Date.now(), lifetimeFrom?: string | null): Bounds {
  const to = utcDay(now);
  let from: string;
  if (range === "lifetime") {
    from = lifetimeFrom && /^\d{4}-\d{2}-\d{2}/.test(lifetimeFrom) ? lifetimeFrom.slice(0, 10) : to;
    if (from > to) from = to;
  } else {
    from = addDays(to, -(RANGE_DAYS[range] - 1));
  }
  return { from, to, days: daysBetween(from, to) };
}

export type DayPoint = { day: string; views: number; watchS: number };

/** The daily rows with a zero for every day without one, from `from` to `to`. */
export function fillDays(rows: DayPoint[], from: string, to: string): DayPoint[] {
  const byDay = new Map(rows.map((r) => [r.day.slice(0, 10), r]));
  const out: DayPoint[] = [];
  const n = Math.min(daysBetween(from, to), 5000);
  for (let i = 0; i < n; i++) {
    const day = addDays(from, i);
    const r = byDay.get(day);
    out.push({ day, views: r?.views ?? 0, watchS: r?.watchS ?? 0 });
  }
  return out;
}

export const REALTIME_HOURS = 48;
export type HourPoint = { hour: number; views: number };

/** The last 48 hours, oldest first, the current hour last, with a zero for every hour without views. */
export function fillHours(rows: { hour: string | number; views: number }[], now: number = Date.now()): HourPoint[] {
  const top = Math.floor(now / HOUR_MS) * HOUR_MS;
  const byHour = new Map<number, number>();
  for (const r of rows) {
    const t = typeof r.hour === "number" ? r.hour : Date.parse(r.hour);
    if (Number.isFinite(t)) {
      const h = Math.floor(t / HOUR_MS) * HOUR_MS;
      byHour.set(h, (byHour.get(h) ?? 0) + r.views);
    }
  }
  return Array.from({ length: REALTIME_HOURS }, (_, i) => {
    const hour = top - (REALTIME_HOURS - 1 - i) * HOUR_MS;
    return { hour, views: byHour.get(hour) ?? 0 };
  });
}

// Traffic sources -----------------------------------------------------------------------------

/** Same as stats_source_is_valid(). */
export const SOURCES = ["home", "search", "subscriptions", "channel", "shorts", "other", "direct", "external"] as const;
export type Source = (typeof SOURCES)[number];

export const SOURCE_LABELS: Record<Source, string> = {
  home: "Browse features",
  search: "sloptube search",
  subscriptions: "Subscriptions",
  channel: "Channel pages",
  shorts: "Snips feed",
  other: "Other sloptube features",
  direct: "Direct or unknown",
  external: "External",
};

export function isSource(v: unknown): v is Source {
  return typeof v === "string" && (SOURCES as readonly string[]).includes(v);
}

// Numbers ----------------------------------------------------------------------------------------

/** Average view duration in seconds: watch time over views. 0 without views. */
export function averageViewS(watchS: number, views: number): number {
  return views > 0 ? Math.max(0, watchS) / views : 0;
}

/** Average percentage viewed, 0 to 100: the average view over the length. null without a length. */
export function averagePercent(watchS: number, views: number, durationS: number | null): number | null {
  if (!durationS || durationS <= 0) return null;
  return Math.min(100, (averageViewS(watchS, views) / durationS) * 100);
}

/** Likes as a share of likes and dislikes, 0 to 100, or null with neither. */
export function likeShare(likes: number, dislikes: number): number | null {
  const all = Math.max(0, likes) + Math.max(0, dislikes);
  return all > 0 ? (Math.max(0, likes) / all) * 100 : null;
}

/** "3:07", "1:02:03": a duration for the cards. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "+12", "-3", "0" for subscribers gained minus lost. */
export function signed(n: number): string {
  return n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US");
}

/** "12.3%", "100%", "0%". */
export function percent(n: number): string {
  if (!Number.isFinite(n)) return "0%";
  const r = Math.round(n * 10) / 10;
  return `${Number.isInteger(r) ? r : r.toFixed(1)}%`;
}

// Errors ------------------------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  stats_off: "Analytics aren't on yet.",
  studio_off: "The studio isn't on yet.",
  not_signed_in: "Sign in to see your analytics.",
  not_found: "That video is gone.",
  not_allowed: "Only the channel owner can see these numbers.",
  rate_limited: "That's a lot of reloads. Wait a minute and try again.",
  bad_range: "Pick 7, 28 or 90 days, or lifetime.",
  bad_request: "Something was off with that request.",
};

/** The code in a database error message, like "stats_off". */
export function statsErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function statsErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status for an error code. */
export function statsStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "stats_off":
    case "studio_off":
    case "not_allowed":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "no_db":
    case "not_set_up":
      return 503;
    case "failed":
      return 500;
    default:
      return 400;
  }
}

// Labels -------------------------------------------------------------------------------------------

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** "Nov 4" for an axis. Days are UTC days, so no time zone can move them. */
export function dayLabel(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** "Wed, Nov 4, 2026" for a tooltip. */
export function dayTitle(day: string): string {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

/** "1 view", "1,204 views". */
export function viewsText(n: number): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? "view" : "views"}`;
}
