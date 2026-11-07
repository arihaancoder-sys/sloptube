// Feature 10: the pure parts of comments. The keyset paging and the rate
// limits run in SQL (012_comments.sql); the same order and the messages the
// page shows are tested here, with the list logic the store runs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareComments, decodeCursor, encodeCursor, isAfter, newestCursor, nextCursor } from "../lib/comments/cursor.ts";
import {
  bodyProblem,
  cleanBody,
  commentsErrorCode,
  commentsErrorMessage,
  commentsHeader,
  commentsStatus,
  estimateLines,
  mentionPrefix,
  needsReadMore,
  parseSort,
  splitMention,
  viewRepliesLabel,
} from "../lib/comments/rules.ts";
import {
  addPending,
  appendPage,
  buildThreads,
  dropPending,
  initialThread,
  mergeReplies,
  pillLabel,
  receivePoll,
  receiveReplies,
  removeComment,
  resolvePending,
  setPinned,
  showHeld,
} from "../lib/comments/thread.ts";
import { rowToComment } from "../lib/comments/types.ts";

const id = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const at = (min) => `2026-11-04T12:${String(min).padStart(2, "0")}:00.123456+00:00`;
function c(n, extra = {}) {
  return {
    id: id(n),
    videoId: "v",
    parentId: null,
    body: `comment ${n}`,
    likes: 0,
    replyCount: 0,
    pinned: false,
    hearted: false,
    createdAt: at(n),
    editedAt: null,
    deleted: false,
    author: { handle: `user${n}`, name: `User ${n}`, avatarUrl: null },
    byOwner: false,
    mine: false,
    liked: false,
    ...extra,
  };
}
const key = (x) => ({ likes: x.likes, createdAt: x.createdAt, id: x.id });

// Cursors and sort order --------------------------------------------------------------

test("cursor: round trip per kind, microseconds kept", () => {
  const x = { likes: 12, createdAt: at(5), id: id(5).toUpperCase() };
  assert.deepEqual(decodeCursor("top", encodeCursor("top", x)), { likes: 12, at: at(5), id: id(5) });
  assert.deepEqual(decodeCursor("newest", encodeCursor("newest", x)), { likes: null, at: at(5), id: id(5) });
  assert.deepEqual(decodeCursor("replies", encodeCursor("replies", x)), { likes: null, at: at(5), id: id(5) });
});

test("cursor: another kind, broken or made up values are refused", () => {
  const top = encodeCursor("top", { likes: 1, createdAt: at(1), id: id(1) });
  assert.equal(decodeCursor("newest", top), null, "a top cursor is not a newest cursor");
  assert.equal(decodeCursor("top", null), null);
  assert.equal(decodeCursor("top", "!!!"), null);
  assert.equal(decodeCursor("top", btoa("t|x|2026-11-04T12:00:00Z|" + id(1))), null, "likes must be a number");
  assert.equal(decodeCursor("newest", btoa("n|yesterday|" + id(1))), null);
  assert.equal(decodeCursor("newest", btoa("n|2026-11-04T12:00:00Z|not-a-uuid")), null);
  assert.equal(decodeCursor("newest", "a".repeat(300)), null);
});

test("sort: top is likes first, then newest, then id; newest is time then id", () => {
  const list = [c(1, { likes: 5 }), c(2, { likes: 9 }), c(3, { likes: 5 }), c(4)];
  const top = [...list].sort((a, b) => compareComments("top", key(a), key(b))).map((x) => x.body);
  assert.deepEqual(top, ["comment 2", "comment 3", "comment 1", "comment 4"]);
  const newest = [...list].sort((a, b) => compareComments("newest", key(a), key(b))).map((x) => x.body);
  assert.deepEqual(newest, ["comment 4", "comment 3", "comment 2", "comment 1"]);
  const replies = [...list].sort((a, b) => compareComments("replies", key(a), key(b))).map((x) => x.body);
  assert.deepEqual(replies, ["comment 1", "comment 2", "comment 3", "comment 4"]);
  // Same time and likes: the id breaks the tie, the same way in every page.
  const tie = [c(7, { createdAt: at(1) }), c(8, { createdAt: at(1) })];
  assert.deepEqual(tie.sort((a, b) => compareComments("newest", key(a), key(b))).map((x) => x.id), [id(8), id(7)]);
});

test("sort: paging with the cursor walks every comment once, in both sorts", () => {
  const all = Array.from({ length: 23 }, (_, i) => c(i + 1, { likes: (i * 7) % 5, createdAt: at(i % 4) }));
  for (const sort of ["top", "newest"]) {
    const ordered = [...all].sort((a, b) => compareComments(sort, key(a), key(b)));
    const seen = [];
    let cursor = null;
    for (let guard = 0; guard < 10; guard++) {
      const after = decodeCursor(sort, cursor);
      const page = ordered.filter((x) => !after || isAfter(sort, key(x), after)).slice(0, 5);
      seen.push(...page.map((x) => x.id));
      cursor = nextCursor(sort, page.map(key), 5);
      if (!cursor) break;
    }
    assert.deepEqual(seen, ordered.map((x) => x.id), `${sort} pages`);
  }
});

test("sort: a short page ends the list; the newest cursor picks the latest", () => {
  assert.equal(nextCursor("newest", [key(c(1))], 20), null);
  assert.ok(nextCursor("newest", Array.from({ length: 20 }, (_, i) => key(c(i))), 20));
  const since = decodeCursor("since", newestCursor([c(3), c(9), c(1)].map(key)));
  assert.equal(since.id, id(9));
  assert.equal(newestCursor([], "keep"), "keep");
  assert.equal(parseSort("newest"), "newest");
  assert.equal(parseSort("bogus"), "top");
});

// Bodies and messages ----------------------------------------------------------------------

test("body: cleaned like the database, empty and too long are caught before sending", () => {
  assert.equal(cleanBody("  hello\r\n\n\n\nworld  "), "hello\n\nworld");
  assert.equal(bodyProblem("   \n "), "bad_body");
  assert.equal(bodyProblem("x".repeat(2000)), null);
  assert.equal(bodyProblem("x".repeat(2001)), "body_too_long");
  assert.equal(bodyProblem("😀".repeat(2000)), null, "characters, not UTF-16 units");
});

test("rate limits: each limit says what it is and answers 429", () => {
  assert.equal(commentsErrorMessage("rate_limited_minute"), "You can post 10 comments a minute. Wait a moment and try again.");
  assert.equal(commentsErrorMessage("rate_limited_day"), "You've posted 100 comments today. Try again tomorrow.");
  assert.equal(commentsErrorMessage("rate_limited_new"), "New accounts can post 3 comments a minute. Wait a moment and try again.");
  for (const code of ["rate_limited_minute", "rate_limited_day", "rate_limited_new", "rate_limited"]) {
    assert.equal(commentsErrorCode(code), code);
    assert.equal(commentsStatus(code), 429);
  }
  assert.equal(commentsErrorCode("permission denied for function post_comment"), "not_signed_in");
  assert.equal(commentsErrorCode("something odd"), "failed");
  assert.equal(commentsErrorMessage("failed"), "Something went wrong. Try again.");
  assert.equal(commentsStatus("comments_off"), 403);
  assert.equal(commentsStatus("not_signed_in"), 401);
  assert.equal(commentsStatus("body_too_long"), 400);
  assert.equal(commentsStatus("no_db"), 503);
});

test("labels: header, View replies, the pill", () => {
  assert.equal(commentsHeader(0), "0 Comments");
  assert.equal(commentsHeader(1), "1 Comment");
  assert.equal(commentsHeader(1234), "1,234 Comments");
  assert.equal(viewRepliesLabel(1), "View reply");
  assert.equal(viewRepliesLabel(12), "View 12 replies");
  assert.equal(pillLabel(0), null);
  assert.equal(pillLabel(1), "1 new comment");
  assert.equal(pillLabel(3), "3 new comments");
});

test("read more: four lines fold, counting line breaks and wrapping", () => {
  assert.equal(estimateLines("short", 80), 1);
  assert.equal(estimateLines("a\nb\nc", 80), 3);
  assert.equal(estimateLines("x".repeat(200), 80), 3);
  assert.equal(estimateLines("\n\n", 80), 3, "empty lines still take a line");
  assert.equal(needsReadMore("a\nb\nc\nd", 80), false, "exactly four lines fit");
  assert.equal(needsReadMore("a\nb\nc\nd\ne", 80), true);
  assert.equal(needsReadMore("x".repeat(321), 80), true);
  assert.equal(needsReadMore("x".repeat(320), 80), false);
  assert.equal(needsReadMore("", 80), false);
  assert.equal(needsReadMore(null, 80), false);
});

test("mentions: replies to replies start with @handle, shown as a link", () => {
  assert.equal(mentionPrefix("samplekitchen"), "@samplekitchen ");
  assert.equal(mentionPrefix("@@x.y_z"), "@x.y_z ");
  assert.equal(mentionPrefix(""), "");
  assert.deepEqual(splitMention("@sample_kitchen thanks!"), { mention: "@sample_kitchen", rest: " thanks!" });
  assert.deepEqual(splitMention("no mention"), { mention: null, rest: "no mention" });
  assert.deepEqual(splitMention("email@x.com"), { mention: null, rest: "email@x.com" });
});

test("rows: deleted comments lose the body and the author", () => {
  const row = {
    id: id(1), video_id: "v", parent_id: null, body: "", like_count: "3", reply_count: 2, pinned: false, hearted: true,
    created_at: at(1), edited_at: null, deleted: true, author_handle: null, author_name: null, author_avatar_url: null,
    by_owner: false, mine: true, liked: false,
  };
  const x = rowToComment(row);
  assert.equal(x.body, null);
  assert.equal(x.author, null);
  assert.equal(x.likes, 3);
  assert.equal(x.replyCount, 2);
  const live = rowToComment({ ...row, deleted: false, body: "hi", author_handle: "h", author_name: "" });
  assert.deepEqual(live.author, { handle: "h", name: "h", avatarUrl: null });
});

// Threading ----------------------------------------------------------------------------------

test("threads: replies go under their comment, oldest first, a reply to a reply under the top one", () => {
  const top1 = c(1);
  const top2 = c(2);
  const r1 = c(10, { parentId: top1.id });
  const r2 = c(5, { parentId: top1.id });
  const rr = c(12, { parentId: r2.id });
  const orphan = c(13, { parentId: id(99) });
  const threads = buildThreads([r1, top2, rr, top1, orphan, r2]);
  assert.deepEqual(threads.map((t) => t.comment.id), [top2.id, top1.id], "top level order is kept");
  assert.deepEqual(threads[1].replies.map((r) => r.id), [r2.id, r1.id, rr.id]);
  assert.deepEqual(threads[0].replies, []);
  assert.equal(threads.flatMap((t) => t.replies).some((r) => r.id === orphan.id), false, "orphans are left out");
});

test("threads: merging pages keeps one copy, the server's wins, posting ones stay last", () => {
  const a = c(1, { parentId: "p" });
  const b = c(2, { parentId: "p" });
  const pending = c(3, { parentId: "p", id: "pending-1", pending: true, createdAt: at(0) });
  const merged = mergeReplies([b, pending], [a, { ...b, likes: 4 }]);
  assert.deepEqual(merged.map((x) => x.id), [a.id, b.id, "pending-1"]);
  assert.equal(merged[1].likes, 4);
});

test("list: pages append without repeats, posting shows at once and settles", () => {
  let s = initialThread(5, { comments: [c(9, { pinned: true }), c(8), c(7)], next: "n1" }, null);
  s = appendPage(s, { comments: [c(7), c(6)], next: null });
  assert.deepEqual(s.top.map((x) => x.body), ["comment 9", "comment 8", "comment 7", "comment 6"]);
  assert.equal(s.next, null);

  const mine = { ...c(20), id: "pending-1", mine: true };
  s = addPending(s, mine);
  assert.equal(s.top[1].id, "pending-1", "under the pinned comment");
  assert.equal(s.top[1].pending, true);
  assert.equal(s.count, 6);
  const real = { ...c(20), mine: true };
  s = resolvePending(s, "pending-1", real);
  assert.equal(s.top[1].id, real.id);
  assert.equal(s.top[1].pending, undefined);

  s = addPending(s, { ...c(21), id: "pending-2" });
  s = dropPending(s, "pending-2");
  assert.equal(s.top.some((x) => x.id === "pending-2"), false);
  assert.equal(s.count, 6);
});

test("list: replies post under the comment and count up; delete keeps a thread's shape", () => {
  let s = initialThread(3, { comments: [c(1, { replyCount: 1 }), c(2)], next: null }, null);
  s = receiveReplies(s, id(1), { comments: [c(5, { parentId: id(1) })], next: null });
  s = addPending(s, { ...c(6, { parentId: id(1) }), id: "pending-r" });
  assert.equal(s.top[0].replyCount, 2);
  assert.equal(s.replies[id(1)].items.at(-1).id, "pending-r");
  s = resolvePending(s, "pending-r", c(6, { parentId: id(1) }));
  assert.equal(s.replies[id(1)].items.at(-1).local, true);

  s = removeComment(s, id(6));
  assert.equal(s.top[0].replyCount, 1);
  s = removeComment(s, id(1));
  assert.equal(s.top[0].deleted, true, "a comment with replies stays as deleted");
  assert.equal(s.top[0].body, null);
  s = removeComment(s, id(2));
  assert.equal(s.top.some((x) => x.id === id(2)), false, "one without replies goes");
});

test("list: pinning moves to the top and unpins the one before", () => {
  let s = initialThread(3, { comments: [c(3, { pinned: true }), c(2), c(1)], next: null }, null);
  s = setPinned(s, id(1), true);
  assert.deepEqual(s.top.map((x) => [x.id, x.pinned]), [[id(1), true], [id(3), false], [id(2), false]]);
  s = setPinned(s, id(1), false);
  assert.equal(s.top[0].pinned, false);
});

// The "new comments" pill ------------------------------------------------------------------

test("pill: only other people's new top level comments wait, once each, newest first", () => {
  const since = encodeCursor("since", key(c(10)));
  let s = initialThread(2, { comments: [c(10), c(4)], next: null }, since);
  s = receivePoll(s, [c(12), c(11), c(10), c(13, { mine: true }), c(14, { parentId: id(10) })]);
  assert.deepEqual(s.held.map((x) => x.id), [id(12), id(11)]);
  assert.equal(pillLabel(s.held.length), "2 new comments");
  assert.equal(decodeCursor("since", s.since).id, id(13), "the next poll starts after the newest seen");

  s = receivePoll(s, [c(15), c(12)]);
  assert.deepEqual(s.held.map((x) => x.id), [id(15), id(12), id(11)], "no repeats");

  s = receivePoll(s, []);
  assert.equal(decodeCursor("since", s.since).id, id(15), "an empty answer keeps the cursor");
});

test("pill: a click puts them at the top, under the pinned comment, and counts them", () => {
  let s = initialThread(2, { comments: [c(1, { pinned: true }), c(2)], next: null }, null);
  s = receivePoll(s, [c(8), c(9)]);
  s = showHeld(s);
  assert.deepEqual(s.top.map((x) => x.id), [id(1), id(9), id(8), id(2)]);
  assert.equal(s.held.length, 0);
  assert.equal(s.count, 4);
  assert.equal(pillLabel(s.held.length), null);
  assert.equal(showHeld(s), s, "nothing held, nothing changes");
});

test("pill: the cursor never goes backwards", () => {
  const late = encodeCursor("since", key(c(30)));
  let s = initialThread(0, { comments: [], next: null }, late);
  s = receivePoll(s, [c(31, { mine: true })]);
  assert.equal(decodeCursor("since", s.since).id, id(31));
  s = { ...s, since: late };
  s = receivePoll(s, [c(2)]);
  assert.equal(decodeCursor("since", s.since).id, id(30), "an older answer does not move it back");
});
