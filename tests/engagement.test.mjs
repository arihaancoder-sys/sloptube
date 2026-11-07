// Feature 9: the pure parts of likes, views, history and resume. The view
// counting itself runs in SQL (watch_ping in 011_engagement.sql); applyPing()
// is the same rule in TypeScript, so it is tested here step by step.
import assert from "node:assert/strict";
import { test } from "node:test";
import { groupHistory, historyLabel } from "../lib/engagement/history.ts";
import { PingBatcher } from "../lib/engagement/pinger.ts";
import { clicked, initialReaction, likeRatio, nextReaction, reduceReaction, viewReaction } from "../lib/engagement/reaction.ts";
import {
  applyPing,
  engagementErrorCode,
  engagementStatus,
  progressFraction,
  resumeAt,
  viewDay,
  viewThreshold,
} from "../lib/engagement/rules.ts";
import { progressMap, rowToEngagement } from "../lib/engagement/types.ts";
import { hashViewerCookie, isViewerCookie, newViewerCookie } from "../lib/engagement/viewer-key.ts";

const S = 1000;


// Resume -------------------------------------------------------------------------------

test("resume: only past 10 seconds and before 90 percent", () => {
  assert.equal(resumeAt(null, 100), 0);
  assert.equal(resumeAt(5, 100), 0, "the first seconds start from the top");
  assert.equal(resumeAt(10, 100), 0, "exactly 10 is not more than 10");
  assert.equal(resumeAt(10.5, 100), 10);
  assert.equal(resumeAt(42.9, 100), 42, "whole seconds");
  assert.equal(resumeAt(89.9, 100), 89);
  assert.equal(resumeAt(90, 100), 0, "90 percent and later starts over");
  assert.equal(resumeAt(99, 100), 0);
  assert.equal(resumeAt(500, null), 500, "no duration known: trust the position");
  assert.equal(resumeAt(Number.NaN, 100), 0);
});

test("progress fraction for the red bar", () => {
  assert.equal(progressFraction(30, 120), 0.25);
  assert.equal(progressFraction(200, 120), 1, "never past the end");
  assert.equal(progressFraction(0, 120), 0);
  assert.equal(progressFraction(30, null), 0);
  assert.equal(progressFraction(30, 0), 0);
  assert.deepEqual(
    progressMap(["a", "b"], [{ video_id: "a", position_s: "60", duration_s: "240" }]),
    { a: 0.25, b: 0 },
    "ids without history answer 0, so they are not asked again",
  );
});

// View counting --------------------------------------------------------------------------

test("view threshold: 10 seconds, or the whole video when shorter", () => {
  assert.equal(viewThreshold(600), 10);
  assert.equal(viewThreshold(10), 10);
  assert.equal(viewThreshold(3.4), 3, "rounded down");
  assert.equal(viewThreshold(0.4), 1, "at least one second");
  assert.equal(viewThreshold(null), 10);
});

test("views: the first ping opens the day and earns nothing", () => {
  const t0 = Date.parse("2026-11-04T12:00:00Z");
  const { day, countedNow } = applyPing(null, { playedS: 10, now: t0 }, 600);
  assert.deepEqual(day, { watchedS: 0, counted: false, openedAt: t0 });
  assert.equal(countedNow, false);
});

test("views: count once, when 10 seconds are reached", () => {
  const t0 = Date.parse("2026-11-04T12:00:00Z");
  let r = applyPing(null, { playedS: 0, now: t0 }, 600);
  r = applyPing(r.day, { playedS: 9, now: t0 + 9 * S }, 600);
  assert.equal(r.day.watchedS, 9);
  assert.equal(r.countedNow, false, "9 seconds is not a view");
  r = applyPing(r.day, { playedS: 1.5, now: t0 + 10.5 * S }, 600);
  assert.equal(r.day.watchedS, 10);
  assert.equal(r.countedNow, true, "the view counts at 10 seconds");
  r = applyPing(r.day, { playedS: 10, now: t0 + 20.5 * S }, 600);
  assert.equal(r.countedNow, false, "and never again that day");
  assert.equal(r.day.counted, true);
  assert.equal(r.day.watchedS, 20, "watch time keeps adding up");
});

test("views: seconds cannot be claimed faster than they pass", () => {
  const t0 = Date.parse("2026-11-04T12:00:00Z");
  let r = applyPing(null, { playedS: 0, now: t0 }, 600);
  for (let i = 0; i < 20; i++) r = applyPing(r.day, { playedS: 60, now: t0 + 200 }, 600);
  assert.equal(r.day.watchedS, 1, "twenty pings in the same second still add up to one second");
  assert.equal(r.day.counted, false);
  r = applyPing(r.day, { playedS: 500, now: t0 + 30 * S }, 600);
  assert.equal(r.day.watchedS, 31, "a big claim is capped by the wall clock");
  assert.equal(r.countedNow, true);
});

test("views: a short video counts once played through", () => {
  const t0 = Date.parse("2026-11-04T12:00:00Z");
  let r = applyPing(null, { playedS: 0, now: t0 }, 3.4);
  r = applyPing(r.day, { playedS: 3.4, now: t0 + 3.5 * S }, 3.4);
  assert.equal(r.countedNow, true, "3 of 3.4 seconds is the whole video");
});

test("views: once per viewer per video per UTC day", () => {
  assert.equal(viewDay(Date.parse("2026-11-04T23:59:59Z")), "2026-11-04");
  assert.equal(viewDay(Date.parse("2026-11-05T00:00:00Z")), "2026-11-05", "a new day is a new row, so a new view");
});

// Ping batching ------------------------------------------------------------------------

/** Plays from `from` for `seconds`, with a timeupdate every 250 ms. */
function play(b, { from, seconds, start, out }) {
  for (let ms = 250; ms <= seconds * S; ms += 250) {
    const p = b.tick(from + ms / S, start + ms);
    if (p) out.push(p);
  }
}

test("pings: one start ping, then one every 10 seconds of playback", () => {
  const b = new PingBatcher();
  const t0 = 1_000_000;
  const out = [b.play(0, t0)];
  assert.deepEqual(out[0], { positionS: 0, playedS: 0, reason: "start" });
  play(b, { from: 0, seconds: 25, start: t0, out });
  assert.deepEqual(
    out.map((p) => [p.reason, p.positionS, p.playedS]),
    [
      ["start", 0, 0],
      ["tick", 10, 10],
      ["tick", 20, 10],
    ],
  );
  assert.equal(b.play(25, t0 + 25 * S), null, "only one start ping");
  const leave = b.flush(25, t0 + 25 * S, "leave");
  assert.deepEqual(leave, { positionS: 25, playedS: 5, reason: "leave" }, "leaving sends the rest");
  assert.equal(b.flush(25, t0 + 26 * S, "leave"), null, "nothing left, nothing sent");
});

test("pings: a 12 second playback sends enough for a view", () => {
  const b = new PingBatcher();
  const t0 = 2_000_000;
  const out = [b.play(0, t0)];
  play(b, { from: 0, seconds: 12, start: t0, out });
  out.push(b.flush(12, t0 + 12 * S, "pause"));
  const sent = out.reduce((n, p) => n + p.playedS, 0);
  assert.equal(sent, 12);
  let day = null;
  let counted = false;
  for (const [i, p] of out.entries()) {
    const at = t0 + [0, 10, 12][i] * S;
    const r = applyPing(day, { playedS: p.playedS, now: at }, 600);
    day = r.day;
    counted ||= r.countedNow;
  }
  assert.equal(counted, true);
});

test("pings: seeks are not playback", () => {
  const b = new PingBatcher();
  const t0 = 3_000_000;
  b.play(0, t0);
  b.tick(1, t0 + S);
  b.tick(300, t0 + 1.25 * S);
  b.seek(300);
  b.tick(301, t0 + 2.25 * S);
  assert.equal(b.pending, 2, "one second before the jump and one after");
  const p = b.flush(301, t0 + 3 * S, "pause");
  assert.deepEqual(p, { positionS: 301, playedS: 2, reason: "pause" });
});

test("pings: a quick pause sends nothing, the end always flushes", () => {
  const b = new PingBatcher();
  const t0 = 4_000_000;
  b.play(0, t0);
  b.tick(0.5, t0 + 500);
  assert.equal(b.flush(0.5, t0 + 500, "pause"), null, "half a second waits for later");
  b.play(0.5, t0 + 600);
  b.tick(0.9, t0 + 1000);
  const end = b.flush(0.9, t0 + 1000, "end");
  assert.equal(end?.reason, "end");
  assert.equal(end?.playedS, 0.9);
});

test("pings: nothing before playback starts", () => {
  const b = new PingBatcher();
  assert.equal(b.tick(5, 10), null);
  assert.equal(b.flush(5, 20, "leave"), null);
});

// Likes ---------------------------------------------------------------------------------

test("likes: optimistic toggle with the count", () => {
  let s = initialReaction({ reaction: null, likes: 41, dislikes: null });
  assert.equal(nextReaction(s), undefined, "nothing to send at rest");
  s = reduceReaction(s, { type: "click", kind: "like" });
  assert.deepEqual(viewReaction(s), { reaction: "like", likes: 42, dislikes: null });
  assert.equal(nextReaction(s), "like");
  s = reduceReaction(s, { type: "sent" });
  assert.equal(nextReaction(s), undefined, "one request at a time");
  s = reduceReaction(s, { type: "click", kind: "like" });
  assert.deepEqual(viewReaction(s), { reaction: null, likes: 41, dislikes: null }, "a second click takes it back at once");
  s = reduceReaction(s, { type: "settled", server: { reaction: "like", likes: 42, dislikes: null } });
  assert.equal(nextReaction(s), null, "then the clear goes out");
  assert.deepEqual(viewReaction(s), { reaction: null, likes: 41, dislikes: null });
});

test("likes: switching to dislike moves both counts for the owner", () => {
  let s = initialReaction({ reaction: "like", likes: 10, dislikes: 2 });
  s = reduceReaction(s, { type: "click", kind: "dislike" });
  assert.deepEqual(viewReaction(s), { reaction: "dislike", likes: 9, dislikes: 3 });
  assert.equal(likeRatio(viewReaction(s)), 0.75);
  assert.equal(clicked("dislike", "dislike"), null);
  assert.equal(clicked("like", "dislike"), "dislike");
});

test("likes: a failure goes back to the server state", () => {
  let s = initialReaction({ reaction: null, likes: 5, dislikes: null });
  s = reduceReaction(s, { type: "click", kind: "like" });
  s = reduceReaction(s, { type: "sent" });
  s = reduceReaction(s, { type: "failed", error: "rate_limited" });
  assert.deepEqual(viewReaction(s), { reaction: null, likes: 5, dislikes: null });
  assert.equal(s.error, "rate_limited");
  assert.equal(nextReaction(s), undefined);
});

test("likes: the ratio bar needs the dislike count", () => {
  assert.equal(likeRatio({ reaction: null, likes: 3, dislikes: null }), null, "non owners never see a ratio");
  assert.equal(likeRatio({ reaction: null, likes: 0, dislikes: 0 }), null);
  assert.equal(likeRatio({ reaction: null, likes: 3, dislikes: 1 }), 0.75);
});

test("engagement rows: dislikes and the position only when allowed", () => {
  const row = { like_count: "12", dislike_count: null, my_reaction: "like", position_s: "42", duration_s: "120" };
  assert.deepEqual(rowToEngagement(row, true), { likes: 12, dislikes: null, reaction: "like", positionS: 42, durationS: 120, signedIn: true });
  assert.equal(rowToEngagement(row, false).positionS, null, "signed out uses the browser's own position");
  assert.equal(rowToEngagement({ ...row, my_reaction: "meh" }, true).reaction, null);
  assert.equal(rowToEngagement(null, false).likes, 0);
});

test("errors: codes and statuses", () => {
  assert.equal(engagementErrorCode("rate_limited"), "rate_limited");
  assert.equal(engagementErrorCode("permission denied for function react"), "not_signed_in");
  assert.equal(engagementErrorCode("boom"), "failed");
  assert.equal(engagementStatus("engagement_off"), 403);
  assert.equal(engagementStatus("rate_limited"), 429);
  assert.equal(engagementStatus("not_signed_in"), 401);
});

// History grouping --------------------------------------------------------------------------

test("history: Today, Yesterday, then dates", () => {
  const now = Date.parse("2026-11-04T15:00:00Z");
  assert.equal(historyLabel("2026-11-04T01:00:00Z", now).label, "Today");
  assert.equal(historyLabel("2026-11-03T23:59:00Z", now).label, "Yesterday");
  assert.equal(historyLabel("2026-11-02T10:00:00Z", now).label, "Nov 2");
  assert.equal(historyLabel("2025-12-31T10:00:00Z", now).label, "Dec 31, 2025", "another year gets the year");
  assert.equal(historyLabel("2026-11-04T16:00:00Z", now).label, "Today", "a clock a little ahead is still today");
  assert.equal(historyLabel("nope", now).label, "Earlier");
});

test("history: days follow the viewer's time zone", () => {
  const now = Date.parse("2026-11-04T03:00:00Z");
  const watched = "2026-11-03T22:00:00Z";
  assert.equal(historyLabel(watched, now, 0).label, "Yesterday", "UTC");
  assert.equal(historyLabel(watched, now, 300).label, "Today", "UTC-5: both are on Nov 3 there");
});

test("history: groups keep the order", () => {
  const now = Date.parse("2026-11-04T15:00:00Z");
  const items = [
    { id: "a", watchedAt: "2026-11-04T14:00:00Z" },
    { id: "b", watchedAt: "2026-11-04T09:00:00Z" },
    { id: "c", watchedAt: "2026-11-03T20:00:00Z" },
    { id: "d", watchedAt: "2026-10-30T20:00:00Z" },
    { id: "e", watchedAt: "2026-10-30T08:00:00Z" },
  ];
  const groups = groupHistory(items, now);
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((i) => i.id).join("")]),
    [
      ["Today", "ab"],
      ["Yesterday", "c"],
      ["Oct 30", "de"],
    ],
  );
  assert.deepEqual(groupHistory([], now), []);
});

// The viewer cookie ------------------------------------------------------------------------

test("viewer cookie: random, checked, hashed", () => {
  const a = newViewerCookie();
  const b = newViewerCookie();
  assert.notEqual(a, b);
  assert.ok(isViewerCookie(a));
  assert.equal(isViewerCookie("short"), false);
  assert.equal(isViewerCookie(a + "!"), false);
  const h = hashViewerCookie(a);
  assert.match(h, /^[0-9a-f]{64}$/, "the header value the database accepts");
  assert.equal(hashViewerCookie(a), h, "the same browser is the same viewer");
  assert.ok(!h.includes(a));
});
