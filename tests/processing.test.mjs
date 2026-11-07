// Feature 4 on the app side: the status route logic and the studio lines.
import assert from "node:assert/strict";
import { test } from "node:test";
import { videoStatus } from "../lib/processing/handler.ts";
import { defaultThumbnailKey, isActive, processingLine, progressFor, readJob } from "../lib/processing/status.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";

function ctx({ userId = OWNER, flag = true, db = true, video = {}, job = null, thumb = "https://r2.example.com/signed" } = {}) {
  const row = { id: VIDEO, owner_id: OWNER, status: "processing", thumbnail_url: null, error: null, ...video };
  return {
    db: db ? { video: async (id) => (id === VIDEO ? row : null), job: async () => job } : null,
    userId: async () => userId,
    flagOn: async () => flag,
    thumbnail: async () => thumb,
  };
}

test("status: errors come before any lookup", async () => {
  assert.deepEqual(await videoStatus(VIDEO, ctx({ db: false })), { status: 503, body: { error: "no_db" } });
  assert.deepEqual(await videoStatus(VIDEO, ctx({ userId: null })), { status: 401, body: { error: "not_signed_in" } });
  assert.deepEqual(await videoStatus(VIDEO, ctx({ flag: false })), { status: 403, body: { error: "processing_off" } });
  assert.deepEqual(await videoStatus("not-a-uuid", ctx()), { status: 404, body: { error: "not_found" } });
});

test("status: owner only, anybody else gets the same 404 as a missing video", async () => {
  assert.deepEqual(await videoStatus(VIDEO, ctx({ userId: OTHER })), { status: 404, body: { error: "not_found" } });
  assert.deepEqual(await videoStatus(OTHER, ctx()), { status: 404, body: { error: "not_found" } });
});

test("status: a running job shows its percent", async () => {
  const r = await videoStatus(VIDEO.toUpperCase(), ctx({ job: { status: "running", progress: 42, attempts: 1 } }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, {
    id: VIDEO,
    status: "processing",
    progress: 42,
    job: { status: "running", progress: 42, attempts: 1 },
    thumbnailUrl: null,
    error: null,
  });
});

test("status: waiting in line is 0%", async () => {
  const r = await videoStatus(VIDEO, ctx({ video: { status: "uploaded" }, job: { status: "queued", progress: 0, attempts: 0 } }));
  assert.equal(r.body.progress, 0);
  assert.equal(r.body.job.status, "queued");
});

test("status: ready gets 100% and a thumbnail, public url first", async () => {
  const signed = await videoStatus(VIDEO, ctx({ video: { status: "ready" }, job: { status: "done", progress: 100, attempts: 1 } }));
  assert.equal(signed.body.progress, 100);
  assert.equal(signed.body.thumbnailUrl, "https://r2.example.com/signed");
  const pub = await videoStatus(VIDEO, ctx({ video: { status: "ready", thumbnail_url: "https://media.example.com/t.webp" } }));
  assert.equal(pub.body.thumbnailUrl, "https://media.example.com/t.webp");
});

test("status: failed carries the reason, without migration 006 there is no job", async () => {
  const r = await videoStatus(VIDEO, ctx({ video: { status: "failed", error: "this file could not be read as a video" } }));
  assert.equal(r.body.error, "this file could not be read as a video");
  assert.equal(r.body.job, null);
  assert.equal(r.body.progress, null);
});

test("readJob cleans what the database sends", () => {
  assert.deepEqual(readJob({ status: "running", progress: "57", attempts: 2 }), { status: "running", progress: 57, attempts: 2 });
  assert.deepEqual(readJob({ status: "running", progress: 250, attempts: -1 }), { status: "running", progress: 100, attempts: 0 });
  assert.equal(readJob({ status: "exploded" }), null);
  assert.equal(readJob(null), null);
});

test("the studio line under the badge", () => {
  const running = { status: "running", progress: 42, attempts: 1 };
  assert.equal(processingLine({ status: "processing", job: running, progress: 42 }), "Processing, 42%");
  assert.equal(processingLine({ status: "uploaded", job: { status: "queued", progress: 0, attempts: 0 }, progress: 0 }), "Waiting to process");
  assert.equal(
    processingLine({ status: "processing", job: { status: "queued", progress: 0, attempts: 1 }, progress: 0 }),
    "Trying again (attempt 2 of 3)",
  );
  assert.equal(processingLine({ status: "ready", job: running, progress: 100 }), null);
  assert.equal(processingLine({ status: "processing", job: null, progress: null }), null);
});

test("progress, polling and the thumbnail key", () => {
  assert.equal(progressFor("ready", null), 100);
  assert.equal(progressFor("uploading", { status: "queued", progress: 0, attempts: 0 }), null);
  assert.equal(progressFor("processing", { status: "queued", progress: 30, attempts: 1 }), 0);
  assert.equal(isActive("uploaded"), true);
  assert.equal(isActive("processing"), true);
  assert.equal(isActive("ready"), false);
  assert.equal(isActive("failed"), false);
  assert.equal(defaultThumbnailKey(VIDEO.toUpperCase()), `hls/${VIDEO}/thumb-1.webp`);
});
