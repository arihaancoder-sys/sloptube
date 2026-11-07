// The shorts feed's page cursor: the time the first page was read ("at") and
// the last short's tier, score and id, the keyset list_shorts() pages on.
// Opaque to the browser: it only hands it back. The order is the same as in
// supabase/migrations/013_shorts.sql: tier up (unwatched first), score down,
// id down. Only relative imports, so Node can load this file directly.

import { fromBase64Url, STAMP, toBase64Url, UUID } from "../feed/cursor.ts";

export type ShortsCursor = { at: string; tier: number; score: number; id: string };

/** What a short needs for its place in the order. */
export type ShortKey = { tier: number; score: number; id: string };

/** "MjAy..." for the last short on a page. */
export function encodeShortsCursor(c: ShortsCursor): string {
  return toBase64Url(`${c.at}|${c.tier}|${c.score}|${c.id.toLowerCase()}`);
}

/** The cursor back, or null when it is missing, broken or made up. */
export function decodeShortsCursor(value: string | null | undefined): ShortsCursor | null {
  if (!value || value.length > 300) return null;
  const text = fromBase64Url(value);
  if (!text) return null;
  const parts = text.split("|");
  if (parts.length !== 4) return null;
  const [at, tierText, scoreText, id] = parts;
  if (!STAMP.test(at) || Number.isNaN(new Date(at).getTime())) return null;
  if (tierText !== "0" && tierText !== "1") return null;
  if (!/^\d+(\.\d+)?(e[+-]?\d+)?$/i.test(scoreText)) return null;
  const score = Number(scoreText);
  if (!Number.isFinite(score) || !UUID.test(id)) return null;
  return { at, tier: Number(tierText), score, id: id.toLowerCase() };
}

/** Negative when a comes first. Ids compare as lower case text, like uuid order for this format. */
export function compareShorts(a: ShortKey, b: ShortKey): number {
  if (a.tier !== b.tier) return a.tier - b.tier;
  if (a.score !== b.score) return b.score - a.score;
  const x = a.id.toLowerCase();
  const y = b.id.toLowerCase();
  return x === y ? 0 : x < y ? 1 : -1;
}

/** Does `k` come after the cursor's short? (The rows of the next page.) */
export function isAfterCursor(k: ShortKey, c: ShortKey): boolean {
  return compareShorts(k, c) > 0;
}

/**
 * The cursor for the page after `rows`, or null at the end (a page shorter
 * than asked for). `at` is the time the first page was read.
 */
export function nextShortsCursor(rows: (ShortKey & { asOf: string })[], limit: number): string | null {
  const last = rows[rows.length - 1];
  if (!last || rows.length < limit) return null;
  return encodeShortsCursor({ at: last.asOf, tier: last.tier, score: last.score, id: last.id });
}

/** Adds a page to what is shown, without ids already there (counts can move a short across pages). */
export function mergePage<T extends { id: string }>(shown: T[], page: T[]): T[] {
  const seen = new Set(shown.map((s) => s.id));
  const out = [...shown];
  for (const s of page) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}
