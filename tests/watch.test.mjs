// Feature 5: the pure parts of the watch page and the player.
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatDate, formatTime, formatViews, parseStart, shortCount, startParam, timeAgo } from "../lib/watch/format.ts";
import { clampTime, keyAction, stepVolume } from "../lib/watch/keys.ts";
import { AUTO, levelForSaved, qualityOptions, qualitySummary, SPEEDS, speedLabel } from "../lib/watch/quality.ts";
import { cueAt, parseSpriteVtt, vttSeconds } from "../lib/watch/vtt.ts";

test("formatTime: YouTube player times", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(5.9), "0:05");
  assert.equal(formatTime(65), "1:05");
  assert.equal(formatTime(725), "12:05");
  assert.equal(formatTime(3725), "1:02:05");
  assert.equal(formatTime(36000), "10:00:00");
  assert.equal(formatTime(-3), "0:00");
  assert.equal(formatTime(NaN), "0:00");
  assert.equal(formatTime(Infinity), "0:00");
});

test("parseStart reads ?t= in every shape, startParam writes it", () => {
  assert.equal(parseStart("90"), 90);
  assert.equal(parseStart("90s"), 90);
  assert.equal(parseStart("1m30s"), 90);
  assert.equal(parseStart("1h2m3s"), 3723);
  assert.equal(parseStart("2M"), 120);
  assert.equal(parseStart(""), 0);
  assert.equal(parseStart(null), 0);
  assert.equal(parseStart("soon"), 0);
  assert.equal(parseStart("-5"), 0);
  assert.equal(startParam(83.9), "83");
  assert.equal(startParam(-1), "0");
});

test("views, short counts and dates", () => {
  assert.equal(formatViews(0), "0 views");
  assert.equal(formatViews(1), "1 view");
  assert.equal(formatViews(1234567), "1,234,567 views");
  assert.equal(shortCount(999), "999");
  assert.equal(shortCount(1234), "1.2K");
  assert.equal(shortCount(12345), "12K");
  assert.equal(shortCount(1500000), "1.5M");
  assert.equal(formatDate("2026-11-04T10:00:00Z"), "Nov 4, 2026");
  assert.equal(formatDate(null), "");
  const now = Date.parse("2026-11-04T12:00:00Z");
  assert.equal(timeAgo("2026-11-04T11:59:30Z", now), "Just now");
  assert.equal(timeAgo("2026-11-04T09:00:00Z", now), "3 hours ago");
  assert.equal(timeAgo("2026-11-03T12:00:00Z", now), "1 day ago");
  assert.equal(timeAgo("2025-10-01T12:00:00Z", now), "1 year ago");
});

test("quality menu: highest first, Auto last, duplicates and sizeless levels dropped", () => {
  const levels = [
    { height: 360, width: 640, bitrate: 800e3 },
    { height: 1080, width: 1920, bitrate: 5e6 },
    { height: 720, width: 1280, bitrate: 2.5e6 },
    { height: 720, width: 1280, bitrate: 3e6 },
    { height: 0 },
  ];
  const opts = qualityOptions(levels);
  assert.deepEqual(
    opts.map((o) => [o.label, o.level, o.hd]),
    [
      ["1080p", 1, true],
      ["720p", 3, true],
      ["360p", 0, false],
      ["Auto", AUTO, false],
    ],
  );
});

test("quality menu: portrait video is labeled by its short side", () => {
  const opts = qualityOptions([
    { height: 1280, width: 720 },
    { height: 640, width: 360 },
  ]);
  assert.deepEqual(opts.map((o) => o.label), ["720p", "360p", "Auto"]);
});

test("quality menu: the remembered choice, or the closest one below it", () => {
  const opts = qualityOptions([{ height: 360 }, { height: 720 }]);
  assert.equal(levelForSaved(opts, "720p"), 1);
  assert.equal(levelForSaved(opts, "1080p"), 1);
  assert.equal(levelForSaved(opts, "480p"), 0);
  assert.equal(levelForSaved(opts, "240p"), AUTO);
  assert.equal(levelForSaved(opts, "Auto"), AUTO);
  assert.equal(levelForSaved(opts, null), AUTO);
  assert.equal(qualitySummary(opts, AUTO, 1), "Auto (720p)");
  assert.equal(qualitySummary(opts, AUTO, -1), "Auto");
  assert.equal(qualitySummary(opts, 0, 1), "360p");
});

test("speeds go from 0.25 to 2, 1 is Normal", () => {
  assert.equal(SPEEDS[0], 0.25);
  assert.equal(SPEEDS[SPEEDS.length - 1], 2);
  assert.equal(speedLabel(1), "Normal");
  assert.equal(speedLabel(1.5), "1.5");
});

test("keyboard map", () => {
  const k = (key, extra = {}) => keyAction({ key, ...extra });
  assert.deepEqual(k(" "), { type: "toggle-play" });
  assert.deepEqual(k("k"), { type: "toggle-play" });
  assert.deepEqual(k("K"), { type: "toggle-play" });
  assert.deepEqual(k("j"), { type: "seek-by", seconds: -10 });
  assert.deepEqual(k("l"), { type: "seek-by", seconds: 10 });
  assert.deepEqual(k("ArrowLeft"), { type: "seek-by", seconds: -5 });
  assert.deepEqual(k("ArrowRight"), { type: "seek-by", seconds: 5 });
  assert.deepEqual(k("ArrowUp"), { type: "volume-by", delta: 0.05 });
  assert.deepEqual(k("ArrowDown"), { type: "volume-by", delta: -0.05 });
  assert.deepEqual(k("m"), { type: "toggle-mute" });
  assert.deepEqual(k("f"), { type: "fullscreen" });
  assert.deepEqual(k("t"), { type: "theater" });
  assert.deepEqual(k("i"), { type: "pip" });
  assert.deepEqual(k("c"), { type: "captions" });
  assert.deepEqual(k("C"), { type: "captions" });
  assert.deepEqual(k("0"), { type: "seek-percent", percent: 0 });
  assert.deepEqual(k("7"), { type: "seek-percent", percent: 70 });
  assert.deepEqual(k("9"), { type: "seek-percent", percent: 90 });
  assert.equal(k("x"), null);
  assert.equal(k("Enter"), null);
});

test("keyboard map: modifiers and typing leave the keys alone", () => {
  assert.equal(keyAction({ key: "l", ctrlKey: true }), null);
  assert.equal(keyAction({ key: "f", metaKey: true }), null);
  assert.equal(keyAction({ key: "k", altKey: true }), null);
  assert.equal(keyAction({ key: " ", targetTag: "INPUT" }), null);
  assert.equal(keyAction({ key: "m", targetTag: "textarea" }), null);
  assert.equal(keyAction({ key: "m", targetTag: "DIV", targetEditable: true }), null);
  assert.deepEqual(keyAction({ key: "m", targetTag: "BUTTON" }), { type: "toggle-mute" });
  // Space on a focused button or link presses it instead (feature 15).
  assert.equal(keyAction({ key: " ", targetTag: "BUTTON" }), null);
  assert.equal(keyAction({ key: " ", targetTag: "a" }), null);
  assert.deepEqual(keyAction({ key: "k", targetTag: "BUTTON" }), { type: "toggle-play" });
  assert.deepEqual(keyAction({ key: " ", targetTag: "DIV" }), { type: "toggle-play" });
});

test("seeks and volume steps stay in range", () => {
  assert.equal(clampTime(-4, 100), 0);
  assert.equal(clampTime(140, 100), 100);
  assert.equal(clampTime(50, NaN), 50);
  assert.equal(stepVolume(0.98, 0.05), 1);
  assert.equal(stepVolume(0.02, -0.05), 0);
  assert.equal(stepVolume(0.5, 0.05), 0.55);
});

test("sprite vtt: the worker's format, tiles and times", () => {
  const vtt = [
    "WEBVTT",
    "",
    "00:00:00.000 --> 00:00:02.000",
    "sprite.webp#xywh=0,0,160,90",
    "",
    "00:00:02.000 --> 00:00:04.000",
    "sprite.webp#xywh=160,0,160,90",
    "",
    "00:00:04.000 --> 00:00:05.500",
    "sprite.webp#xywh=0,90,160,90",
    "",
    "broken --> cue",
    "nothing",
  ].join("\n");
  const cues = parseSpriteVtt(vtt, "https://tube.example.com/api/media/abc/sprite.vtt");
  assert.equal(cues.length, 3);
  assert.deepEqual(cues[1], {
    start: 2,
    end: 4,
    url: "https://tube.example.com/api/media/abc/sprite.webp",
    x: 160,
    y: 0,
    w: 160,
    h: 90,
  });
  assert.equal(cueAt(cues, 0).x, 0);
  assert.equal(cueAt(cues, 3.9).x, 160);
  assert.equal(cueAt(cues, 4).y, 90);
  assert.equal(cueAt(cues, 99).y, 90);
  assert.equal(cueAt([], 1), null);
  assert.equal(vttSeconds("01:23.500"), 83.5);
  assert.equal(vttSeconds("00:01:23.500"), 83.5);
});
