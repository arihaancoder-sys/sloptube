// The description under a search result: a short window of text around the
// first match, with the matched words in bold. No imports, so Node can load it.

export type Piece = { text: string; bold: boolean };

const WORD = /[\p{L}\p{N}]+/gu;

function fold(s: string): string {
  return s.toLowerCase().replace(/['’]/g, "");
}

/** Does this word match one of the query words? Query words match as prefixes, like the search. */
function matches(word: string, words: string[]): boolean {
  const w = fold(word);
  return words.some((q) => q && w.startsWith(q));
}

/**
 * Splits text into plain and bold pieces: every word that starts with a query
 * word is bold, the rest stays as it was. `words` are lower case.
 */
export function highlight(text: string, words: string[]): Piece[] {
  const out: Piece[] = [];
  const push = (t: string, bold: boolean) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.bold === bold) last.text += t;
    else out.push({ text: t, bold });
  };
  let at = 0;
  for (const m of text.matchAll(WORD)) {
    const i = m.index ?? 0;
    if (!matches(m[0], words)) continue;
    push(text.slice(at, i), false);
    push(m[0], true);
    at = i + m[0].length;
  }
  push(text.slice(at), false);
  return out;
}

/**
 * About two lines of the description: spaces and line breaks collapsed, and
 * when the first match is far in, the text starts a little before it with
 * "..." in front. Cut at a word, with "..." when there is more.
 */
export function snippet(text: string, words: string[], max = 200): string {
  const flat = (text ?? "").replace(/\s+/g, " ").trim();
  if (!flat) return "";
  let start = 0;
  for (const m of flat.matchAll(WORD)) {
    if (matches(m[0], words)) {
      start = m.index ?? 0;
      break;
    }
  }
  let head = "";
  if (start > max / 2) {
    const from = flat.lastIndexOf(" ", start - 30);
    start = from > 0 ? from + 1 : start;
    head = "...";
  } else {
    start = 0;
  }
  let body = flat.slice(start);
  if (body.length > max) {
    const cut = body.lastIndexOf(" ", max);
    body = body.slice(0, cut > max / 2 ? cut : max).trimEnd() + "...";
  }
  return head + body;
}
