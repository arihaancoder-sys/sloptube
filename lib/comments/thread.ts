// The comments section's list, as plain functions over plain data: pages
// coming in, replies threaded under their comment, the optimistic row while
// posting, and the "N new comments" pill. The zustand store in
// lib/store/comments.ts only calls these, so the tests can run them on their
// own. No imports from outside this folder, so Node can load this file.

import { compareComments, decodeCursor, newestCursor } from "./cursor.ts";
import type { Comment, CommentsPage } from "./types.ts";

export type RepliesState = {
  items: Comment[];
  /** Cursor for "Show more replies", or null when all are here. */
  next: string | null;
  open: boolean;
  /** At least one page was asked for. */
  loaded: boolean;
};

export type ThreadState = {
  count: number;
  /** Top level comments in the order shown: the pinned one first. */
  top: Comment[];
  next: string | null;
  /** New comments from other people, waiting behind the pill. */
  held: Comment[];
  /** The newest top level comment the page knows about, for the poll. */
  since: string | null;
  replies: Record<string, RepliesState>;
};

export function initialThread(count: number, page: CommentsPage, since: string | null): ThreadState {
  return { count, top: dedupe(page.comments), next: page.next, held: [], since, replies: {} };
}

function dedupe(list: Comment[]): Comment[] {
  const seen = new Set<string>();
  return list.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
}

const keyOf = (c: Comment) => ({ likes: c.likes, createdAt: c.createdAt, id: c.id });

/** The next page of top level comments goes under the ones already shown. */
export function appendPage(s: ThreadState, page: CommentsPage): ThreadState {
  const have = new Set(s.top.map((c) => c.id));
  return { ...s, top: [...s.top, ...page.comments.filter((c) => !have.has(c.id))], next: page.next };
}

/** Where a new comment goes: right under the pinned one, else at the very top. */
function insertAtTop(top: Comment[], add: Comment[]): Comment[] {
  const pinned = top.filter((c) => c.pinned);
  const rest = top.filter((c) => !c.pinned);
  return [...pinned, ...add, ...rest];
}

/**
 * Replies, threaded: one copy of each, oldest first, the ones still posting
 * at the end. A reply that came back from the server replaces the copy the
 * page had.
 */
export function mergeReplies(items: Comment[], incoming: Comment[]): Comment[] {
  const byId = new Map<string, Comment>();
  for (const c of items) byId.set(c.id, c);
  for (const c of incoming) byId.set(c.id, c);
  const all = [...byId.values()];
  const done = all.filter((c) => !c.pending).sort((a, b) => compareComments("replies", keyOf(a), keyOf(b)));
  return [...done, ...all.filter((c) => c.pending)];
}

/**
 * A flat list (top level comments and replies mixed, in any order) as
 * threads: each top level comment in the order given, with its replies
 * oldest first. Replies whose comment is not in the list are left out, and a
 * reply to a reply is put under the top level comment it belongs to.
 */
export function buildThreads(flat: Comment[]): { comment: Comment; replies: Comment[] }[] {
  const byId = new Map(flat.map((c) => [c.id, c]));
  const rootOf = (c: Comment): string | null => {
    let cur: Comment | undefined = c;
    for (let hops = 0; cur?.parentId && hops < 10; hops++) cur = byId.get(cur.parentId);
    return cur && !cur.parentId ? cur.id : null;
  };
  const tops = dedupe(flat.filter((c) => !c.parentId));
  const groups = new Map<string, Comment[]>(tops.map((c) => [c.id, []]));
  for (const c of flat) {
    if (!c.parentId) continue;
    const root = rootOf(c);
    if (root && groups.has(root)) groups.get(root)!.push(c);
  }
  return tops.map((comment) => ({ comment, replies: mergeReplies([], groups.get(comment.id)!) }));
}

/** The replies under one comment came in (a "View replies" or "Show more replies" page). */
export function receiveReplies(s: ThreadState, parentId: string, page: CommentsPage): ThreadState {
  const cur = s.replies[parentId] ?? { items: [], next: null, open: true, loaded: false };
  return {
    ...s,
    replies: { ...s.replies, [parentId]: { items: mergeReplies(cur.items, page.comments), next: page.next, open: true, loaded: true } },
  };
}

export function toggleReplies(s: ThreadState, parentId: string, open: boolean): ThreadState {
  const cur = s.replies[parentId] ?? { items: [], next: null, open: false, loaded: false };
  return { ...s, replies: { ...s.replies, [parentId]: { ...cur, open } } };
}

// Posting ---------------------------------------------------------------------------------

/** The optimistic row: at the top (or at the end of the replies), marked pending. */
export function addPending(s: ThreadState, c: Comment): ThreadState {
  const row = { ...c, pending: true };
  if (!c.parentId) return { ...s, count: s.count + 1, top: insertAtTop(s.top, [row]) };
  const cur = s.replies[c.parentId] ?? { items: [], next: null, open: false, loaded: false };
  return {
    ...patchComment({ ...s, count: s.count + 1 }, c.parentId, (p) => ({ ...p, replyCount: p.replyCount + 1 })),
    replies: { ...s.replies, [c.parentId]: { ...cur, items: mergeReplies(cur.items, [row]) } },
  };
}

/** The server answered: the real row takes the optimistic one's place. */
export function resolvePending(s: ThreadState, tempId: string, real: Comment): ThreadState {
  const swap = (list: Comment[]) => list.map((c) => (c.id === tempId ? real : c));
  if (!real.parentId) return { ...s, top: dedupe(swap(s.top)), held: s.held.filter((c) => c.id !== real.id) };
  const cur = s.replies[real.parentId];
  if (!cur) return s;
  const items = mergeReplies(cur.items.filter((c) => c.id !== tempId), [{ ...real, local: true }]);
  return { ...s, replies: { ...s.replies, [real.parentId]: { ...cur, items } } };
}

/** Posting failed: the optimistic row goes away again. */
export function dropPending(s: ThreadState, tempId: string): ThreadState {
  const top = s.top.find((c) => c.id === tempId);
  if (top) return { ...s, count: Math.max(0, s.count - 1), top: s.top.filter((c) => c.id !== tempId) };
  for (const [parentId, r] of Object.entries(s.replies)) {
    if (!r.items.some((c) => c.id === tempId)) continue;
    const next = patchComment({ ...s, count: Math.max(0, s.count - 1) }, parentId, (p) => ({ ...p, replyCount: Math.max(0, p.replyCount - 1) }));
    return { ...next, replies: { ...s.replies, [parentId]: { ...r, items: r.items.filter((c) => c.id !== tempId) } } };
  }
  return s;
}

// Changes to one comment --------------------------------------------------------------------

/** Change one comment wherever it is shown. */
export function patchComment(s: ThreadState, id: string, fn: (c: Comment) => Comment): ThreadState {
  const map = (list: Comment[]) => (list.some((c) => c.id === id) ? list.map((c) => (c.id === id ? fn(c) : c)) : list);
  const replies: Record<string, RepliesState> = {};
  for (const [k, r] of Object.entries(s.replies)) replies[k] = r.items.some((c) => c.id === id) ? { ...r, items: map(r.items) } : r;
  return { ...s, top: map(s.top), held: map(s.held), replies };
}

/** Where is this comment: top level, a reply under `parentId`, or not here. */
export function findComment(s: ThreadState, id: string): Comment | null {
  for (const c of s.top) if (c.id === id) return c;
  for (const r of Object.values(s.replies)) for (const c of r.items) if (c.id === id) return c;
  return null;
}

/**
 * A comment was deleted. A top level comment with replies stays as "This
 * comment was deleted" so the thread keeps its shape; anything else goes.
 */
export function removeComment(s: ThreadState, id: string): ThreadState {
  const c = findComment(s, id);
  if (!c) return s;
  const count = Math.max(0, s.count - 1);
  if (!c.parentId) {
    if (c.replyCount > 0) {
      return patchComment({ ...s, count }, id, (x) => ({ ...x, deleted: true, body: null, author: null, pinned: false, hearted: false, liked: false }));
    }
    return { ...s, count, top: s.top.filter((x) => x.id !== id) };
  }
  const r = s.replies[c.parentId];
  const next = patchComment({ ...s, count }, c.parentId, (p) => ({ ...p, replyCount: Math.max(0, p.replyCount - 1) }));
  return r ? { ...next, replies: { ...next.replies, [c.parentId]: { ...r, items: r.items.filter((x) => x.id !== id) } } } : next;
}

/** Pinning moves the comment to the top and unpins the one before. Unpinning leaves it where it is. */
export function setPinned(s: ThreadState, id: string, on: boolean): ThreadState {
  if (!on) return patchComment(s, id, (c) => ({ ...c, pinned: false }));
  const top = s.top.map((c) => (c.id === id ? { ...c, pinned: true } : c.pinned ? { ...c, pinned: false } : c));
  const pinned = top.find((c) => c.id === id);
  return { ...s, top: pinned ? [pinned, ...top.filter((c) => c.id !== id)] : top };
}

// The "new comments" pill -------------------------------------------------------------------

/**
 * A poll answer came in: comments the page does not show yet wait behind the
 * pill, newest first. The viewer's own comments are already on the page (as
 * the optimistic row), so they never count as new. `since` moves to the
 * newest comment seen, so the next poll only asks for what came after.
 */
export function receivePoll(s: ThreadState, incoming: Comment[]): ThreadState {
  const shown = new Set([...s.top, ...s.held].map((c) => c.id));
  const fresh = incoming.filter((c) => !c.parentId && !c.deleted && !c.mine && !shown.has(c.id));
  const held = [...s.held, ...dedupe(fresh)].sort((a, b) => compareComments("newest", keyOf(a), keyOf(b)));
  const since = newestCursor([...incoming.filter((c) => !c.parentId), ...s.held].map(keyOf), s.since);
  return { ...s, held, since: pickNewer(s.since, since) };
}

/** Of two since cursors, the one further along. */
function pickNewer(a: string | null, b: string | null): string | null {
  const da = decodeCursor("since", a);
  const db = decodeCursor("since", b);
  if (!da) return db ? b : null;
  if (!db) return a;
  const key = (c: { at: string; id: string }) => ({ likes: 0, createdAt: c.at, id: c.id });
  return compareComments("newest", key(db), key(da)) < 0 ? b : a;
}

/** "1 new comment", "12 new comments", or null when there is nothing to show. */
export function pillLabel(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n === 1 ? "1 new comment" : `${Math.floor(n)} new comments`;
}

/** The pill was clicked: the held comments go to the top (under the pinned one). */
export function showHeld(s: ThreadState): ThreadState {
  if (s.held.length === 0) return s;
  const have = new Set(s.top.map((c) => c.id));
  const add = s.held.filter((c) => !have.has(c.id));
  return { ...s, count: s.count + add.length, top: insertAtTop(s.top, add), held: [] };
}
