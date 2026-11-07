// The history page's day headers: "Today", "Yesterday", then the date
// ("Oct 28", or "Oct 28, 2025" in another year). Days are calendar days in
// the viewer's time zone: the server renders with UTC (offset 0) and the
// browser groups again with its own offset after it mounts, like the
// subscriptions feed. No imports, so Node can load this file directly.

const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The day number of a moment for a viewer whose clock is `tzOffsetMin`
 * minutes behind UTC (Date#getTimezoneOffset(): 60 in UTC-1, -120 in UTC+2).
 */
function localDay(ms: number, tzOffsetMin: number): number {
  return Math.floor((ms - tzOffsetMin * 60_000) / DAY);
}

/** The header for a row watched at `iso`. */
export function historyLabel(iso: string, now: number, tzOffsetMin = 0): { key: string; label: string } {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { key: "unknown", label: "Earlier" };
  const day = localDay(t, tzOffsetMin);
  const diff = localDay(now, tzOffsetMin) - day;
  // A clock a little ahead of ours still counts as today.
  if (diff <= 0) return { key: "today", label: "Today" };
  if (diff === 1) return { key: "yesterday", label: "Yesterday" };
  const local = new Date(day * DAY);
  const thisYear = new Date(localDay(now, tzOffsetMin) * DAY).getUTCFullYear();
  const text = `${MONTHS[local.getUTCMonth()]} ${local.getUTCDate()}`;
  return {
    key: local.toISOString().slice(0, 10),
    label: local.getUTCFullYear() === thisYear ? text : `${text}, ${local.getUTCFullYear()}`,
  };
}

/**
 * Splits a most recent first list into its day groups, in order. Items keep
 * their order inside a group.
 */
export function groupHistory<T extends { watchedAt: string }>(
  items: T[],
  now: number,
  tzOffsetMin = 0,
): { key: string; label: string; items: T[] }[] {
  const groups: { key: string; label: string; items: T[] }[] = [];
  for (const item of items) {
    const { key, label } = historyLabel(item.watchedAt, now, tzOffsetMin);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(item);
    else groups.push({ key, label, items: [item] });
  }
  return groups;
}
