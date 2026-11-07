// The storage_cleanup drain (014_studio.sql) with the Supabase and S3 clients faked.
import assert from "node:assert/strict";
import { test } from "node:test";
import { drainCleanup, isCleanupPrefix } from "../lib/cleanup.mjs";
import { createDb } from "../lib/db.mjs";
import { runLoop } from "../lib/loop.mjs";
import { createStorage } from "../lib/storage.mjs";

const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const OWNER = "11111111-2222-3333-4444-555555555555";
const HLS = `hls/${VIDEO}/`;
const SRC = `uploads/${OWNER}/${VIDEO}/`;

/** A bucket in memory behind the two S3 commands deletePrefix uses. */
function fakeS3(keys, { failDelete = false } = {}) {
  const objects = new Set(keys);
  const sent = [];
  return {
    objects,
    sent,
    async send(cmd) {
      const name = cmd.constructor.name;
      sent.push(name);
      if (name === "ListObjectsV2Command") {
        const all = [...objects].filter((k) => k.startsWith(cmd.input.Prefix)).sort();
        return { Contents: all.slice(0, cmd.input.MaxKeys).map((Key) => ({ Key })) };
      }
      if (name === "DeleteObjectsCommand") {
        if (failDelete) return { Errors: [{ Key: "x", Code: "AccessDenied", Message: "Access Denied" }] };
        for (const o of cmd.input.Delete.Objects) objects.delete(o.Key);
        return {};
      }
      throw new Error(`unexpected ${name}`);
    },
  };
}

/** claim_cleanup, cleanup_done and cleanup_failed like the SQL. */
function fakeSupabase(prefixes) {
  const rows = prefixes.map((prefix, i) => ({ id: `c${i}`, prefix, status: "queued", attempts: 0, deleted: null, error: null }));
  return {
    rows,
    async rpc(name, args) {
      if (name === "claim_cleanup") {
        const picked = rows.filter((r) => (r.status === "queued" || r.status === "failed") && r.attempts < 5).slice(0, args.lim);
        for (const r of picked) Object.assign(r, { status: "running", attempts: r.attempts + 1 });
        return { data: picked.map((r) => ({ id: r.id, prefix: r.prefix, attempt: r.attempts })), error: null };
      }
      const r = rows.find((x) => x.id === args.cleanup_id);
      if (name === "cleanup_done") Object.assign(r, { status: "done", deleted: args.deleted });
      else if (name === "cleanup_failed") Object.assign(r, { status: "failed", error: args.error });
      else if (name === "claim_encode_job") return { data: [], error: null };
      return { data: null, error: null };
    },
  };
}

const quiet = () => {};
const config = { workerName: "test-worker", workDir: "/nonexistent-never-used", stateDir: null };

test("isCleanupPrefix: only a video's own two folders", () => {
  assert.equal(isCleanupPrefix(HLS), true);
  assert.equal(isCleanupPrefix(SRC), true);
  for (const bad of ["", "hls/", "uploads/", `hls/${VIDEO}`, "hls/../", `uploads/${OWNER}/`, `other/${VIDEO}/`, null]) {
    assert.equal(isCleanupPrefix(bad), false, String(bad));
  }
});

test("deletePrefix: every page under the prefix and nothing else", async () => {
  const keys = [
    ...Array.from({ length: 2500 }, (_, i) => `${HLS}720p/seg_${String(i).padStart(5, "0")}.m4s`),
    `${HLS}master.m3u8`,
    `hls/${VIDEO.replace("1", "2")}/master.m3u8`,
  ];
  const s3 = fakeS3(keys);
  const n = await createStorage(s3, "bucket").deletePrefix(HLS);
  assert.equal(n, 2501);
  assert.deepEqual([...s3.objects], [`hls/${VIDEO.replace("1", "2")}/master.m3u8`]);
  assert.equal(s3.sent.filter((c) => c === "DeleteObjectsCommand").length, 3);
});

test("drainCleanup: deletes, reports done with the count, and fails a folder R2 would not empty", async () => {
  const supabase = fakeSupabase([HLS, SRC]);
  const s3 = fakeS3([`${HLS}a.webp`, `${HLS}b.m4s`, `${SRC}source.mp4`]);
  const result = await drainCleanup({ db: createDb(supabase), storage: createStorage(s3, "bucket"), log: quiet, config });
  assert.deepEqual(result, { done: 2, failed: 0 });
  assert.deepEqual(supabase.rows.map((r) => [r.status, r.deleted]), [["done", 2], ["done", 1]]);
  assert.equal(s3.objects.size, 0);

  const failing = fakeSupabase([HLS]);
  const r2 = await drainCleanup({ db: createDb(failing), storage: createStorage(fakeS3([`${HLS}a.webp`], { failDelete: true }), "bucket"), log: quiet, config });
  assert.deepEqual(r2, { done: 0, failed: 1 });
  assert.equal(failing.rows[0].status, "failed");
  assert.match(failing.rows[0].error, /Access Denied/);
});

test("drainCleanup: a prefix the database should never hand out is refused, not deleted", async () => {
  const supabase = fakeSupabase(["hls/"]);
  const s3 = fakeS3(["hls/anything"]);
  const result = await drainCleanup({ db: createDb(supabase), storage: createStorage(s3, "bucket"), log: quiet, config });
  assert.deepEqual(result, { done: 0, failed: 1 });
  assert.equal(s3.objects.size, 1);
  assert.match(supabase.rows[0].error, /refusing/);
});

test("drainCleanup: null when the database cannot be asked", async () => {
  const db = { claimCleanup: async () => { throw new Error("offline"); } };
  assert.equal(await drainCleanup({ db, storage: {}, log: quiet, config }), null);
});

test("runLoop: an idle worker drains the cleanup queue, then waits cleanupEveryMs before the next round", async () => {
  const supabase = fakeSupabase([HLS]);
  const s3 = fakeS3([`${HLS}a.webp`]);
  const stop = new AbortController();
  let claims = 0;
  const db = createDb(supabase);
  const counted = { ...db, claimCleanup: (...a) => (claims++, db.claimCleanup(...a)) };
  let t = 0;
  let ticks = 0;
  const deps = {
    db: { ...counted, claim: async () => (++ticks >= 4 && stop.abort(), null) },
    storage: createStorage(s3, "bucket"),
    log: quiet,
    config: { ...config, workDir: await import("node:os").then((os) => os.tmpdir() + "/sloptube-cleanup-test") },
    stopSignal: stop.signal,
    pollMs: 1,
    cleanupEveryMs: 1000,
    now: () => (t += 400),
  };
  await runLoop(deps);
  assert.equal(supabase.rows[0].status, "done");
  // Ticks at 400, 800, 1200, 1600 ms: a round at 400, the next one at 1600.
  assert.equal(claims, 2);
});
