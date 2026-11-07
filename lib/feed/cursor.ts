// The feed's page cursor: the last card's published_at and id, the keyset
// feed_videos() pages on. Opaque to the browser: it only hands it back.
// No imports, so Node can load this file directly.

export type FeedCursor = { publishedAt: string; id: string };

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What Postgres hands back for a timestamptz: microseconds and an offset.
// The string is kept as is, because a JS Date would cut it to milliseconds
// and the next page could then repeat or skip a video.
export const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;

/** Text to URL safe base64 without padding. Also used by the shorts cursor. */
export function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** The text back, or null when it is not URL safe base64. */
export function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

/** "MjAyNi0x..." for the last card on a page. */
export function encodeCursor(c: FeedCursor): string {
  return toBase64Url(`${c.publishedAt}|${c.id.toLowerCase()}`);
}

/** The cursor back, or null when it is missing, broken or made up. */
export function decodeCursor(value: string | null | undefined): FeedCursor | null {
  if (!value || value.length > 200) return null;
  const text = fromBase64Url(value);
  if (!text) return null;
  const [publishedAt, id, ...rest] = text.split("|");
  if (rest.length || !publishedAt || !id) return null;
  if (!UUID.test(id) || !STAMP.test(publishedAt) || Number.isNaN(new Date(publishedAt).getTime())) return null;
  return { publishedAt, id: id.toLowerCase() };
}
