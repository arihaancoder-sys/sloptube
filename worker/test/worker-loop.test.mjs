// The worker loop end to end with the Supabase client and the S3 client
// mocked, and a fake ffmpeg/ffprobe that writes the files a real encode would.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createDb } from "../lib/db.mjs";
import { runLoop, tick } from "../lib/loop.mjs";
import { createR2Client, createStorage } from "../lib/storage.mjs";

const VIDEO = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
const OWNER = "11111111-2222-3333-4444-555555555555";
const KEY = `uploads/${OWNER}/${VIDEO}/source.mp4`;
const BYTES = 4096;

/** A Supabase client whose rpc() behaves like the functions in 006_processing.sql. */
function fakeSupabase({ jobs = [], claimError = null, progressAnswer = null } = {}) {
  const calls = [];
  const rows = jobs.map((j, i) => ({
    job_id: `00000000-0000-0000-0000-00000000000${i + 1}`,
    video_id: VIDEO,
    owner_id: OWNER,
    source_key: KEY,
    source_bytes: BYTES,
    source_mime: "video/mp4",
    status: "queued",
    attempts: 0,
    ...j,
  }));
  const byId = (id) => rows.find((r) => r.job_id === id);
  return {
    calls,
    rows,
    async rpc(name, args) {
      calls.push({ name, args });
      switch (name) {
        case "claim_encode_job": {
          if (claimError) return { data: null, error: { message: claimError } };
          const job = rows.find((r) => r.status === "queued");
          if (!job) return { data: [], error: null };
          job.status = "running";
          job.attempts++;
          job.worker = args.worker;
          const row = {
            job_id: job.job_id,
            video_id: job.video_id,
            owner_id: job.owner_id,
            source_key: job.source_key,
            // PostgREST sends bigint as a string when it is big; the worker must cope.
            source_bytes: String(job.source_bytes),
            source_mime: job.source_mime,
            attempt: job.attempts,
          };
          return { data: [row], error: null };
        }
        case "encode_progress": {
          const job = byId(args.job_id);
          job.progress = args.pct;
          return { data: progressAnswer ?? job.status === "running", error: null };
        }
        case "encode_done":
          byId(args.job_id).status = "done";
          return { data: "done", error: null };
        case "encode_failed": {
          const job = byId(args.job_id);
          job.error = args.error;
          job.status = args.retry && job.attempts < 3 ? "queued" : "failed";
          return { data: job.status, error: null };
        }
        default:
          return { data: null, error: { message: `unknown rpc ${name}` } };
      }
    },
  };
}

/** The real storage code on an S3 client whose send() is mocked. */
function fakeR2({ size = BYTES } = {}) {
  const client = createR2Client({ accountId: "example", accessKeyId: "test-key-id", secretAccessKey: "test-secret" });
  const sent = [];
  const puts = new Map();
  client.send = async (command) => {
    const name = command.constructor.name;
    const input = command.input;
    sent.push({ name, key: input.Key });
    if (name === "HeadObjectCommand") {
      if (size === null) throw Object.assign(new Error("NotFound"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
      return { ContentLength: size };
    }
    if (name === "GetObjectCommand") return { Body: Readable.from([Buffer.alloc(BYTES, 1)]) };
    if (name === "PutObjectCommand") {
      const chunks = [];
      for await (const c of input.Body) chunks.push(c);
      puts.set(input.Key, { type: input.ContentType, cache: input.CacheControl, bytes: Buffer.concat(chunks).length });
      return {};
    }
    throw new Error("unexpected " + name);
  };
  return { storage: createStorage(client, "videos-test"), sent, puts };
}

const PROBE = JSON.stringify({
  format: { duration: "12.0" },
  streams: [
    { codec_type: "video", codec_name: "h264", width: 1280, height: 720, avg_frame_rate: "30/1" },
    { codec_type: "audio", codec_name: "aac" },
  ],
});

/**
 * Stands in for ffprobe and ffmpeg. The encode writes what the real one
 * would (per variant playlists, init and segments, master, sprite) and
 * reports progress; a thumbnail run writes its output file.
 */
function fakeRun({ failEncode = 0, hang = false } = {}) {
  const runs = [];
  let encodes = 0;
  const fn = async (cmd, args, { cwd, signal, onStdout } = {}) => {
    runs.push({ cmd, args });
    if (cmd === "ffprobe") return PROBE;
    const isEncode = args.includes("-filter_complex");
    if (!isEncode) {
      await writeFile(args.at(-1), "webp");
      return "";
    }
    encodes++;
    if (hang) {
      await new Promise((_, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true }));
    }
    if (encodes <= failEncode) throw new Error("ffmpeg exited with 1: Conversion failed!");
    const names = args[args.indexOf("-var_stream_map") + 1].split(" ").map((s) => s.split("name:")[1]);
    for (const n of names) {
      await mkdir(join(cwd, n), { recursive: true });
      await writeFile(join(cwd, n, "index.m3u8"), "#EXTM3U\n");
      await writeFile(join(cwd, n, "init_0.mp4"), "init");
      await writeFile(join(cwd, n, "seg_00000.m4s"), "seg");
    }
    await writeFile(join(cwd, "master.m3u8"), "#EXTM3U\n");
    await writeFile(join(cwd, "sprite.webp"), "sprite");
    for (const us of [3000000, 6000000, 12000000]) onStdout?.(`out_time_us=${us}\nprogress=continue\n`);
    onStdout?.("progress=end\n");
    return "";
  };
  fn.runs = runs;
  return fn;
}

async function setup(opts = {}) {
  const workDir = await mkdtemp(join(tmpdir(), "sloptube-worker-test-"));
  const stateDir = await mkdtemp(join(tmpdir(), "sloptube-worker-state-"));
  const supabase = fakeSupabase(opts);
  const r2 = fakeR2(opts);
  const lines = [];
  const run = fakeRun(opts);
  const busySeen = [];
  const deps = {
    db: createDb(supabase),
    storage: r2.storage,
    run: async (...a) => {
      busySeen.push(existsSync(join(stateDir, "busy")));
      return run(...a);
    },
    log: (step, fields, text) => lines.push(`${step} ${text ?? ""}`),
    config: { workerName: "test-box", workDir, stateDir, mediaPublicUrl: opts.mediaPublicUrl ?? null },
    diskFree: async () => opts.free ?? 100 * 1024 ** 3,
    progressEveryMs: 0,
    timeoutMs: opts.timeoutMs,
  };
  const cleanup = () => Promise.all([rm(workDir, { recursive: true, force: true }), rm(stateDir, { recursive: true, force: true })]);
  return { deps, supabase, r2, lines, run, workDir, stateDir, busySeen, cleanup };
}

const rpcNames = (s) => s.supabase.calls.map((c) => c.name);

test("claim, progress, upload and done", async () => {
  const s = await setup({ jobs: [{}], mediaPublicUrl: "https://media.example.com" });
  try {
    assert.equal(await tick(s.deps), "done");

    const names = rpcNames(s);
    assert.equal(names[0], "claim_encode_job");
    assert.equal(s.supabase.calls[0].args.worker, "test-box");
    assert.equal(names.at(-1), "encode_done");
    assert.ok(!names.includes("encode_failed"));

    // Progress only goes up, stays below 100 and passes through the encode share.
    const pcts = s.supabase.calls.filter((c) => c.name === "encode_progress").map((c) => c.args.pct);
    assert.deepEqual([...pcts].sort((a, b) => a - b), pcts);
    assert.ok(pcts.includes(47) && pcts.includes(90) && pcts.at(-1) === 99, `progress was ${pcts}`);

    const done = s.supabase.calls.at(-1).args;
    assert.deepEqual(done, {
      job_id: "00000000-0000-0000-0000-000000000001",
      duration_s: 12,
      width: 1280,
      height: 720,
      hls_key: `hls/${VIDEO}/master.m3u8`,
      thumbnail_url: `https://media.example.com/hls/${VIDEO}/thumb-1.webp`,
      preview_sprite_key: `hls/${VIDEO}/sprite.vtt`,
      renditions: [
        { name: "360p", width: 640, height: 360, video_kbps: 800, audio_kbps: 96, playlist: "360p/index.m3u8" },
        { name: "720p", width: 1280, height: 720, video_kbps: 2800, audio_kbps: 128, playlist: "720p/index.m3u8" },
      ],
    });

    // The source was checked before it was downloaded.
    assert.deepEqual(s.r2.sent.slice(0, 2).map((x) => x.name), ["HeadObjectCommand", "GetObjectCommand"]);
    const keys = [...s.r2.puts.keys()].sort();
    assert.deepEqual(keys, [
      `hls/${VIDEO}/360p/index.m3u8`,
      `hls/${VIDEO}/360p/init_0.mp4`,
      `hls/${VIDEO}/360p/seg_00000.m4s`,
      `hls/${VIDEO}/720p/index.m3u8`,
      `hls/${VIDEO}/720p/init_0.mp4`,
      `hls/${VIDEO}/720p/seg_00000.m4s`,
      `hls/${VIDEO}/master.m3u8`,
      `hls/${VIDEO}/sprite.vtt`,
      `hls/${VIDEO}/sprite.webp`,
      `hls/${VIDEO}/thumb-1.webp`,
      `hls/${VIDEO}/thumb-2.webp`,
      `hls/${VIDEO}/thumb-3.webp`,
    ]);
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/master.m3u8`).type, "application/vnd.apple.mpegurl");
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/360p/seg_00000.m4s`).type, "video/iso.segment");
    assert.match(s.r2.puts.get(`hls/${VIDEO}/360p/seg_00000.m4s`).cache, /immutable/);
    assert.equal(s.r2.puts.get(`hls/${VIDEO}/sprite.vtt`).type, "text/vtt; charset=utf-8");

    // Thumbnails at 10%, 50% and 90% of 12 s.
    const seeks = s.run.runs.filter((r) => r.args.includes("-ss")).map((r) => r.args[r.args.indexOf("-ss") + 1]);
    assert.deepEqual(seeks, ["1.200", "6.000", "10.800"]);

    // One line per step, the temp folder is gone and so is the busy marker.
    for (const step of ["claim", "head", "disk", "download", "probe", "encode", "thumbnails", "upload", "done", "cleanup"]) {
      assert.ok(s.lines.some((l) => l.startsWith(step + " ")), `no ${step} line in\n${s.lines.join("\n")}`);
    }
    assert.deepEqual(await readdir(s.workDir), []);
    assert.ok(s.busySeen.every(Boolean), "busy marker was missing during the job");
    assert.equal(existsSync(join(s.stateDir, "busy")), false);
  } finally {
    await s.cleanup();
  }
});

test("without MEDIA_PUBLIC_URL the thumbnail url stays empty", async () => {
  const s = await setup({ jobs: [{}] });
  try {
    assert.equal(await tick(s.deps), "done");
    assert.equal(s.supabase.calls.at(-1).args.thumbnail_url, null);
  } finally {
    await s.cleanup();
  }
});

test("nothing queued: idle, no R2 calls", async () => {
  const s = await setup({ jobs: [] });
  try {
    assert.equal(await tick(s.deps), "idle");
    assert.deepEqual(s.r2.sent, []);
  } finally {
    await s.cleanup();
  }
});

test("the database cannot be reached: error, no job", async () => {
  const s = await setup({ jobs: [{}], claimError: "fetch failed" });
  try {
    assert.equal(await tick(s.deps), "error");
    assert.ok(s.lines.some((l) => l.includes("could not ask for a job: claim_encode_job: fetch failed")));
  } finally {
    await s.cleanup();
  }
});

test("a source whose size does not match the upload is refused without a retry or a download", async () => {
  const s = await setup({ jobs: [{}], size: BYTES - 1 });
  try {
    assert.equal(await tick(s.deps), "failed");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, false);
    assert.match(failed.error, /does not match/);
    assert.ok(!s.r2.sent.some((x) => x.name === "GetObjectCommand"));
  } finally {
    await s.cleanup();
  }
});

test("a missing source is refused without a retry", async () => {
  const s = await setup({ jobs: [{}], size: null });
  try {
    assert.equal(await tick(s.deps), "failed");
    assert.match(s.supabase.rows[0].error, /not in storage/);
  } finally {
    await s.cleanup();
  }
});

test("not enough disk: failed for now, tried again later", async () => {
  const s = await setup({ jobs: [{}], free: 1024 });
  try {
    assert.equal(await tick(s.deps), "queued");
    assert.match(s.supabase.rows[0].error, /not enough disk/);
    assert.ok(!s.r2.sent.some((x) => x.name === "GetObjectCommand"));
  } finally {
    await s.cleanup();
  }
});

test("a broken encode is retried, and works on the second attempt", async () => {
  const s = await setup({ jobs: [{}], failEncode: 1 });
  try {
    assert.equal(await tick(s.deps), "queued");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, true);
    assert.match(failed.error, /Conversion failed/);
    assert.deepEqual(await readdir(s.workDir), [], "temp folder left behind after a failure");

    assert.equal(await tick(s.deps), "done");
    assert.equal(s.supabase.rows[0].attempts, 2);
    assert.equal(s.supabase.rows[0].status, "done");
  } finally {
    await s.cleanup();
  }
});

test("three broken encodes fail the video", async () => {
  const s = await setup({ jobs: [{}], failEncode: 5 });
  try {
    assert.equal(await tick(s.deps), "queued");
    assert.equal(await tick(s.deps), "queued");
    assert.equal(await tick(s.deps), "failed");
    assert.equal(await tick(s.deps), "idle");
    assert.equal(s.supabase.rows[0].status, "failed");
    assert.equal(s.supabase.rows[0].attempts, 3);
  } finally {
    await s.cleanup();
  }
});

test("a job over the time limit is stopped and failed without a retry", async () => {
  const s = await setup({ jobs: [{}], hang: true, timeoutMs: 50 });
  try {
    assert.equal(await tick(s.deps), "failed");
    const failed = s.supabase.calls.find((c) => c.name === "encode_failed").args;
    assert.equal(failed.retry, false);
    assert.equal(failed.error, "took longer than 2 hours");
  } finally {
    await s.cleanup();
  }
});

test("a job the database took back stops without reporting", async () => {
  const s = await setup({ jobs: [{}], progressAnswer: false });
  try {
    assert.equal(await tick(s.deps), "lost");
    assert.ok(!rpcNames(s).includes("encode_failed"));
    assert.ok(!rpcNames(s).includes("encode_done"));
  } finally {
    await s.cleanup();
  }
});

test("the loop runs jobs one after another and stops on the signal", async () => {
  const s = await setup({ jobs: [{}, {}] });
  try {
    const stop = new AbortController();
    let claims = 0;
    const db = s.deps.db;
    const counted = {
      ...db,
      claim: async (w) => {
        claims++;
        const job = await db.claim(w);
        if (!job && claims >= 3) stop.abort();
        return job;
      },
    };
    await mkdir(join(s.workDir, "job-left-by-a-crash"));
    await runLoop({ ...s.deps, db: counted, stopSignal: stop.signal, pollMs: 10 });
    assert.deepEqual(await readdir(s.workDir), []);
    assert.ok(s.lines.some((l) => l.includes("removed 1 old job folders")));
    assert.deepEqual(s.supabase.rows.map((r) => r.status), ["done", "done"]);
    assert.equal(claims, 3);
    assert.ok(s.lines.at(-1).startsWith("stop "));
  } finally {
    await s.cleanup();
  }
});
