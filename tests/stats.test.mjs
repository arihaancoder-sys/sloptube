// Feature 13: the pure parts of analytics. The range maths, the retention
// buckets (the same marking as stats_reached() in 015_stats.sql), the chart
// scales, the traffic source of a view and the RPC readers.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  areaPath,
  bars,
  compact,
  labelIndexes,
  linePath,
  nearestIndex,
  niceScale,
  niceStep,
  slotIndex,
  xFor,
  yFor,
} from "../lib/stats/chart.ts";
import {
  addCounts,
  bucketsFromMasks,
  END_BIT,
  halfwayPoint,
  markPing,
  markReached,
  POINTS,
  retentionCurve,
} from "../lib/stats/retention.ts";
import {
  addDays,
  averagePercent,
  averageViewS,
  clock,
  daysBetween,
  fillDays,
  fillHours,
  likeShare,
  parseRange,
  percent,
  rangeBounds,
  REALTIME_HOURS,
  signed,
  SOURCES,
  statsErrorCode,
  statsStatus,
} from "../lib/stats/rules.ts";
import { sourceOfPath, viewSource } from "../lib/stats/source.ts";
import { readChannelAnalytics, readRealtime, readVideoAnalytics } from "../lib/stats/types.ts";

const NOW = Date.parse("2026-11-04T15:30:00Z");
const bits = (mask) => Array.from({ length: POINTS }, (_, k) => k).filter((k) => mask & (1 << k));

// Ranges -----------------------------------------------------------------------------------------

test("parseRange takes the four ranges and falls back to 28 days", () => {
  assert.equal(parseRange("7d"), "7d");
  assert.equal(parseRange("lifetime"), "lifetime");
  assert.equal(parseRange(["90d", "7d"]), "90d");
  assert.equal(parseRange("3d"), "28d");
  assert.equal(parseRange(undefined), "28d");
});

test("a range of n days ends today in UTC and starts n - 1 days before, like stats_range_from()", () => {
  assert.deepEqual(rangeBounds("7d", NOW), { from: "2026-10-29", to: "2026-11-04", days: 7 });
  assert.deepEqual(rangeBounds("28d", NOW), { from: "2026-10-08", to: "2026-11-04", days: 28 });
  assert.deepEqual(rangeBounds("90d", NOW), { from: "2026-08-07", to: "2026-11-04", days: 90 });
  // Late in the evening west of UTC it is already the next UTC day.
  assert.equal(rangeBounds("7d", Date.parse("2026-11-04T23:30:00-05:00")).to, "2026-11-05");
});

test("lifetime starts on the day the channel was made, never after today", () => {
  assert.deepEqual(rangeBounds("lifetime", NOW, "2026-01-15T10:00:00Z"), { from: "2026-01-15", to: "2026-11-04", days: 294 });
  assert.equal(rangeBounds("lifetime", NOW, "2027-01-01").from, "2026-11-04");
  assert.equal(rangeBounds("lifetime", NOW, null).days, 1);
});

test("day maths crosses months, years and leap days", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2028-03-01", -1), "2028-02-29");
  assert.equal(daysBetween("2026-11-01", "2026-11-01"), 1);
  assert.equal(daysBetween("2026-11-02", "2026-11-01"), 0);
});

test("fillDays puts a zero on every day without a row and drops rows outside the range", () => {
  const out = fillDays(
    [
      { day: "2026-11-02", views: 5, watchS: 60 },
      { day: "2026-10-01", views: 99, watchS: 1 },
    ],
    "2026-11-01",
    "2026-11-04",
  );
  assert.deepEqual(out.map((d) => d.day), ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  assert.deepEqual(out.map((d) => d.views), [0, 5, 0, 0]);
});

test("fillHours gives 48 hours ending with the current one", () => {
  const out = fillHours([{ hour: "2026-11-04T15:00:00+00:00", views: 3 }, { hour: "2026-11-02T15:00:00Z", views: 7 }], NOW);
  assert.equal(out.length, REALTIME_HOURS);
  assert.equal(new Date(out.at(-1).hour).toISOString(), "2026-11-04T15:00:00.000Z");
  assert.equal(new Date(out[0].hour).toISOString(), "2026-11-02T16:00:00.000Z");
  assert.equal(out.at(-1).views, 3);
  assert.equal(out.reduce((n, h) => n + h.views, 0), 3, "an hour older than 48 hours is left out");
});

// Numbers ----------------------------------------------------------------------------------------

test("average view duration and percentage, the like share", () => {
  assert.equal(averageViewS(600, 4), 150);
  assert.equal(averageViewS(600, 0), 0);
  assert.equal(averagePercent(600, 4, 300), 50);
  assert.equal(averagePercent(600, 1, 300), 100, "never over 100");
  assert.equal(averagePercent(600, 4, null), null);
  assert.equal(likeShare(9, 1), 90);
  assert.equal(likeShare(0, 0), null);
  assert.equal(clock(187), "3:07");
  assert.equal(clock(3723), "1:02:03");
  assert.equal(signed(12), "+12");
  assert.equal(signed(-3), "-3");
  assert.equal(signed(0), "0");
  assert.equal(percent(12.34), "12.3%");
  assert.equal(percent(100), "100%");
});

test("error codes and statuses", () => {
  assert.equal(statsErrorCode("stats_off"), "stats_off");
  assert.equal(statsErrorCode("permission denied for function studio_analytics"), "not_signed_in");
  assert.equal(statsErrorCode("boom"), "failed");
  assert.equal(statsStatus("stats_off"), 403);
  assert.equal(statsStatus("not_allowed"), 403);
  assert.equal(statsStatus("not_found"), 404);
  assert.equal(statsStatus("rate_limited"), 429);
  assert.equal(statsStatus("bad_range"), 400);
  assert.equal(statsStatus("not_signed_in"), 401);
});

// Retention ----------------------------------------------------------------------------------------

test("a ping marks the 5% parts its stretch covers", () => {
  // 100 seconds: each part is 5 seconds.
  assert.deepEqual(bits(markReached(0, 0, 0, 100)), [0]);
  assert.deepEqual(bits(markReached(0, 0, 10, 100)), [0, 1, 2]);
  assert.deepEqual(bits(markReached(0, 12, 17, 100)), [2, 3]);
  // Backwards stretches and negative starts are read the sensible way.
  assert.deepEqual(bits(markReached(0, 10, 0, 100)), [0, 1, 2]);
  assert.deepEqual(bits(markReached(0, -5, 3, 100)), [0]);
  // Unknown length: nothing to mark.
  assert.equal(markReached(5, 0, 10, null), 5);
  assert.equal(markReached(0, 0, 10, 0), 0);
});

test("the end bit is the last second, or the last 5% of a short video", () => {
  assert.deepEqual(bits(markReached(0, 95, 99.2, 100)), [19, END_BIT]);
  assert.deepEqual(bits(markReached(0, 95, 98.9, 100)), [19]);
  assert.deepEqual(bits(markReached(0, 9, 9.6, 10)), [18, 19, END_BIT]);
  assert.deepEqual(bits(markReached(0, 9, 9.4, 10)), [18]);
});

test("markPing is the stretch before the position, at most 60 seconds, clamped to the length", () => {
  assert.deepEqual(bits(markPing(0, 50, 40, 100)), [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(bits(markPing(0, 300, 200, 400)), bits(markReached(0, 240, 300, 400)));
  assert.deepEqual(bits(markPing(0, 130, 10, 100)), [18, 19, END_BIT]);
  // A seek ahead plays nothing in between: only the stretch after the jump.
  const watched = markPing(markPing(markPing(0, 0, 0, 100), 10, 10, 100), 80, 5, 100);
  assert.deepEqual(bits(watched), [0, 1, 2, 15, 16]);
});

test("the same pings as the SQL test of 015 give the same buckets", () => {
  // Signed in: start at 0, 10 played to 10, 40 played to 50. Signed out: start at 95, 4.5 to 99.5, 0.5 to 100.
  const a = [[0, 0], [10, 10], [50, 40]].reduce((m, [p, s]) => markPing(m, p, s, 100), 0);
  const b = [[95, 0], [99.5, 4.5], [100, 0.5]].reduce((m, [p, s]) => markPing(m, p, s, 100), 0);
  assert.equal(a, 2047);
  assert.equal(b, 1572864);
  assert.deepEqual(bucketsFromMasks([a, b, 0]), {
    viewers: 2,
    buckets: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
  });
});

test("days add up and the curve is the share still watching at each 5%", () => {
  const day1 = bucketsFromMasks([0b1111, 0b11]);
  const day2 = bucketsFromMasks([(1 << 21) - 1]);
  const all = addCounts([day1, day2]);
  assert.equal(all.viewers, 3);
  const curve = retentionCurve(all);
  assert.equal(curve.length, POINTS);
  assert.deepEqual(curve.slice(0, 5).map((p) => Math.round(p.share)), [100, 100, 67, 67, 33]);
  assert.equal(curve[0].at, 0);
  assert.equal(curve.at(-1).at, 100);
  assert.equal(Math.round(curve.at(-1).share), 33);
  assert.equal(halfwayPoint(curve), 20);
  assert.deepEqual(retentionCurve({ viewers: 0, buckets: [] }), []);
});

// Charts --------------------------------------------------------------------------------------------

test("nice steps are 1, 2, 2.5 or 5 times a power of ten", () => {
  assert.equal(niceStep(0.7), 1);
  assert.equal(niceStep(1.3), 2);
  assert.equal(niceStep(2.2), 2.5);
  assert.equal(niceStep(37), 50);
  assert.equal(niceStep(1200), 2000);
  assert.equal(niceStep(0), 1);
});

test("niceScale holds the maximum with round ticks", () => {
  assert.deepEqual(niceScale(87, 4), { max: 100, step: 25, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(niceScale(4, 4, true), { max: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
  assert.deepEqual(niceScale(3, 4, true).ticks, [0, 1, 2, 3], "views never get half steps");
  assert.deepEqual(niceScale(0, 4, true), { max: 1, step: 1, ticks: [0, 1] });
  assert.deepEqual(niceScale(0.3, 4).ticks, [0, 0.1, 0.2, 0.3]);
  const s = niceScale(48213, 4, true);
  assert.ok(s.max >= 48213 && s.ticks.length <= 6);
});

test("positions, the line and the area", () => {
  const s = niceScale(10, 2, true);
  assert.equal(yFor(0, s, 100), 100);
  assert.equal(yFor(10, s, 100), 0);
  assert.equal(yFor(99, s, 100), 0, "clamped to the top");
  assert.equal(xFor(0, 3, 200), 0);
  assert.equal(xFor(2, 3, 200), 200);
  assert.equal(xFor(0, 1, 200), 100, "a single point sits in the middle");
  assert.equal(linePath([0, 5, 10], s, 200, 100), "M0,100L100,50L200,0");
  assert.equal(areaPath([0, 10], s, 200, 100), "M0,100L200,0L200,100L0,100Z");
  assert.equal(areaPath([], s, 200, 100), "");
});

test("bars fill their slots with a gap and stand on the axis", () => {
  const s = niceScale(10, 2, true);
  const out = bars([10, 5, 0, 10], s, 400, 100);
  assert.equal(out.length, 4);
  assert.deepEqual(out[0], { x: 10, y: 0, width: 80, height: 100 });
  assert.deepEqual(out[1], { x: 110, y: 50, width: 80, height: 50 });
  assert.equal(out[2].height, 0);
  assert.ok(bars(Array(2000).fill(1), s, 400, 100).every((b) => b.width >= 1), "at least a pixel wide");
});

test("the mouse finds the nearest point and the slot", () => {
  assert.equal(nearestIndex(0, 28, 540), 0);
  assert.equal(nearestIndex(540, 28, 540), 27);
  assert.equal(nearestIndex(271, 28, 540), 14);
  assert.equal(nearestIndex(-10, 28, 540), 0);
  assert.equal(slotIndex(0, 4, 400), 0);
  assert.equal(slotIndex(399, 4, 400), 3);
  assert.equal(slotIndex(500, 4, 400), 3);
});

test("labelIndexes keeps the first and the last and spaces the rest", () => {
  assert.deepEqual(labelIndexes(5, 7), [0, 1, 2, 3, 4]);
  assert.deepEqual(labelIndexes(28, 5), [0, 7, 14, 21, 27]);
  assert.deepEqual(labelIndexes(90, 4), [0, 30, 60, 89]);
  const crowded = labelIndexes(10, 4);
  assert.equal(crowded[0], 0);
  assert.equal(crowded.at(-1), 9);
  assert.ok(crowded.length <= 4);
  assert.deepEqual(labelIndexes(0, 4), []);
});

test("compact numbers for the axis", () => {
  assert.equal(compact(950), "950");
  assert.equal(compact(1200), "1.2K");
  assert.equal(compact(34000), "34K");
  assert.equal(compact(1_500_000), "1.5M");
  assert.equal(compact(2.5), "2.5");
});

// Traffic sources ---------------------------------------------------------------------------------

test("the source of a view comes from the previous page in the app", () => {
  assert.equal(sourceOfPath("/"), "home");
  assert.equal(sourceOfPath("/results?search_query=pancakes"), "search");
  assert.equal(sourceOfPath("/feed/subscriptions"), "subscriptions");
  assert.equal(sourceOfPath("/@samplekitchen"), "channel");
  assert.equal(sourceOfPath("/@samplekitchen/videos"), "channel");
  assert.equal(sourceOfPath("/shorts/f0000000-0000-4000-8000-000000000001"), "shorts");
  assert.equal(sourceOfPath("/watch?v=x"), "other");
  assert.equal(sourceOfPath("/feed/history"), "other");
  for (const p of ["/", "/results", "/watch"]) assert.ok(SOURCES.includes(sourceOfPath(p)));
});

test("the first page of a visit uses the referrer: this site by path, another site as external, none as direct", () => {
  const origin = "https://example.com";
  assert.equal(viewSource("/results", "https://elsewhere.example/", origin), "search", "the app's own path wins");
  assert.equal(viewSource(null, "", origin), "direct");
  assert.equal(viewSource(null, "not a url", origin), "direct");
  assert.equal(viewSource(null, "https://elsewhere.example/post", origin), "external");
  assert.equal(viewSource(null, "https://example.com/@samplekitchen", origin), "channel");
});

// Readers -------------------------------------------------------------------------------------------

test("readChannelAnalytics fills the days and reads the top videos", () => {
  const link = (id, name) => `/thumbs/${id}/${name ?? "thumb-1.webp"}`;
  const a = readChannelAnalytics(
    {
      range: "7d",
      from: "2026-10-29",
      to: "2026-11-04",
      channel: { id: "c1", handle: "sample", name: "Sample", subscribers: "12" },
      totals: { views: 9, watch_s: 900, subs_gained: 3, subs_lost: 1, viewers: 7 },
      daily: [{ day: "2026-11-01", views: 9, watch_s: 900 }],
      top: [
        { id: "v1", title: "One", status: "ready", views: 6, watch_s: 600, thumbnail_name: null },
        { id: "v2", title: "Two", status: "processing", views: 3, watch_s: 300 },
      ],
    },
    link,
  );
  assert.equal(a.daily.length, 7);
  assert.equal(a.daily[3].views, 9);
  assert.deepEqual(a.totals, { views: 9, watchS: 900, subsGained: 3, subsLost: 1, viewers: 7 });
  assert.equal(a.channel.subscribers, 12);
  assert.equal(a.top[0].thumbnail, "/thumbs/v1/thumb-1.webp");
  assert.equal(a.top[1].thumbnail, null);
  const empty = readChannelAnalytics(null, link);
  assert.equal(empty.channel, null);
  assert.equal(empty.daily.length, 1);
});

test("readVideoAnalytics keeps 21 buckets and only known sources", () => {
  const a = readVideoAnalytics(
    {
      range: "lifetime",
      from: "2026-11-01",
      to: "2026-11-04",
      video: { id: "v1", title: "One", status: "ready", duration_s: "100", views: 3, likes: 2, dislikes: 1, comments: 4 },
      totals: { views: 3, watch_s: 150, likes: 2, dislikes: 1, comments: 4, viewers: 3 },
      daily: [],
      retention: { viewers: 2, buckets: [2, 2, 1] },
      sources: [
        { source: "search", views: 1, watch_s: 50 },
        { source: "made_up", views: 9, watch_s: 9 },
        { source: "home", views: 2, watch_s: 100 },
      ],
    },
    () => null,
  );
  assert.equal(a.range, "lifetime");
  assert.equal(a.video.durationS, 100);
  assert.equal(a.retention.buckets.length, POINTS);
  assert.deepEqual(a.retention.buckets.slice(0, 4), [2, 2, 1, 0]);
  assert.deepEqual(a.sources.map((s) => s.source), ["home", "search"]);
  assert.equal(a.daily.length, 4);
});

test("readRealtime fills 48 hours", () => {
  const h = readRealtime([{ hour: "2026-11-04T14:00:00+00:00", views: 2 }, { nope: 1 }], NOW);
  assert.equal(h.length, 48);
  assert.equal(h.at(-2).views, 2);
});

test("day labels are UTC days", async () => {
  const { dayLabel, dayTitle, viewsText } = await import("../lib/stats/rules.ts");
  assert.equal(dayLabel("2026-11-04"), "Nov 4");
  assert.equal(dayTitle("2026-11-04"), "Wed, Nov 4, 2026");
  assert.equal(viewsText(1), "1 view");
  assert.equal(viewsText(1204), "1,204 views");
});
