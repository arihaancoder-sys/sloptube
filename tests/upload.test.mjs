import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_UPLOAD_BYTES,
  PART_SIZE,
  detailsProblem,
  fileProblem,
  fileProblemCode,
  formatBytes,
  formatSpeed,
  keyBelongsTo,
  percentDone,
  planParts,
  sourceKey,
  titleFromFileName,
  videoTypeFor,
} from "../lib/upload/rules.ts";

const MB = 1024 * 1024;
const OWNER = "11111111-2222-3333-4444-555555555555";
const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

test("accepts mp4, mov, webm and mkv", () => {
  assert.equal(videoTypeFor({ name: "a.mp4", type: "video/mp4" }), "video/mp4");
  assert.equal(videoTypeFor({ name: "a.mov", type: "video/quicktime" }), "video/quicktime");
  assert.equal(videoTypeFor({ name: "a.webm", type: "video/webm" }), "video/webm");
  assert.equal(videoTypeFor({ name: "a.mkv", type: "video/x-matroska" }), "video/x-matroska");
});

test("the extension decides when the browser gives no type", () => {
  assert.equal(videoTypeFor({ name: "Holiday.MKV", type: "" }), "video/x-matroska");
  assert.equal(videoTypeFor({ name: "clip.mov", type: "application/octet-stream" }), "video/quicktime");
  assert.equal(videoTypeFor({ name: "clip.m4v", type: "video/x-m4v" }), "video/mp4");
});

test("rejects other files", () => {
  for (const f of [
    { name: "a.avi", type: "video/x-msvideo" },
    { name: "a.gif", type: "image/gif" },
    { name: "mp4", type: "" },
    { name: "notes.txt", type: "text/plain" },
    { name: "fake.mp4", type: "text/plain" },
  ]) {
    assert.equal(videoTypeFor(f), null, f.name);
    assert.equal(fileProblemCode({ ...f, size: 10 }), "bad_type", f.name);
  }
});

test("files must be 1 byte to 2 GB", () => {
  const f = { name: "a.mp4", type: "video/mp4" };
  assert.equal(fileProblem({ ...f, size: 1 }), null);
  assert.equal(fileProblem({ ...f, size: MAX_UPLOAD_BYTES }), null);
  assert.equal(fileProblemCode({ ...f, size: MAX_UPLOAD_BYTES + 1 }), "file_too_big");
  assert.match(fileProblem({ ...f, size: MAX_UPLOAD_BYTES + 1 }), /2 GB/);
  assert.equal(fileProblemCode({ ...f, size: 0 }), "file_empty");
});

test("the title starts as the file name without its extension", () => {
  assert.equal(titleFromFileName("My trip to Lisbon.mp4"), "My trip to Lisbon");
  assert.equal(titleFromFileName("clip.final.mov"), "clip.final");
  assert.equal(titleFromFileName(".mp4"), "Untitled video");
  assert.equal(titleFromFileName("a".repeat(150) + ".mkv").length, 100);
});

test("parts are 16 MB, the last one holds the rest", () => {
  assert.equal(PART_SIZE, 16 * MB);
  assert.deepEqual(planParts(10), [{ partNumber: 1, start: 0, end: 10 }]);
  assert.deepEqual(planParts(16 * MB).length, 1);
  const parts = planParts(40 * MB);
  assert.deepEqual(parts.map((p) => p.partNumber), [1, 2, 3]);
  assert.deepEqual(parts[2], { partNumber: 3, start: 32 * MB, end: 40 * MB });
  assert.equal(planParts(16 * MB + 1).length, 2);
});

test("parts cover every byte exactly once", () => {
  for (const bytes of [1, 5 * MB, 16 * MB - 1, 123_456_789, MAX_UPLOAD_BYTES]) {
    const parts = planParts(bytes);
    assert.equal(parts[0].start, 0);
    assert.equal(parts.at(-1).end, bytes);
    for (let i = 1; i < parts.length; i++) assert.equal(parts[i].start, parts[i - 1].end);
    assert.ok(parts.every((p) => p.end - p.start <= PART_SIZE));
  }
  assert.equal(planParts(MAX_UPLOAD_BYTES).length, 128);
  assert.deepEqual(planParts(0), []);
  assert.deepEqual(planParts(-5), []);
});

test("keys are uploads/<owner>/<video>/source.<ext>", () => {
  assert.equal(sourceKey(OWNER, VIDEO, "video/mp4"), `uploads/${OWNER}/${VIDEO}/source.mp4`);
  assert.equal(sourceKey(OWNER, VIDEO, "video/quicktime"), `uploads/${OWNER}/${VIDEO}/source.mov`);
  assert.equal(sourceKey(OWNER.toUpperCase(), VIDEO, "video/x-matroska"), `uploads/${OWNER}/${VIDEO}/source.mkv`);
  assert.equal(sourceKey(OWNER, VIDEO, "image/png"), null);
  assert.equal(sourceKey("../etc", VIDEO, "video/mp4"), null);
});

test("a key only belongs to its owner", () => {
  const key = sourceKey(OWNER, VIDEO, "video/webm");
  assert.equal(keyBelongsTo(key, OWNER), true);
  assert.equal(keyBelongsTo(key, VIDEO), false);
  assert.equal(keyBelongsTo(`uploads/${OWNER}/../x/source.mp4`, OWNER), false);
});

test("details: title 1 to 100, description up to 5000, a known visibility", () => {
  assert.equal(detailsProblem({ title: "Hi", description: "", visibility: "private" }), null);
  assert.match(detailsProblem({ title: "  ", description: "", visibility: "private" }), /title/);
  assert.match(detailsProblem({ title: "a".repeat(101), visibility: "public" }), /100/);
  assert.match(detailsProblem({ title: "Hi", description: "a".repeat(5001), visibility: "public" }), /5000/);
  assert.match(detailsProblem({ title: "Hi", description: "", visibility: "friends" }), /private/);
});

test("progress numbers read well", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(1536), "1.5 KB");
  assert.equal(formatBytes(250 * MB), "250 MB");
  assert.equal(formatBytes(2 * 1024 * MB), "2.0 GB");
  assert.equal(formatSpeed(4.2 * MB), "4.2 MB/s");
  assert.equal(percentDone(0, 100), 0);
  assert.equal(percentDone(999, 1000), 99);
  assert.equal(percentDone(1000, 1000), 100);
});
