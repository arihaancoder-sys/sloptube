// Recent searches, kept in the browser's localStorage, newest first.
// No imports, so Node can load this file directly.

import { RECENT_LIMIT } from "./rules.ts";

export const RECENT_KEY = "sloptube-recent-searches";

/** The stored list back, or [] when it is missing or broken. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const list: unknown = JSON.parse(raw);
    if (!Array.isArray(list)) return [];
    const out: string[] = [];
    for (const item of list) {
      if (typeof item === "string" && item.trim() && !out.some((x) => x.toLowerCase() === item.toLowerCase())) out.push(item);
    }
    return out.slice(0, RECENT_LIMIT);
  } catch {
    return [];
  }
}

/** A ring of the last ten: the new query goes first, an older copy of it goes, the oldest falls off. */
export function addRecent(list: string[], q: string, limit = RECENT_LIMIT): string[] {
  const query = q.trim();
  if (!query) return list.slice(0, limit);
  return [query, ...list.filter((x) => x.toLowerCase() !== query.toLowerCase())].slice(0, limit);
}

export function removeRecent(list: string[], q: string): string[] {
  return list.filter((x) => x.toLowerCase() !== q.toLowerCase());
}
