// Feature 11: the pure parts of Snips.
import assert from "node:assert/strict";
import { test } from "node:test";
import { applyPing, viewThreshold } from "../lib/engagement/rules.ts";
import { PingBatcher } from "../lib/engagement/pinger.ts";
import { encodeCursor } from "../lib/feed/cursor.ts";
import { trendingScore } from "../lib/feed/score.ts";
import { rowToCard } from "../lib/feed/types.ts";
import {
  compareShorts,
  decodeShortsCursor,
  encodeShortsCursor,
  isAfterCursor,
  mergePage,
  nextShortsCursor,
} from "../lib/shorts/cursor.ts";
import { isShort, SHORT_MAX_S, shortProblem, shortsErrorCode, shortsScore, shortsStatus } from "../lib/shorts/rules.ts";
import { groupShelf } from "../lib/shorts/shelf.ts";
import { rowKey, rowToShort } from "../lib/shorts/types.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();
const id = (n) => `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// Classification ------------------------------------------------------------------------

test("isShort: vertical and 60 seconds or less, like video_is_short()", () => {
  assert.equal(isShort({ durationS: 30, width: 1080, height: 1920 }), true);
  assert.equal(isShort({ durationS: 60, width: 720, height: 1280 }), true);
  // The duration rounded down, as the player shows it: 60.9 is 1:00.
  assert.equal(isShort({ durationS: 60.9, width: 720, height: 1280 }), true);
  assert.equal(isShort({ durationS: 61, width: 720, height: 1280 }), false);
  assert.equal(SHORT_MAX_S, 60);
  // Horizontal and square are never shorts.
  assert.equal(isShort({ durationS: 20, width: 1920, height: 1080 }), false);
  assert.equal(isShort({ durationS: 20, width: 1080, height: 1080 }), false);
  // Not processed yet, or broken.
  assert.equal(isShort({ durationS: null, width: 1080, height: 1920 }), false);
  assert.equal(isShort({ durationS: 10, width: null, height: 1920 }), false);
  assert.equal(isShort({ durationS: 0, width: 1080, height: 1920 }), false);
  assert.equal(isShort({ durationS: NaN, width: 1080, height: 1920 }), false);
});

test("isShort: the uploader's choice can only say no", () => {
  const tall = { durationS: 15, width: 1080, height: 1920 };
  assert.equal(isShort(tall, null), true);
  assert.equal(isShort(tall, true), true);
  assert.equal(isShort(tall, false), false);
  assert.equal(isShort({ durationS: 15, width: 1920, height: 1080 }, true), false);
});

test("shortProblem: says why a file cannot be a short", () => {
  assert.equal(shortProblem({ durationS: 42, width: 1080, height: 1920 }), null);
  assert.match(shortProblem({ durationS: 42, width: 1920, height: 1080 }), /horizontal \(1920 x 1080\)/);
  assert.match(shortProblem({ durationS: 42, width: 1080, height: 1080 }), /square \(1080 x 1080\)/);
  assert.match(shortProblem({ durationS: 134, width: 1080, height: 1920 }), /It's 2:14 long\. Snips are 60 seconds or less\./);
  const both = shortProblem({ durationS: 600, width: 1920, height: 1080 });
  assert.match(both, /horizontal/);
  assert.match(both, /10:00 long/);
  assert.match(shortProblem(null), /can't read/);
  // No em dashes in UI text.
  for (const t of [both, shortProblem(null)]) assert.ok(!t.includes("—"));
});

test("viewThreshold: a short counts at 3 seconds, a regular video at 10", () => {
  assert.equal(viewThreshold(30, true), 3);
  assert.equal(viewThreshold(2.5, true), 2);
  assert.equal(viewThreshold(null, true), 3);
  assert.equal(viewThreshold(30), 10);
  assert.equal(viewThreshold(30, false), 10);
  // Three seconds of wall clock after the row opened is enough for a short.
  const open = applyPing(null, { playedS: 0, now: NOW }, 30, true).day;
  assert.equal(applyPing(open, { playedS: 3, now: NOW + 3000 }, 30, true).countedNow, true);
  assert.equal(applyPing(open, { playedS: 3, now: NOW + 3000 }, 30, false).countedNow, false);
});

test("PingBatcher: a short's first tick waits for 3 seconds of playback, then every 10", () => {
  const b = new PingBatcher({ firstS: 3 });
  assert.equal(b.play(0, NOW).reason, "start");
  let t = 0;
  let first = null;
  // timeupdate every 250 ms.
  for (let ms = 250; ms <= 4000 && !first; ms += 250) {
    t += 0.25;
    first = b.tick(t, NOW + ms);
  }
  assert.ok(first, "the first tick goes out");
  assert.ok(first.playedS >= 3, `with at least 3 seconds (${first.playedS})`);
  assert.equal(b.tick(t + 0.25, NOW + 4500), null);
  assert.equal(b.tick(t + 9, NOW + 9000), null, "the next waits the usual 10 seconds");
  // A regular video keeps its 10 second rhythm.
  const r = new PingBatcher();
  r.play(0, NOW);
  assert.equal(r.tick(1, NOW + 3000), null);
});

// The score and the cursor ---------------------------------------------------------------

test("shortsScore: the feed's trending math with likes and comments and a starting point", () => {
  const counts = { views: 999, likes: 0, comments: 0 };
  // Same as the home feed's trending score with one more view.
  assert.equal(shortsScore(counts, hoursAgo(4), NOW), trendingScore(1000, hoursAgo(4), NOW));
  // A brand new short without views still scores (and new beats old).
  assert.equal(shortsScore({ views: 0, likes: 0, comments: 0 }, hoursAgo(0), NOW), 1);
  assert.ok(shortsScore({ views: 0, likes: 0, comments: 0 }, hoursAgo(1), NOW) > shortsScore({ views: 0, likes: 0, comments: 0 }, hoursAgo(9), NOW));
  // Likes count twice, comments three times.
  assert.equal(shortsScore({ views: 0, likes: 2, comments: 1 }, hoursAgo(1), NOW), 8);
  // Rounded to 6 decimals like SQL, and measured at asOf, not the clock.
  assert.equal(shortsScore({ views: 0, likes: 0, comments: 0 }, hoursAgo(3), NOW), 0.19245);
  assert.equal(shortsScore({ views: 5, likes: 0, comments: 0 }, "nope", NOW), 0);
});

test("shorts cursor: round trip, and broken or made up cursors are refused", () => {
  const c = { at: "2026-11-04T12:00:00.123456+00:00", tier: 1, score: 4.558116, id: id(7).toUpperCase() };
  const back = decodeShortsCursor(encodeShortsCursor(c));
  assert.deepEqual(back, { ...c, id: id(7) });
  assert.deepEqual(decodeShortsCursor(encodeShortsCursor({ ...c, score: 0 })).score, 0);
  for (const bad of [null, "", "!!!", "x".repeat(400), encodeCursor({ publishedAt: c.at, id: id(1) })]) {
    assert.equal(decodeShortsCursor(bad), null, `refused: ${bad}`);
  }
  const forge = (text) => Buffer.from(text).toString("base64url");
  assert.equal(decodeShortsCursor(forge(`${c.at}|2|1|${id(1)}`)), null, "tier is 0 or 1");
  assert.equal(decodeShortsCursor(forge(`${c.at}|0|-1|${id(1)}`)), null, "no negative score");
  assert.equal(decodeShortsCursor(forge(`${c.at}|0|NaN|${id(1)}`)), null);
  assert.equal(decodeShortsCursor(forge(`yesterday|0|1|${id(1)}`)), null);
  assert.equal(decodeShortsCursor(forge(`${c.at}|0|1|not-a-uuid`)), null);
});

test("shorts order: unwatched first, then score down, then id down; pages never overlap", () => {
  const rows = [
    { id: id(1), tier: 0, score: 2 },
    { id: id(2), tier: 1, score: 99 },
    { id: id(3), tier: 0, score: 5 },
    { id: id(4), tier: 0, score: 2 },
    { id: id(5), tier: 1, score: 1 },
    { id: id(6), tier: 0, score: 0.5 },
  ];
  const sorted = [...rows].sort(compareShorts).map((r) => r.id);
  assert.deepEqual(sorted, [id(3), id(4), id(1), id(6), id(2), id(5)]);

  // Walk the pages two at a time, the way list_shorts() does with the cursor.
  const at = "2026-11-04T12:00:00+00:00";
  const page = (after, lim) =>
    [...rows]
      .sort(compareShorts)
      .filter((r) => !after || isAfterCursor(r, after))
      .slice(0, lim)
      .map((r) => ({ ...r, asOf: at }));
  const seen = [];
  let cursor = null;
  for (let i = 0; i < 10; i++) {
    const p = page(cursor, 2);
    seen.push(...p.map((r) => r.id));
    const next = nextShortsCursor(p, 2);
    if (!next) break;
    cursor = decodeShortsCursor(next);
    assert.equal(cursor.at, at, "the first page's time rides along");
  }
  assert.deepEqual(seen, sorted, "every short once, in order");
  // Deterministic: the same cursor gives the same page.
  const c = decodeShortsCursor(nextShortsCursor(page(null, 2), 2));
  assert.deepEqual(page(c, 2), page(c, 2));
  // A short page is the end.
  assert.equal(nextShortsCursor(page(null, 10), 10), null);
  assert.equal(nextShortsCursor([], 10), null);
});

test("mergePage drops ids already shown", () => {
  const a = [{ id: "a" }, { id: "b" }];
  assert.deepEqual(mergePage(a, [{ id: "b" }, { id: "c" }, { id: "c" }]).map((x) => x.id), ["a", "b", "c"]);
});

test("rowToShort and rowKey: a list_shorts row for the page", () => {
  const row = {
    id: id(9).toUpperCase(), title: "Tiny", duration_s: "14.5", width: 1080, height: 1920, thumbnail_url: null, hls_key: `hls/${id(9)}/master.m3u8`,
    published_at: hoursAgo(2), views: "12", like_count: 3, comment_count: null, comments_mode: null, my_reaction: "like",
    channel_id: "c1", channel_handle: "maker", channel_name: "Maker", channel_avatar_url: null, tier: 1, score: "0.353552", as_of: "2026-11-04T12:00:00+00:00",
  };
  const s = rowToShort(row, "https://media.example.com");
  assert.equal(s.id, id(9));
  assert.equal(s.src, `https://media.example.com/hls/${id(9)}/master.m3u8`);
  assert.equal(s.thumbnail, `https://media.example.com/hls/${id(9)}/thumb-1.webp`);
  assert.deepEqual([s.durationS, s.views, s.likes, s.comments, s.commentsMode, s.reaction], [14.5, 12, 3, 0, "on", "like"]);
  assert.equal(rowToShort({ ...row, my_reaction: "meh" }, null).reaction, null);
  assert.equal(rowToShort(row, null).src, `/api/media/${id(9)}/master.m3u8`);
  assert.deepEqual(rowKey(row), { tier: 1, score: 0.353552, id: id(9), asOf: "2026-11-04T12:00:00+00:00" });
});

test("shorts errors map to statuses", () => {
  assert.equal(shortsErrorCode("shorts_off"), "shorts_off");
  assert.equal(shortsErrorCode("permission denied for function set_short_choice"), "not_signed_in");
  assert.equal(shortsErrorCode("boom"), "failed");
  assert.deepEqual(["shorts_off", "not_signed_in", "not_found", "not_a_short", "rate_limited", "failed"].map(shortsStatus), [403, 401, 404, 400, 429, 503]);
});

// The shelf ---------------------------------------------------------------------------------

test("groupShelf: the shelf after the first cards, shorts out of the grid, no repeats", () => {
  const card = (n, isShort = false) => ({ id: `v${n}`, isShort });
  const cards = [card(1), card(2), card(3, true), card(4), card(5), card(6), card(7)];
  const shorts = [{ id: "v3" }, { id: "s1" }, { id: "s1" }, { id: "s2" }, { id: "s3" }];
  const g = groupShelf(cards, shorts, { at: 4, max: 3 });
  assert.deepEqual(g.before.map((c) => c.id), ["v1", "v2", "v4", "v5"]);
  assert.deepEqual(g.shelf.map((s) => s.id), ["v3", "s1", "s2"]);
  assert.deepEqual(g.after.map((c) => c.id), ["v6", "v7"]);
});

test("groupShelf: a short grid puts the shelf at the end; no shorts leaves the grid alone", () => {
  const cards = [{ id: "a" }, { id: "b", isShort: true }];
  const g = groupShelf(cards, [{ id: "s" }], { at: 4, max: 12 });
  assert.deepEqual(g.before.map((c) => c.id), ["a"]);
  assert.deepEqual(g.after, []);
  assert.deepEqual(g.shelf.map((s) => s.id), ["s"]);
  // Without shorts (flag off, or none yet) nothing moves, shorts cards included.
  const none = groupShelf(cards, [], { at: 4, max: 12 });
  assert.deepEqual(none, { before: cards, shelf: [], after: [] });
  assert.deepEqual(groupShelf(cards, [{ id: "s" }], { at: 0, max: 0 }).shelf, []);
});

test("feed cards carry is_short from feed_videos", () => {
  const base = { id: id(1), title: "t", duration_s: 10, thumbnail_url: null, hls_key: null, preview_sprite_key: null, published_at: hoursAgo(1), views: 1, channel_id: "c", channel_handle: "h", channel_name: "n", channel_avatar_url: null };
  assert.equal(rowToCard({ ...base, is_short: true }, null).isShort, true);
  assert.equal(rowToCard(base, null).isShort, false);
});
