// The search page cursor: the last card's sort key and id, the keyset
// search_videos() pages on. Opaque to the browser: it only hands it back.
// No imports, so Node can load this file directly.

export type SearchCursor = { key: number; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** String(number) round trips a double exactly, so the next page starts right after. */
export function encodeSearchCursor(c: SearchCursor): string {
  return btoa(`${String(c.key)}|${c.id.toLowerCase()}`).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeSearchCursor(value: string | null | undefined): SearchCursor | null {
  if (!value || value.length > 200 || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  let text: string;
  try {
    text = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
  const [k, id, ...rest] = text.split("|");
  if (rest.length || !k || !id || !UUID.test(id) || !/^-?[0-9.eE+-]+$/.test(k)) return null;
  const key = Number(k);
  if (!Number.isFinite(key)) return null;
  return { key, id: id.toLowerCase() };
}
