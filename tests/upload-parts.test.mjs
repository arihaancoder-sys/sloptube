import assert from "node:assert/strict";
import { test } from "node:test";
import { SpeedMeter, UploadCancelled, uploadParts } from "../lib/upload/parts.ts";
import { planParts } from "../lib/upload/rules.ts";

const SIZE = 10; // tiny parts keep the tests fast
const file = new Blob([new Uint8Array(45)]);
const signed = planParts(45, SIZE).map((p) => ({ partNumber: p.partNumber, url: `https://r2.example/part/${p.partNumber}` }));
const base = { file, parts: signed, partSize: SIZE, backoffMs: () => 1 };

test("uploads every part, at most 3 at a time, and returns ETags in order", async () => {
  let active = 0;
  let most = 0;
  const seen = [];
  const progress = [];
  const result = await uploadParts({
    ...base,
    signal: new AbortController().signal,
    onProgress: (sent) => progress.push(sent),
    putPart: async (url, body, onLoaded) => {
      active++;
      most = Math.max(most, active);
      seen.push(url);
      onLoaded(body.size / 2);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return `"etag-${url.split("/").pop()}"`;
    },
  });
  assert.equal(most, 3);
  assert.equal(seen.length, 5);
  assert.deepEqual(result.map((p) => p.partNumber), [1, 2, 3, 4, 5]);
  assert.equal(result[4].etag, '"etag-5"');
  assert.equal(progress.at(-1), 45);
});

test("a failed part is tried again, up to 3 more times", async () => {
  const tries = new Map();
  const progress = [];
  const result = await uploadParts({
    ...base,
    signal: new AbortController().signal,
    onProgress: (s) => progress.push(s),
    putPart: async (url, body, onLoaded) => {
      const n = (tries.get(url) ?? 0) + 1;
      tries.set(url, n);
      onLoaded(body.size);
      if (url.endsWith("/2") && n <= 3) throw new Error("network error");
      return "e";
    },
  });
  assert.equal(result.length, 5);
  assert.equal(tries.get("https://r2.example/part/2"), 4);
  assert.equal(progress.at(-1), 45);
  assert.ok(progress.every((s) => s <= 45), "progress never counts a part twice");
});

test("gives up after the third retry", async () => {
  const tries = new Map();
  await assert.rejects(
    uploadParts({
      ...base,
      signal: new AbortController().signal,
      putPart: async (url) => {
        tries.set(url, (tries.get(url) ?? 0) + 1);
        if (url.endsWith("/1")) throw new Error("R2 answered 500");
        return "e";
      },
    }),
    /Part 1 failed 4 times: R2 answered 500/,
  );
  assert.equal(tries.get("https://r2.example/part/1"), 4);
});

test("cancel stops the upload", async () => {
  const controller = new AbortController();
  const started = [];
  const promise = uploadParts({
    ...base,
    signal: controller.signal,
    putPart: (url, _b, _l, signal) =>
      new Promise((resolve, reject) => {
        started.push(url);
        signal.addEventListener("abort", () => reject(new UploadCancelled()));
      }),
  });
  await new Promise((r) => setTimeout(r, 5));
  controller.abort();
  await assert.rejects(promise, UploadCancelled);
  assert.equal(started.length, 3);
});

test("the part list must match the file", async () => {
  await assert.rejects(
    uploadParts({ ...base, parts: signed.slice(1), signal: new AbortController().signal, putPart: async () => "e" }),
    /does not match/,
  );
});

test("speed is bytes per second over the last few seconds", () => {
  const m = new SpeedMeter(5000);
  assert.equal(m.add(0, 0), 0);
  assert.equal(m.add(1000, 1000), 1000);
  assert.equal(m.add(4000, 2000), 2000);
  m.add(10_000, 8000);
  // Samples older than 5 s drop out: only 8 s to 9 s counts now.
  assert.equal(m.add(12_000, 9000), 2000);
});
