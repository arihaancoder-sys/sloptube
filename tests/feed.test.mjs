// Feature 6: the pure parts of the home feed.
import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeCursor, encodeCursor } from "../lib/feed/cursor.ts";
import { viewsLabel } from "../lib/feed/format.ts";
import { frameAt, previewFrames, sheetSize, tileStyle } from "../lib/feed/preview.ts";
import { TRENDING_DAYS, trendingScore } from "../lib/feed/score.ts";
import { cardMedia, isFeedKind, rowToCard } from "../lib/feed/types.ts";
import { timeAgo } from "../lib/watch/format.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3_600_000).toISOString();

test("trendingScore: views / hours ^ 1.5", () => {
  assert.equal(trendingScore(1000, hoursAgo(1), NOW), 1000);
  assert.equal(trendingScore(800, hoursAgo(4), NOW), 100); // 4 ^ 1.5 = 8
  assert.ok(Math.abs(trendingScore(1000, hoursAgo(100), NOW) - 1) < 1e-9); // 100 ^ 1.5 = 1000
  // Brand new videos count as one hour old, never divide by zero.
  assert.equal(trendingScore(50, hoursAgo(0), NOW), 50);
  assert.equal(trendingScore(50, hoursAgo(0.1), NOW), 50);
  // Newer beats older at the same views; more views beat fewer at the same age.
  assert.ok(trendingScore(500, hoursAgo(2), NOW) > trendingScore(500, hoursAgo(20), NOW));
  assert.ok(trendingScore(600, hoursAgo(5), NOW) > trendingScore(500, hoursAgo(5), NOW));
  // Outside the 30 day window, no views, or broken input: 0.
  assert.equal(trendingScore(1e9, hoursAgo(TRENDING_DAYS * 24 + 1), NOW), 0);
  assert.equal(trendingScore(0, hoursAgo(3), NOW), 0);
  assert.equal(trendingScore(10, "not a date", NOW), 0);
  assert.equal(trendingScore(NaN, hoursAgo(3), NOW), 0);
});

test("cursor: encode and decode keep Postgres microseconds", () => {
  const c = { publishedAt: "2026-11-04T14:54:43.284525+00:00", id: "0B9F1C2D-1111-4111-8111-111111111111" };
  const s = encodeCursor(c);
  assert.match(s, /^[A-Za-z0-9_-]+$/, "URL safe");
  assert.deepEqual(decodeCursor(s), { publishedAt: c.publishedAt, id: c.id.toLowerCase() });
  for (const stamp of ["2026-11-04T14:54:43Z", "2026-11-04 14:54:43.1+00", "2026-11-04T14:54:43.123456-0500"]) {
    assert.equal(decodeCursor(encodeCursor({ publishedAt: stamp, id: c.id }))?.publishedAt, stamp);
  }
});

test("cursor: broken or made up values are null", () => {
  const b64 = (t) => btoa(t).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(""), null);
  assert.equal(decodeCursor("not base64!"), null);
  assert.equal(decodeCursor("x".repeat(500)), null);
  assert.equal(decodeCursor(b64("2026-11-04T14:54:43Z")), null, "no id");
  assert.equal(decodeCursor(b64("2026-11-04T14:54:43Z|nope")), null, "id not a uuid");
  assert.equal(decodeCursor(b64("yesterday|0b9f1c2d-1111-4111-8111-111111111111")), null, "not a timestamp");
  assert.equal(decodeCursor(b64("2026-13-45T99:99:99Z|0b9f1c2d-1111-4111-8111-111111111111")), null, "impossible date");
  assert.equal(decodeCursor(b64("2026-11-04T14:54:43Z|0b9f1c2d-1111-4111-8111-111111111111|x")), null, "extra part");
  assert.equal(decodeCursor(b64("'); drop table videos;--|0b9f1c2d-1111-4111-8111-111111111111")), null);
});

test("time ago on the cards", () => {
  const ago = (s) => timeAgo(new Date(NOW - s * 1000).toISOString(), NOW);
  assert.equal(ago(5), "Just now");
  assert.equal(ago(60), "1 minute ago");
  assert.equal(ago(59 * 60), "59 minutes ago");
  assert.equal(ago(3600), "1 hour ago");
  assert.equal(ago(3 * 86400), "3 days ago");
  assert.equal(ago(8 * 86400), "1 week ago");
  assert.equal(ago(45 * 86400), "1 month ago");
  assert.equal(ago(800 * 86400), "2 years ago");
  assert.equal(timeAgo(new Date(NOW + 60_000).toISOString(), NOW), "Just now", "clock skew");
  assert.equal(timeAgo(null, NOW), "");
  assert.equal(timeAgo("garbage", NOW), "");
});

test("view counts on the cards: 999, 1.2K, 3.4M", () => {
  assert.equal(viewsLabel(0), "0 views");
  assert.equal(viewsLabel(1), "1 view");
  assert.equal(viewsLabel(999), "999 views");
  assert.equal(viewsLabel(1000), "1K views");
  assert.equal(viewsLabel(1234), "1.2K views");
  assert.equal(viewsLabel(1299), "1.2K views", "rounds down like YouTube");
  assert.equal(viewsLabel(12_345), "12K views");
  assert.equal(viewsLabel(999_999), "999K views");
  assert.equal(viewsLabel(3_456_789), "3.4M views");
  assert.equal(viewsLabel(2_100_000_000), "2.1B views");
  assert.equal(viewsLabel(-5), "0 views");
  assert.equal(viewsLabel(NaN), "0 views");
});

test("sprite preview: which frames play, and when", () => {
  assert.deepEqual(previewFrames(0), []);
  assert.deepEqual(previewFrames(3), [0, 1, 2]);
  assert.deepEqual(previewFrames(10), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(previewFrames(100), [0, 11, 22, 33, 44, 55, 66, 77, 88, 99], "spread from first to last");
  assert.deepEqual(previewFrames(19, 4), [0, 6, 12, 18]);
  assert.deepEqual(previewFrames(50, 1), [0]);
  const frames = [0, 11, 22];
  assert.equal(frameAt(frames, 0, 500), 0);
  assert.equal(frameAt(frames, 499, 500), 0);
  assert.equal(frameAt(frames, 500, 500), 11);
  assert.equal(frameAt(frames, 1200, 500), 22);
  assert.equal(frameAt(frames, 1500, 500), 0, "loops");
  assert.equal(frameAt(frames, -100, 500), 0);
  assert.equal(frameAt([], 1000, 500), -1);
});

test("sprite preview: a tile scaled to fill the thumbnail", () => {
  // A 10 x 2 sheet of 160 x 90 tiles, like worker/lib/sprite.mjs makes.
  const tiles = Array.from({ length: 20 }, (_, i) => ({ x: (i % 10) * 160, y: Math.floor(i / 10) * 90, w: 160, h: 90 }));
  const sheet = sheetSize(tiles);
  assert.deepEqual(sheet, { w: 1600, h: 180 });
  assert.deepEqual(tileStyle(tiles[0], sheet), { backgroundSize: "1000% 200%", backgroundPosition: "0% 0%" });
  assert.deepEqual(tileStyle(tiles[9], sheet), { backgroundSize: "1000% 200%", backgroundPosition: "100% 0%" });
  assert.deepEqual(tileStyle(tiles[12], sheet), { backgroundSize: "1000% 200%", backgroundPosition: "22.22% 100%" });
  // A one tile sprite.
  assert.deepEqual(tileStyle(tiles[0], { w: 160, h: 90 }), { backgroundSize: "100% 100%", backgroundPosition: "0% 0%" });
});

test("thumbnails: public URL with MEDIA_PUBLIC_URL, else the media route, never signed here", () => {
  const v = { id: "AB000000-0000-4000-8000-000000000001", thumbnailUrl: null, hlsKey: "hls/ab000000-0000-4000-8000-000000000001/master.m3u8", spriteKey: "hls/ab000000-0000-4000-8000-000000000001/sprite.vtt" };
  assert.deepEqual(cardMedia(v, "https://media.example.com"), {
    thumbnail: "https://media.example.com/hls/ab000000-0000-4000-8000-000000000001/thumb-1.webp",
    spriteVtt: "https://media.example.com/hls/ab000000-0000-4000-8000-000000000001/sprite.vtt",
  });
  assert.deepEqual(cardMedia(v, null), {
    thumbnail: "/api/media/ab000000-0000-4000-8000-000000000001/thumb-1.webp",
    spriteVtt: "/api/media/ab000000-0000-4000-8000-000000000001/sprite.vtt",
  });
  // The encoder's own thumbnail_url wins, like on the watch page.
  assert.equal(cardMedia({ ...v, thumbnailUrl: "https://media.example.com/x.webp" }, null).thumbnail, "https://media.example.com/x.webp");
  // No sprite, no preview. No hls_key yet: the default folder.
  assert.equal(cardMedia({ ...v, spriteKey: null }, null).spriteVtt, null);
  assert.equal(cardMedia({ ...v, hlsKey: null }, null).thumbnail, "/api/media/ab000000-0000-4000-8000-000000000001/thumb-1.webp");
});

test("rowToCard maps a feed_videos row", () => {
  const card = rowToCard(
    {
      id: "ab000000-0000-4000-8000-000000000001",
      title: "Hello",
      duration_s: "61.5",
      thumbnail_url: null,
      hls_key: "hls/ab000000-0000-4000-8000-000000000001/master.m3u8",
      preview_sprite_key: null,
      published_at: "2026-11-01T00:00:00.123456+00:00",
      views: "1234",
      channel_id: "c1000000-0000-4000-8000-000000000001",
      channel_handle: "sample",
      channel_name: "Sample",
      channel_avatar_url: null,
    },
    null,
  );
  assert.equal(card.durationS, 61.5);
  assert.equal(card.views, 1234);
  assert.equal(card.spriteVtt, null);
  assert.equal(card.publishedAt, "2026-11-01T00:00:00.123456+00:00");
  assert.deepEqual(card.channel, { id: "c1000000-0000-4000-8000-000000000001", handle: "sample", name: "Sample", avatarUrl: null });
  assert.ok(isFeedKind("newest") && isFeedKind("trending") && isFeedKind("channel"));
  assert.ok(!isFeedKind("popular") && !isFeedKind(undefined));
});
