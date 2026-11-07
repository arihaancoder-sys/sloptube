// The subscriptions feed's "Today", "This week" and "Older" headers.
// Days are calendar days in the viewer's time zone: the server renders with
// UTC (offset 0) and the browser buckets again with its own offset after it
// mounts. No imports, so Node can load this file directly.

export type SectionKey = "today" | "week" | "older";

export const SECTION_LABELS: Record<SectionKey, string> = {
  today: "Today",
  week: "This week",
  older: "Older",
};

const DAY = 86_400_000;

/**
 * The day number of a moment for a viewer whose clock is `tzOffsetMin`
 * minutes behind UTC (what Date#getTimezoneOffset() returns: 60 in UTC-1,
 * -120 in UTC+2).
 */
function localDay(ms: number, tzOffsetMin: number): number {
  return Math.floor((ms - tzOffsetMin * 60_000) / DAY);
}

/** Which header a video published at `iso` goes under. */
export function sectionFor(iso: string, now: number, tzOffsetMin = 0): SectionKey {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "older";
  const days = localDay(now, tzOffsetMin) - localDay(t, tzOffsetMin);
  // A clock a little ahead of ours still counts as today.
  if (days <= 0) return "today";
  if (days < 7) return "week";
  return "older";
}

/**
 * Splits a newest first list into its sections, in order, leaving out
 * empty ones. Items keep their order inside a section.
 */
export function bucketSections<T extends { publishedAt: string }>(
  items: T[],
  now: number,
  tzOffsetMin = 0,
): { key: SectionKey; label: string; items: T[] }[] {
  const groups: Record<SectionKey, T[]> = { today: [], week: [], older: [] };
  for (const item of items) groups[sectionFor(item.publishedAt, now, tzOffsetMin)].push(item);
  return (Object.keys(groups) as SectionKey[])
    .filter((k) => groups[k].length > 0)
    .map((k) => ({ key: k, label: SECTION_LABELS[k], items: groups[k] }));
}
