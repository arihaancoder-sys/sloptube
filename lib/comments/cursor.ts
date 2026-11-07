// Page cursors for comments. Opaque to the browser: it only hands them back.
//
//   top      the last comment's likes, created_at and id: list_comments()
//            orders by (like_count, created_at, id) descending
//   newest   created_at and id, descending
//   replies  created_at and id, ascending (oldest reply first)
//   since    the newest top level comment the page has, for comments_since()
//
// decodeCursor() turns one back into the jsonb the SQL functions take:
// {"likes", "at", "id"}. The timestamp string is kept as Postgres sent it,
// because a JS Date would cut microseconds and the next page could repeat or
// skip a comment. No imports from outside this folder, so Node can load it.

import type { CommentSort } from "./rules.ts";

export type CursorKind = CommentSort | "replies" | "since";
export type CursorValue = { likes: number | null; at: string; id: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAMP = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const TAG: Record<CursorKind, string> = { top: "t", newest: "n", replies: "r", since: "s" };

function toBase64Url(text: string): string {
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    return atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  } catch {
    return null;
  }
}

type Keyed = { likes: number; createdAt: string; id: string };

export function encodeCursor(kind: CursorKind, c: Keyed): string {
  const parts = kind === "top" ? [TAG[kind], String(Math.max(0, Math.floor(c.likes))), c.createdAt, c.id.toLowerCase()] : [TAG[kind], c.createdAt, c.id.toLowerCase()];
  return toBase64Url(parts.join("|"));
}

/** The cursor back for this kind, or null when it is missing, broken, made up or of another kind. */
export function decodeCursor(kind: CursorKind, value: string | null | undefined): CursorValue | null {
  if (!value || value.length > 200) return null;
  const text = fromBase64Url(value);
  if (!text) return null;
  const parts = text.split("|");
  if (parts[0] !== TAG[kind]) return null;
  const [likesText, at, id] = kind === "top" ? parts.slice(1) : [null, ...parts.slice(1)];
  if (parts.length !== (kind === "top" ? 4 : 3) || !at || !id) return null;
  if (!UUID.test(id) || !STAMP.test(at) || Number.isNaN(new Date(at).getTime())) return null;
  let likes: number | null = null;
  if (likesText !== null) {
    if (!/^\d{1,15}$/.test(likesText ?? "")) return null;
    likes = Number(likesText);
  }
  return { likes, at, id: id.toLowerCase() };
}

/**
 * The same order list_comments() and list_replies() use, for merging and
 * for the tests: negative when a comes first.
 */
export function compareComments(kind: CursorKind, a: Keyed, b: Keyed): number {
  const time = Date.parse(a.createdAt) - Date.parse(b.createdAt);
  const ids = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  if (kind === "replies") return time || ids;
  if (kind === "top" && a.likes !== b.likes) return b.likes - a.likes;
  return -time || -ids;
}

/**
 * Does `c` come after the cursor in this order? The keyset filter of the SQL
 * functions: (likes, at, id) < cursor for top, (at, id) < cursor for newest,
 * (at, id) > cursor for replies and since.
 */
export function isAfter(kind: CursorKind, c: Keyed, cursor: CursorValue): boolean {
  const key = { likes: cursor.likes ?? 0, createdAt: cursor.at, id: cursor.id };
  if (kind === "since") return compareComments("replies", key, c) < 0;
  return compareComments(kind, key, c) < 0;
}

/** The next page's cursor: from the last row when the page came back full, else null (the end). */
export function nextCursor(kind: CursorKind, rows: Keyed[], pageSize: number): string | null {
  const last = rows[rows.length - 1];
  return last && rows.length >= pageSize ? encodeCursor(kind, last) : null;
}

/** The newest of these (by created_at, then id), as a since cursor, or `fallback` when there are none. */
export function newestCursor(rows: Keyed[], fallback: string | null = null): string | null {
  let best: Keyed | null = null;
  for (const r of rows) if (!best || compareComments("newest", r, best) < 0) best = r;
  return best ? encodeCursor("since", best) : fallback;
}
