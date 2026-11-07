// The word list matcher and the link counter. Same as moderation_blocked_word(),
// moderation_word_is_valid() and moderation_link_count() in
// supabase/migrations/016_moderation.sql. No imports, so Node loads it directly.

export const WORD_MIN = 2;
export const WORD_MAX = 40;

const WORD = /^[a-z0-9]+([ '-][a-z0-9]+)*\*?$/;

/** The way the admin typed it, as the list keeps it: lowercase, single spaces, trimmed. */
export function cleanWord(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isWord(word: string): boolean {
  return word.length >= WORD_MIN && word.length <= WORD_MAX && WORD.test(word);
}

function pattern(word: string): RegExp {
  const prefix = word.endsWith("*");
  const body = prefix ? word.slice(0, -1) : word;
  // Words only hold [a-z0-9 '-], none of which mean anything in a pattern.
  return new RegExp(`(^|[^a-z0-9])${body}${prefix ? "" : "($|[^a-z0-9])"}`);
}

/**
 * The first listed word (in list order, a to z) found in the text as a whole
 * word, or null. Case does not matter; runs of white space count as one
 * space, so a phrase still matches across a line break. "word*" matches any
 * ending ("scam*" finds "scammers").
 */
export function findBlockedWord(text: string, words: readonly string[]): string | null {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  for (const w of [...words].sort()) {
    if (isWord(w) && pattern(w).test(t)) return w;
  }
  return null;
}

/** Links: http:// or https:// or www. up to the next space. */
export function countLinks(text: string): number {
  return text.match(/(https?:\/\/\S+|www\.\S+)/gi)?.length ?? 0;
}
