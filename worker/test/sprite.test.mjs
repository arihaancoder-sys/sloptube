// The hover preview sprite: timing and the WebVTT file.
import assert from "node:assert/strict";
import { test } from "node:test";
import { buildVtt, spritePlan, vttTime } from "../lib/sprite.mjs";

test("one frame every 5 seconds for short videos", () => {
  assert.deepEqual(spritePlan(12), { interval: 5, count: 3, columns: 3, rows: 1, width: 160, height: 90 });
  assert.deepEqual(spritePlan(60), { interval: 5, count: 12, columns: 10, rows: 2, width: 160, height: 90 });
});

test("never more than 100 frames: long videos space them out", () => {
  const p = spritePlan(3600);
  assert.equal(p.count, 100);
  assert.equal(p.interval, 36);
  assert.equal(p.rows, 10);
  // 500 s is exactly 100 frames at 5 s.
  assert.equal(spritePlan(500).interval, 5);
  assert.equal(spritePlan(500).count, 100);
  assert.equal(spritePlan(501).count, 100);
  assert.equal(spritePlan(501).interval, 5.01);
});

test("a very short video still gets one frame", () => {
  assert.equal(spritePlan(1.2).count, 1);
  assert.equal(spritePlan(0).count, 1);
});

test("vtt times", () => {
  assert.equal(vttTime(0), "00:00:00.000");
  assert.equal(vttTime(83.5), "00:01:23.500");
  assert.equal(vttTime(3723.004), "01:02:03.004");
});

test("the vtt has one cue per frame pointing at its tile", () => {
  const vtt = buildVtt(spritePlan(12), 12);
  assert.equal(
    vtt,
    [
      "WEBVTT",
      "",
      "00:00:00.000 --> 00:00:05.000",
      "sprite.webp#xywh=0,0,160,90",
      "",
      "00:00:05.000 --> 00:00:10.000",
      "sprite.webp#xywh=160,0,160,90",
      "",
      "00:00:10.000 --> 00:00:12.000",
      "sprite.webp#xywh=320,0,160,90",
      "",
    ].join("\n"),
  );
});

test("tiles wrap to the next row after 10", () => {
  const plan = spritePlan(60);
  const cues = buildVtt(plan, 60).split("\n").filter((l) => l.includes("#xywh"));
  assert.equal(cues.length, 12);
  assert.equal(cues[9], "sprite.webp#xywh=1440,0,160,90");
  assert.equal(cues[10], "sprite.webp#xywh=0,90,160,90");
  assert.ok(buildVtt(plan, 60).includes("00:00:55.000 --> 00:01:00.000"));
});
