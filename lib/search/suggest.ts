// Suggestions in the search box. No imports, so Node can load this file directly.

import { SUGGEST_LIMIT } from "./rules.ts";

/** Lower case, spaces collapsed, no repeats, no blanks, at most `limit`. */
export function dedupeSuggestions(list: unknown, limit = SUGGEST_LIMIT): string[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const s = item.toLowerCase().replace(/\s+/g, " ").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * A suggestion split for the 2019 look: what was typed stays normal, the rest
 * is bold. When the suggestion does not start with what was typed, all of it
 * is bold.
 */
export function splitSuggestion(suggestion: string, typed: string): { typed: string; rest: string } {
  const t = typed.toLowerCase().replace(/\s+/g, " ").trimStart();
  if (t && suggestion.startsWith(t)) return { typed: suggestion.slice(0, t.length), rest: suggestion.slice(t.length) };
  return { typed: "", rest: suggestion };
}
