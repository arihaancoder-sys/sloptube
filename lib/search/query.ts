// The search query and the filters: what the URL says, what the database gets.
// Only relative imports, so Node can load this file directly.

import { MAX_QUERY_LENGTH } from "./rules.ts";

/**
 * The query as it is searched and shown: apostrophes dropped ("don't" is
 * "dont"), other punctuation and symbols turned into spaces, spaces collapsed,
 * trimmed, at most 100 characters. Case is kept for the page title and the
 * box; the database lowers it. Keep in step with search_normalize() in SQL.
 */
export function normalizeQuery(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const clean = raw
    .normalize("NFC")
    .replace(/['’]/g, "")
    .replace(/[\p{P}\p{S}\p{C}\s]+/gu, " ")
    .trim();
  return Array.from(clean).slice(0, MAX_QUERY_LENGTH).join("").trim();
}

/** The lower case words of a query, for highlighting. */
export function queryWords(q: string): string[] {
  const words = normalizeQuery(q).toLowerCase().split(" ").filter(Boolean);
  return [...new Set(words)];
}

export const UPLOADED = ["hour", "today", "week", "month", "year"] as const;
export const TYPES = ["video", "channel"] as const;
export const DURATIONS = ["short", "medium", "long"] as const;
export const SORTS = ["relevance", "date", "views"] as const;

export type SearchFilters = {
  uploaded?: (typeof UPLOADED)[number];
  type?: (typeof TYPES)[number];
  duration?: (typeof DURATIONS)[number];
  sort?: (typeof SORTS)[number];
};

export type FilterKey = keyof SearchFilters;

/** The filter panel, column by column, 2019 order and wording. */
export const FILTER_GROUPS: { key: FilterKey; label: string; options: { value: string; label: string }[] }[] = [
  {
    key: "uploaded",
    label: "Upload date",
    options: [
      { value: "hour", label: "Last hour" },
      { value: "today", label: "Today" },
      { value: "week", label: "This week" },
      { value: "month", label: "This month" },
      { value: "year", label: "This year" },
    ],
  },
  {
    key: "type",
    label: "Type",
    options: [
      { value: "video", label: "Video" },
      { value: "channel", label: "Channel" },
    ],
  },
  {
    key: "duration",
    label: "Duration",
    options: [
      { value: "short", label: "Short (< 4 minutes)" },
      { value: "medium", label: "Medium (4 to 20 minutes)" },
      { value: "long", label: "Long (> 20 minutes)" },
    ],
  },
  {
    key: "sort",
    label: "Sort by",
    options: [
      { value: "relevance", label: "Relevance" },
      { value: "date", label: "Upload date" },
      { value: "views", label: "View count" },
    ],
  },
];

const ALLOWED: Record<FilterKey, readonly string[]> = { uploaded: UPLOADED, type: TYPES, duration: DURATIONS, sort: SORTS };
const ORDER: FilterKey[] = ["uploaded", "type", "duration", "sort"];

type ParamSource = URLSearchParams | Record<string, string | string[] | undefined>;

function read(params: ParamSource, key: string): string | undefined {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === "string" ? one : undefined;
}

/** The query from ?search_query= (the 2019 URL). */
export function readQuery(params: ParamSource): string {
  return normalizeQuery(read(params, "search_query"));
}

/** The filters from the URL. Unknown values are dropped; relevance is the default. */
export function parseFilters(params: ParamSource): SearchFilters {
  const out: SearchFilters = {};
  for (const key of ORDER) {
    const v = read(params, key);
    if (v && ALLOWED[key].includes(v) && !(key === "sort" && v === "relevance")) {
      (out as Record<string, string>)[key] = v;
    }
  }
  return out;
}

/**
 * What search_videos() gets as its filters jsonb. Type is not in it: it
 * picks which functions run. Sort is always set.
 */
export function filtersToSql(f: SearchFilters): { uploaded?: string; duration?: string; sort: string } {
  const out: { uploaded?: string; duration?: string; sort: string } = { sort: f.sort ?? "relevance" };
  if (f.uploaded) out.uploaded = f.uploaded;
  if (f.duration) out.duration = f.duration;
  return out;
}

/** Duration bounds in seconds, as search_videos() uses them. */
export function durationBounds(d: SearchFilters["duration"]): { min?: number; max?: number } {
  if (d === "short") return { max: 240 };
  if (d === "medium") return { min: 240, max: 1200 };
  if (d === "long") return { min: 1200 };
  return {};
}

/** Does this page show videos, channels, or both? */
export function showsVideos(f: SearchFilters): boolean {
  return f.type !== "channel";
}
export function showsChannels(f: SearchFilters): boolean {
  // Channels have no upload date or duration, so those filters hide them.
  if (f.type === "video") return false;
  if (f.type === "channel") return true;
  return !f.uploaded && !f.duration && (f.sort ?? "relevance") === "relevance";
}

/** The URL params: search_query first, then the filters in panel order. */
export function searchParamsFor(q: string, f: SearchFilters = {}): URLSearchParams {
  const p = new URLSearchParams({ search_query: q });
  for (const key of ORDER) {
    const v = f[key];
    if (v && !(key === "sort" && v === "relevance")) p.set(key, v);
  }
  return p;
}

export function resultsHref(q: string, f: SearchFilters = {}): string {
  return `/results?${searchParamsFor(q, f)}`;
}

/** Clicking a filter: picks it, or clears it when it was already picked. */
export function toggleFilter(f: SearchFilters, key: FilterKey, value: string): SearchFilters {
  const next = { ...f } as Record<string, string | undefined>;
  if (next[key] === value || (key === "sort" && value === "relevance")) delete next[key];
  else if (ALLOWED[key].includes(value)) next[key] = value;
  return next as SearchFilters;
}

export function isActive(f: SearchFilters, key: FilterKey, value: string): boolean {
  return key === "sort" ? (f.sort ?? "relevance") === value : f[key] === value;
}
