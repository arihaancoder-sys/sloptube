// Which renditions a source gets: never upscale, even sizes only.
import assert from "node:assert/strict";
import { test } from "node:test";
import { displaySize, even, evenDown, pickRenditions } from "../lib/ladder.mjs";

const sizes = (list) => list.map((r) => `${r.name} ${r.width}x${r.height}`);

test("a 1080p source gets 360p, 720p and 1080p", () => {
  assert.deepEqual(sizes(pickRenditions({ width: 1920, height: 1080 })), ["360p 640x360", "720p 1280x720", "1080p 1920x1080"]);
});

test("a 720p source gets 360p and 720p, never 1080p", () => {
  const out = pickRenditions({ width: 1280, height: 720 });
  assert.deepEqual(sizes(out), ["360p 640x360", "720p 1280x720"]);
  assert.deepEqual(out.map((r) => r.videoKbps), [800, 2800]);
});

test("a 4K source stops at 1080p", () => {
  assert.deepEqual(sizes(pickRenditions({ width: 3840, height: 2160 })), ["360p 640x360", "720p 1280x720", "1080p 1920x1080"]);
});

test("a source smaller than 360p gets one rendition at its own even size", () => {
  assert.deepEqual(sizes(pickRenditions({ width: 427, height: 241 })), ["240p 426x240"]);
  assert.equal(pickRenditions({ width: 320, height: 180 })[0].videoKbps, 200);
});

test("odd sizes are rounded to even and never above the source", () => {
  const out = pickRenditions({ width: 1279, height: 721 });
  for (const r of out) {
    assert.equal(r.width % 2, 0, `${r.name} width ${r.width}`);
    assert.equal(r.height % 2, 0, `${r.name} height ${r.height}`);
    assert.ok(r.width <= 1279 && r.height <= 721);
  }
  assert.deepEqual(sizes(out), ["360p 638x360", "720p 1278x720"]);
});

test("a source well between two rungs also gets one at its own size", () => {
  assert.deepEqual(sizes(pickRenditions({ width: 1600, height: 900 })), ["360p 640x360", "720p 1280x720", "900p 1600x900"]);
  const native = pickRenditions({ width: 1600, height: 900 })[2];
  assert.ok(native.videoKbps > 2800 && native.videoKbps <= 5000);
  // 760p is too close to 720p to be worth another rendition.
  assert.deepEqual(sizes(pickRenditions({ width: 1352, height: 760 })), ["360p 640x360", "720p 1280x720"]);
});

test("portrait videos use the short side: a 1080x1920 phone video is 1080p", () => {
  assert.deepEqual(sizes(pickRenditions({ width: 1080, height: 1920 })), ["360p 360x640", "720p 720x1280", "1080p 1080x1920"]);
});

test("rotation from the phone swaps width and height", () => {
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: -90 }), { width: 1080, height: 1920 });
  assert.deepEqual(displaySize({ width: 1920, height: 1080, rotation: 180 }), { width: 1920, height: 1080 });
  assert.deepEqual(sizes(pickRenditions({ width: 1280, height: 720, rotation: 90 })), ["360p 360x640", "720p 720x1280"]);
});

test("60 fps sources get 1.5 times the video bitrate", () => {
  assert.deepEqual(pickRenditions({ width: 1280, height: 720, fps: 60 }).map((r) => r.videoKbps), [1200, 4200]);
});

test("even helpers", () => {
  assert.equal(even(361), 362);
  assert.equal(even(359.2), 360);
  assert.equal(evenDown(1279), 1278);
  assert.equal(evenDown(1), 2);
  assert.throws(() => pickRenditions({ width: 0, height: 0 }), /no size/);
});
