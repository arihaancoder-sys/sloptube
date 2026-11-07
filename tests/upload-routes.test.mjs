// The sign, complete and abort routes end to end, with the S3 client's send()
// mocked and an in-memory database. Presigning is real (it needs no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { abortUpload, completeUpload, signUpload } from "../lib/upload/handlers.ts";
import { createR2Client, createR2Storage } from "../lib/upload/r2.ts";
import { PART_SIZE, sourceKey } from "../lib/upload/rules.ts";

const OWNER = "11111111-2222-3333-4444-555555555555";
const OTHER = "99999999-8888-7777-6666-555555555555";
const MB = 1024 * 1024;

function setup({ userId = OWNER, flag = true, storage = true, db = true, headSize } = {}) {
  const client = createR2Client({ accountId: "example", accessKeyId: "test-key-id", secretAccessKey: "test-secret" });
  const calls = [];
  const objects = new Map();
  client.send = async (command) => {
    const name = command.constructor.name;
    const input = command.input;
    calls.push({ name, input });
    if (name === "CreateMultipartUploadCommand") return { UploadId: "upload-1" };
    if (name === "CompleteMultipartUploadCommand") {
      objects.set(input.Key, headSize ?? videos.get(input.Key.split("/")[2]).sourceBytes);
      return {};
    }
    if (name === "AbortMultipartUploadCommand") return {};
    if (name === "HeadObjectCommand") {
      if (!objects.has(input.Key)) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: objects.get(input.Key) };
    }
    throw new Error("unexpected " + name);
  };

  const videos = new Map();
  let n = 0;
  const fakeDb = {
    async createUpload(title, bytes, mime) {
      if (bytes > 2 * 1024 * MB) return { error: "file_too_big" };
      const id = `aaaaaaaa-bbbb-cccc-dddd-${String(++n).padStart(12, "0")}`;
      const key = sourceKey(userId, id, mime);
      videos.set(id, { id, ownerId: userId, status: "uploading", sourceKey: key, sourceBytes: bytes, sourceMime: mime, title });
      return { videoId: id, key };
    },
    async getVideo(id) {
      const v = videos.get(id);
      return v && v.ownerId === userId ? { ...v } : null;
    },
    async saveDetails(id, d) {
      Object.assign(videos.get(id), d);
      return null;
    },
    async finishUpload(id) {
      videos.get(id).status = "uploaded";
      return null;
    },
    async abandonUpload(id, reason) {
      Object.assign(videos.get(id), { status: "failed", error: reason });
      return null;
    },
  };

  const ctx = {
    storage: storage ? createR2Storage(client, "sloptube-test") : null,
    db: db ? fakeDb : null,
    userId: async () => userId,
    flagOn: async () => flag,
  };
  return { ctx, calls, videos };
}

test("sign: 501 when R2 is not configured", async () => {
  const { ctx } = setup({ storage: false });
  const res = await signUpload({ title: "a", bytes: 10, mime: "video/mp4" }, ctx);
  assert.equal(res.status, 501);
  assert.equal(res.body.error, "not_configured");
  assert.match(res.body.message, /not configured/);
});

test("sign: signed out, flag off and no database are refused", async () => {
  assert.equal((await signUpload({}, setup({ userId: null }).ctx)).status, 401);
  assert.equal((await signUpload({}, setup({ flag: false }).ctx)).status, 403);
  assert.equal((await signUpload({}, setup({ db: false }).ctx)).status, 503);
});

test("sign: bad files are refused before anything is created", async () => {
  const { ctx, calls, videos } = setup();
  assert.equal((await signUpload({ title: "a", bytes: 10, mime: "image/gif" }, ctx)).status, 415);
  assert.equal((await signUpload({ title: "a", bytes: 3 * 1024 * MB, mime: "video/mp4" }, ctx)).status, 413);
  assert.equal((await signUpload({ title: "a", bytes: 0, mime: "video/mp4" }, ctx)).status, 400);
  assert.equal((await signUpload({ title: " ", bytes: 10, mime: "video/mp4" }, ctx)).status, 400);
  assert.equal(calls.length, 0);
  assert.equal(videos.size, 0);
});

test("sign: starts a multipart upload and presigns one URL per 16 MB part", async () => {
  const { ctx, calls } = setup();
  const res = await signUpload({ title: "Trip", bytes: 40 * MB, mime: "video/webm" }, ctx);
  assert.equal(res.status, 200);
  assert.equal(res.body.uploadId, "upload-1");
  assert.equal(res.body.partSize, PART_SIZE);
  assert.match(res.body.key, new RegExp(`^uploads/${OWNER}/[0-9a-f-]{36}/source\\.webm$`));
  assert.equal(res.body.parts.length, 3);
  assert.deepEqual(calls.map((c) => c.name), ["CreateMultipartUploadCommand"]);
  assert.equal(calls[0].input.Bucket, "sloptube-test");
  assert.equal(calls[0].input.ContentType, "video/webm");

  const url = new URL(res.body.parts[2].url);
  assert.equal(url.hostname, "example.r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/sloptube-test/" + res.body.key);
  assert.equal(url.searchParams.get("partNumber"), "3");
  assert.equal(url.searchParams.get("uploadId"), "upload-1");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "21600");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  // No checksum the browser would have to send.
  assert.equal(url.searchParams.get("x-amz-sdk-checksum-algorithm"), null);
});

test("complete: joins the parts, checks the size, saves the form", async () => {
  const { ctx, calls, videos } = setup();
  const signed = await signUpload({ title: "Trip", bytes: 40 * MB, mime: "video/mp4" }, ctx);
  const { videoId, uploadId } = signed.body;
  const res = await completeUpload(
    {
      videoId,
      uploadId,
      parts: [3, 1, 2].map((n) => ({ partNumber: n, etag: `"etag-${n}"` })),
      title: "Lisbon trip",
      description: "Day one",
      visibility: "unlisted",
    },
    ctx,
  );
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { videoId, status: "uploaded", watchUrl: `/watch?v=${videoId}` });
  const complete = calls.find((c) => c.name === "CompleteMultipartUploadCommand");
  assert.deepEqual(complete.input.MultipartUpload.Parts.map((p) => p.PartNumber), [1, 2, 3]);
  assert.equal(complete.input.MultipartUpload.Parts[0].ETag, '"etag-1"');
  assert.ok(calls.some((c) => c.name === "HeadObjectCommand"));
  const v = videos.get(videoId);
  assert.equal(v.status, "uploaded");
  assert.equal(v.title, "Lisbon trip");
  assert.equal(v.visibility, "unlisted");

  // Completing twice is harmless.
  assert.equal((await completeUpload({ videoId, uploadId, parts: [] }, ctx)).status, 200);
});

test("complete: a size mismatch marks the video failed", async () => {
  const { ctx, videos } = setup({ headSize: 5 });
  const { videoId, uploadId } = (await signUpload({ title: "a", bytes: 20, mime: "video/mp4" }, ctx)).body;
  const res = await completeUpload({ videoId, uploadId, parts: [{ partNumber: 1, etag: "e" }] }, ctx);
  assert.equal(res.status, 422);
  assert.equal(res.body.error, "size_mismatch");
  assert.equal(videos.get(videoId).status, "failed");
});

test("complete: missing or extra parts are refused", async () => {
  const { ctx } = setup();
  const { videoId, uploadId } = (await signUpload({ title: "a", bytes: 20 * MB, mime: "video/mp4" }, ctx)).body;
  const one = [{ partNumber: 1, etag: "e" }];
  assert.equal((await completeUpload({ videoId, uploadId, parts: one }, ctx)).body.error, "bad_parts");
  const dup = [{ partNumber: 1, etag: "e" }, { partNumber: 1, etag: "e" }];
  assert.equal((await completeUpload({ videoId, uploadId, parts: dup }, ctx)).body.error, "bad_parts");
  assert.equal((await completeUpload({ videoId, uploadId, parts: "x" }, ctx)).body.error, "bad_parts");
});

test("complete: bad details are refused before R2 is touched", async () => {
  const { ctx, calls } = setup();
  const { videoId, uploadId } = (await signUpload({ title: "a", bytes: 20, mime: "video/mp4" }, ctx)).body;
  const res = await completeUpload(
    { videoId, uploadId, parts: [{ partNumber: 1, etag: "e" }], title: "", visibility: "private" },
    ctx,
  );
  assert.equal(res.status, 400);
  assert.ok(!calls.some((c) => c.name === "CompleteMultipartUploadCommand"));
});

test("complete and abort: someone else's video is not found", async () => {
  const owner = setup();
  const { videoId, uploadId } = (await signUpload({ title: "a", bytes: 20, mime: "video/mp4" }, owner.ctx)).body;
  const other = { ...owner.ctx, userId: async () => OTHER };
  const parts = [{ partNumber: 1, etag: "e" }];
  assert.equal((await completeUpload({ videoId, uploadId, parts }, other)).status, 404);
  assert.equal((await abortUpload({ videoId, uploadId }, other)).status, 404);
  assert.equal((await completeUpload({ videoId: "not-a-uuid", uploadId, parts }, owner.ctx)).status, 400);
});

test("abort: throws the parts away and marks the video failed", async () => {
  const { ctx, calls, videos } = setup();
  const { videoId, uploadId } = (await signUpload({ title: "a", bytes: 20, mime: "video/mp4" }, ctx)).body;
  const res = await abortUpload({ videoId, uploadId }, ctx);
  assert.equal(res.status, 200);
  const abort = calls.find((c) => c.name === "AbortMultipartUploadCommand");
  assert.equal(abort.input.UploadId, "upload-1");
  assert.equal(abort.input.Key, videos.get(videoId).sourceKey);
  assert.equal(videos.get(videoId).status, "failed");
  assert.equal(videos.get(videoId).error, "cancelled");
});
