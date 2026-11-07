// Times, counts and dates the watch page and the player show.
// No imports on purpose, so Node can load this file directly in the tests.

/**
 * Player time, YouTube style: 0:05, 1:05, 12:05, 1:02:05.
 * Negative, NaN and Infinity show as 0:00.
 */
export function formatTime(seconds: number): string {
  const total = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * The start time from a shared link: ?t=90, ?t=90s, ?t=1m30s, ?t=1h2m3s.
 * Returns whole seconds, or 0 when it cannot be read.
 */
export function parseStart(value: string | null | undefined): number {
  if (!value) return 0;
  const v = value.trim().toLowerCase();
  if (/^\d+$/.test(v)) return Number(v);
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(v);
  if (!m || v === "") return 0;
  return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
}

/** The value for ?t= in a shared link: 90 -> "90". Whole seconds, never negative. */
export function startParam(seconds: number): string {
  return String(Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0)));
}

/** "1,234 views" under the title, the full number like 2019. */
export function formatViews(views: number): string {
  const n = Math.max(0, Math.floor(Number(views) || 0));
  return n === 1 ? "1 view" : `${n.toLocaleString("en-US")} views`;
}

/** 2019 short counts for the Up next cards: 999, 1.2K, 12K, 1.2M. */
export function shortCount(n: number): string {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  for (const [size, suffix] of [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const) {
    if (v >= size) {
      const x = v / size;
      const text = x < 10 ? (Math.floor(x * 10) / 10).toFixed(1).replace(/\.0$/, "") : String(Math.floor(x));
      return text + suffix;
    }
  }
  return String(v);
}

/** "Nov 4, 2026", the date under a 2019 watch page title. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "3 days ago" for the Up next cards. `now` is passed in so tests are stable. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.floor((now - t) / 1000));
  const steps: [number, string][] = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, unit] of steps) {
    if (s >= size) {
      const n = Math.floor(s / size);
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "Just now";
}
