// The Snips shelf on the home feed: where it goes in the grid and what is
// on it. No imports, so Node can load this file directly.

export type ShelfLayout<C, S> = {
  /** Grid cards above the shelf. */
  before: C[];
  /** The shorts on the shelf; empty means no shelf. */
  shelf: S[];
  /** Grid cards below the shelf. */
  after: C[];
};

/**
 * Splits the home grid around the shelf: shorts never show as grid cards
 * while the shelf is there, the shelf has at most `max` shorts with no
 * repeats, and it sits after the first `at` grid cards (at the end when the
 * grid is shorter). The grid flows with `grid-auto-flow: dense`, so the
 * shelf, which spans every column, always starts on a new row and the cards
 * fill the row above it, whatever the column count.
 * Without shorts there is no shelf and the grid is left as it is.
 */
export function groupShelf<C extends { id: string; isShort?: boolean }, S extends { id: string }>(
  cards: C[],
  shorts: S[],
  opts: { at: number; max: number },
): ShelfLayout<C, S> {
  const max = Math.max(0, Math.floor(opts.max));
  const seen = new Set<string>();
  const shelf: S[] = [];
  for (const s of shorts) {
    if (shelf.length >= max) break;
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    shelf.push(s);
  }
  if (shelf.length === 0) return { before: cards, shelf: [], after: [] };
  const grid = cards.filter((c) => !c.isShort && !seen.has(c.id));
  const at = Math.max(0, Math.floor(opts.at));
  return { before: grid.slice(0, at), shelf, after: grid.slice(at) };
}
