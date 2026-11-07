// Feature 7: the pure parts of subscriptions. The row level security and the
// count trigger live in SQL (009_subscriptions.sql); these test the browser
// side: the optimistic button, the feed's day sections and the unread badge.
import assert from "node:assert/strict";
import { test } from "node:test";
import { GUIDE_CHANNELS, guideSlice, isSubAction, subErrorCode, subErrorMessage } from "../lib/subscriptions/rules.ts";
import { bucketSections, sectionFor } from "../lib/subscriptions/sections.ts";
import { initialToggle, isDirty, nextOp, reduceToggle, viewToggle } from "../lib/subscriptions/toggle.ts";
import { badgeLabel, hasNewUpload, parseSeen, seenStamp, unreadCount } from "../lib/subscriptions/unread.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Runs a list of events through the reducer. */
const run = (state, ...events) => events.reduce(reduceToggle, state);

test("toggle: subscribing is optimistic and the count moves at once", () => {
  let s = initialToggle({ subscribed: false, notify: false, count: 41 });
  assert.equal(nextOp(s), null, "nothing to send at rest");
  s = reduceToggle(s, { type: "toggle" });
  assert.deepEqual(viewToggle(s), { subscribed: true, notify: true, count: 42 });
  assert.deepEqual(nextOp(s), { kind: "subscribe" });
  s = reduceToggle(s, { type: "sent", op: nextOp(s) });
  assert.equal(nextOp(s), null, "one request at a time");
  s = reduceToggle(s, { type: "settled", server: { subscribed: true, notify: true, count: 42 } });
  assert.equal(nextOp(s), null);
  assert.equal(isDirty(s), false);
  assert.deepEqual(viewToggle(s), { subscribed: true, notify: true, count: 42 });
});

test("toggle: the server count wins once a request settles", () => {
  // Somebody else subscribed meanwhile: the server says 50, not 42.
  let s = run(initialToggle({ subscribed: false, notify: false, count: 41 }), { type: "toggle" }, { type: "sent", op: { kind: "subscribe" } });
  s = reduceToggle(s, { type: "settled", server: { subscribed: true, notify: true, count: 50 } });
  assert.equal(viewToggle(s).count, 50);
});

test("toggle: a failure goes back to the server state and keeps the error", () => {
  let s = run(initialToggle({ subscribed: false, notify: false, count: 3 }), { type: "toggle" }, { type: "sent", op: { kind: "subscribe" } });
  s = reduceToggle(s, { type: "failed", error: "rate_limited" });
  assert.deepEqual(viewToggle(s), { subscribed: false, notify: false, count: 3 });
  assert.equal(s.error, "rate_limited");
  assert.equal(nextOp(s), null, "no retry loop after a failure");
  s = reduceToggle(s, { type: "toggle" });
  assert.equal(s.error, null, "a new click clears the error");
});

test("toggle: double clicks end in the last state asked for, one request at a time", () => {
  let s = initialToggle({ subscribed: false, notify: false, count: 10 });
  s = run(s, { type: "toggle" }, { type: "sent", op: { kind: "subscribe" } });
  // Clicked again while subscribe is still on its way: shows unsubscribed.
  s = reduceToggle(s, { type: "toggle" });
  assert.deepEqual(viewToggle(s), { subscribed: false, notify: false, count: 10 });
  assert.equal(nextOp(s), null, "waits for the running request");
  s = reduceToggle(s, { type: "settled", server: { subscribed: true, notify: true, count: 11 } });
  assert.deepEqual(viewToggle(s), { subscribed: false, notify: false, count: 10 }, "still shows what was asked");
  assert.deepEqual(nextOp(s), { kind: "unsubscribe" }, "then sends the unsubscribe");
  s = run(s, { type: "sent", op: { kind: "unsubscribe" } }, { type: "settled", server: { subscribed: false, notify: false, count: 10 } });
  assert.equal(isDirty(s), false);
  // Three clicks with no request in between: just one subscribe.
  s = run(initialToggle({ subscribed: false, notify: false, count: 0 }), { type: "toggle" }, { type: "toggle" }, { type: "toggle" });
  assert.deepEqual(nextOp(s), { kind: "subscribe" });
  // Two clicks: back where it started, nothing to send.
  s = run(initialToggle({ subscribed: true, notify: true, count: 5 }), { type: "toggle" }, { type: "toggle" });
  assert.equal(nextOp(s), null);
});

test("toggle: the bell only works while subscribed, and follows the subscribe", () => {
  let s = initialToggle({ subscribed: false, notify: false, count: 1 });
  assert.equal(reduceToggle(s, { type: "bell" }), s, "bell does nothing when not subscribed");
  s = run(s, { type: "toggle" }, { type: "bell" });
  assert.deepEqual(viewToggle(s), { subscribed: true, notify: false, count: 2 });
  assert.deepEqual(nextOp(s), { kind: "subscribe" }, "subscribe goes first");
  s = run(s, { type: "sent", op: { kind: "subscribe" } }, { type: "settled", server: { subscribed: true, notify: true, count: 2 } });
  assert.deepEqual(nextOp(s), { kind: "notify", on: false }, "then the bell off");
  s = run(s, { type: "sent", op: { kind: "notify", on: false } }, { type: "settled", server: { subscribed: true, notify: false, count: 2 } });
  assert.equal(isDirty(s), false);
  // Bell back on, then unsubscribe before it is sent: only the unsubscribe goes.
  s = run(s, { type: "bell" }, { type: "toggle" });
  assert.deepEqual(nextOp(s), { kind: "unsubscribe" });
  // Subscribing again starts with the bell on.
  s = reduceToggle(s, { type: "toggle" });
  assert.equal(viewToggle(s).notify, true);
});

test("toggle: sync from the page only applies while nothing is pending", () => {
  let s = initialToggle({ subscribed: false, notify: false, count: 0 });
  s = reduceToggle(s, { type: "sync", server: { subscribed: true, notify: false, count: 7 } });
  assert.deepEqual(viewToggle(s), { subscribed: true, notify: false, count: 7 });
  s = reduceToggle(s, { type: "toggle" });
  const before = s;
  s = reduceToggle(s, { type: "sync", server: { subscribed: true, notify: true, count: 9 } });
  assert.equal(s, before, "a click not yet sent is never overwritten");
  // Unsubscribing at 0 never shows -1.
  s = run(initialToggle({ subscribed: true, notify: true, count: 0 }), { type: "toggle" });
  assert.equal(viewToggle(s).count, 0);
});

test("sections: today, this week and older in the viewer's time zone", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(sectionFor("2026-11-04T00:00:00Z", now), "today");
  assert.equal(sectionFor("2026-11-04T11:59:59.123456+00:00", now), "today");
  assert.equal(sectionFor("2026-11-03T23:59:59Z", now), "week", "yesterday is this week");
  assert.equal(sectionFor("2026-10-29T00:00:00Z", now), "week", "six days back");
  assert.equal(sectionFor("2026-10-28T23:59:59Z", now), "older", "seven days back");
  assert.equal(sectionFor("2026-11-04T13:00:00Z", now), "today", "a clock ahead of ours");
  assert.equal(sectionFor("not a date", now), "older");
  // In UTC+2 (offset -120) 23:30 UTC on the 3rd is already the 4th.
  assert.equal(sectionFor("2026-11-03T23:30:00Z", now, -120), "today");
  assert.equal(sectionFor("2026-11-03T23:30:00Z", now, 0), "week");
  // In UTC-5 (offset 300) it is 07:00 on the 4th; 03:00 UTC is still the 3rd there.
  assert.equal(sectionFor("2026-11-04T03:00:00Z", now, 300), "week");
});

test("sections: bucketing keeps order and leaves out empty sections", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const items = [
    { id: "a", publishedAt: new Date(now - 1 * HOUR).toISOString() },
    { id: "b", publishedAt: new Date(now - 3 * HOUR).toISOString() },
    { id: "c", publishedAt: new Date(now - 2 * DAY).toISOString() },
    { id: "d", publishedAt: new Date(now - 30 * DAY).toISOString() },
    { id: "e", publishedAt: new Date(now - 400 * DAY).toISOString() },
  ];
  const s = bucketSections(items, now);
  assert.deepEqual(
    s.map((x) => [x.label, x.items.map((i) => i.id)]),
    [
      ["Today", ["a", "b"]],
      ["This week", ["c"]],
      ["Older", ["d", "e"]],
    ],
  );
  assert.deepEqual(
    bucketSections(items.slice(3), now).map((x) => x.key),
    ["older"],
  );
  assert.deepEqual(bucketSections([], now), []);
});

test("unread: badge math against the last seen time", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  const items = [0, 1, 2, 5, 30].map((h) => ({ publishedAt: new Date(now - h * HOUR).toISOString() }));
  assert.equal(unreadCount(items, null), 5, "never opened: everything is new");
  assert.equal(unreadCount(items, now - 90 * 60_000), 2, "two uploads since 1.5 hours ago");
  assert.equal(unreadCount(items, now), 0);
  assert.equal(unreadCount([{ publishedAt: "nope" }], 0), 0);
  assert.equal(badgeLabel(0), null);
  assert.equal(badgeLabel(-3), null);
  assert.equal(badgeLabel(NaN), null);
  assert.equal(badgeLabel(1), "1");
  assert.equal(badgeLabel(9), "9");
  assert.equal(badgeLabel(10), "9+");
  assert.equal(badgeLabel(20), "9+");
  // Opening the menu clears the badge, even with an upload dated ahead of our clock.
  const ahead = [...items, { publishedAt: new Date(now + 5 * 60_000).toISOString() }];
  const seen = seenStamp(ahead, now);
  assert.equal(seen, now + 5 * 60_000);
  assert.equal(unreadCount(ahead, seen), 0);
  assert.equal(seenStamp([], now), now);
});

test("unread: the stored time is parsed carefully", () => {
  assert.equal(parseSeen("1793793600000"), 1793793600000);
  for (const bad of [null, undefined, "", "abc", "-5", "0", "1e12", "12.5", "9".repeat(20)]) {
    assert.equal(parseSeen(bad), null, String(bad));
  }
});

test("guide: the new upload dot and SHOW MORE after seven", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(hasNewUpload(new Date(now - 6 * DAY).toISOString(), now), true);
  assert.equal(hasNewUpload(new Date(now - 7 * DAY - 1).toISOString(), now), false);
  assert.equal(hasNewUpload(null, now), false);
  assert.equal(hasNewUpload("nope", now), false);
  const list = Array.from({ length: 10 }, (_, i) => i);
  assert.equal(GUIDE_CHANNELS, 7);
  assert.deepEqual(guideSlice(list, false), { shown: [0, 1, 2, 3, 4, 5, 6], more: 3 });
  assert.deepEqual(guideSlice(list, true), { shown: list, more: 0 });
  assert.deepEqual(guideSlice(list.slice(0, 7), false), { shown: list.slice(0, 7), more: 0 });
});

test("rules: actions and error codes", () => {
  for (const a of ["subscribe", "unsubscribe", "notify"]) assert.ok(isSubAction(a));
  for (const a of ["SUBSCRIBE", "", null, "delete"]) assert.ok(!isSubAction(a));
  assert.equal(subErrorCode("rate_limited"), "rate_limited");
  assert.equal(subErrorCode("own_channel"), "own_channel");
  assert.equal(subErrorCode("permission denied for function subscribe"), "not_signed_in");
  assert.equal(subErrorCode("something else"), "failed");
  assert.equal(subErrorCode(null), "failed");
  assert.match(subErrorMessage("rate_limited"), /too|fast/i);
  assert.match(subErrorMessage("what"), /try again/i);
  // No em dashes in anything a person reads.
  for (const code of ["not_signed_in", "subscriptions_off", "not_found", "own_channel", "rate_limited", "not_subscribed"]) {
    assert.ok(!subErrorMessage(code).includes("—"), code);
  }
});
