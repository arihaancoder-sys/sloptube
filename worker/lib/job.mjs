// One encode job, from the claimed row to encode_done (or encode_failed).
// Every outside effect comes in through `deps`, so the tests run this with a
// fake database, fake R2 and a fake ffmpeg.
import { mkdir, mkdtemp, rm, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  MASTER_PLAYLIST,
  PROGRESS_STEPS,
  SPRITE_IMAGE,
  SPRITE_VTT,
  buildEncodeArgs,
  buildThumbnailArgs,
  createProgressParser,
  encodePercent,
  renditionPlaylist,
  thumbnailName,
} from "./ffmpeg.mjs";
import { pickRenditions } from "./ladder.mjs";
import { DISK_MARGIN_BYTES, DISK_SOURCE_FACTOR, JOB_TIMEOUT_MS, PROGRESS_EVERY_MS, THUMBNAIL_AT } from "./limits.mjs";
import { human, seconds } from "./log.mjs";
import { buildProbeArgs, parseProbe } from "./probe.mjs";
import { run as realRun } from "./run.mjs";
import { buildVtt, spritePlan } from "./sprite.mjs";
import { hlsPrefix } from "./storage.mjs";

/** A failure with a plain reason. retry = false when trying again cannot help. */
export class JobError extends Error {
  constructor(message, { retry = true } = {}) {
    super(message);
    this.retry = retry;
  }
}

/** Free bytes on the disk that holds path. */
export async function freeBytes(path) {
  const s = await statfs(path);
  return Number(s.bavail) * Number(s.bsize);
}

/** Bytes needed on disk before the download starts. */
export function diskNeeded(sourceBytes) {
  return Math.ceil(sourceBytes * DISK_SOURCE_FACTOR) + DISK_MARGIN_BYTES;
}

/** The source file name in the temp folder: source.<ext> from the R2 key. */
function sourceName(key) {
  const ext = /\.([a-z0-9]{2,4})$/i.exec(key)?.[1] ?? "bin";
  return `source.${ext.toLowerCase()}`;
}

/** What ends up in videos.renditions: one entry per rung, smallest first. */
export function renditionsJson(renditions) {
  return renditions.map((r) => ({
    name: r.name,
    width: r.width,
    height: r.height,
    video_kbps: r.videoKbps,
    audio_kbps: r.audioKbps,
    playlist: renditionPlaylist(r),
  }));
}

/**
 * Runs one job. Never throws: failures go to encode_failed.
 * @returns {Promise<"done" | "queued" | "failed" | "lost">}
 */
export async function processJob(job, deps) {
  const {
    db,
    storage,
    log,
    config,
    run = realRun,
    diskFree = freeBytes,
    timeoutMs = JOB_TIMEOUT_MS,
    progressEveryMs = PROGRESS_EVERY_MS,
    now = () => Date.now(),
  } = deps;
  const ids = { job: job.jobId.slice(0, 8), video: job.videoId.slice(0, 8) };
  const started = now();
  const controller = new AbortController();
  const { signal } = controller;
  const timer = setTimeout(
    () => controller.abort(new JobError("took longer than 2 hours", { retry: false })),
    timeoutMs,
  );
  // A shutdown (docker stop) aborts the job; the next worker tries it again.
  const onStop = () => controller.abort(new JobError("the worker was stopped", { retry: true }));
  deps.stopSignal?.addEventListener("abort", onStop, { once: true });

  let lastSent = -1;
  let lastAt = 0;
  let lost = false;
  const progress = async (pct, force = false) => {
    const p = Math.max(0, Math.min(100, Math.floor(pct)));
    if (p <= lastSent) return;
    if (!force && now() - lastAt < progressEveryMs) return;
    lastSent = p;
    lastAt = now();
    try {
      const running = await db.progress(job.jobId, p);
      if (!running) {
        lost = true;
        controller.abort(new JobError("the job was taken back by the database"));
      }
    } catch (err) {
      log("progress", ids, `could not save progress: ${err.message}`);
    }
  };

  let dir = null;
  try {
    log("claim", { ...ids, attempt: job.attempt, worker: config.workerName }, job.sourceKey);

    // 1. Trust nothing about the upload until R2 says the file is all there.
    if (!job.sourceKey || !(job.sourceBytes > 0)) throw new JobError("the video has no source file", { retry: false });
    const size = await storage.headSize(job.sourceKey, signal);
    if (size === null) throw new JobError("the source file is not in storage", { retry: false });
    if (size !== job.sourceBytes) {
      throw new JobError(`source size ${size} does not match the upload (${job.sourceBytes})`, { retry: false });
    }
    log("head", ids, `source is ${human(size)}, size matches`);

    // 2. Room on disk for the source and everything made from it.
    await mkdir(config.workDir, { recursive: true });
    const free = await diskFree(config.workDir);
    const need = diskNeeded(size);
    if (free < need) throw new JobError(`not enough disk: ${human(free)} free, ${human(need)} needed`);
    log("disk", ids, `${human(free)} free, ${human(need)} needed`);

    dir = await mkdtemp(join(config.workDir, "job-"));
    const out = join(dir, "out");
    await mkdir(out);
    const input = join(dir, sourceName(job.sourceKey));

    // 3. Download.
    let t = now();
    await storage.download(job.sourceKey, input, signal);
    log("download", ids, `${human(size)} in ${seconds(now() - t)}`);
    await progress(PROGRESS_STEPS.downloaded, true);

    // 4. Probe.
    let probe;
    try {
      probe = parseProbe(await run("ffprobe", buildProbeArgs(input), { signal }));
    } catch (err) {
      if (signal.aborted) throw err;
      throw new JobError(`this file could not be read as a video (${err.message})`, { retry: false });
    }
    const renditions = pickRenditions(probe);
    const sprite = spritePlan(probe.durationS);
    log(
      "probe",
      { ...ids, duration: probe.durationS.toFixed(1), size: `${probe.width}x${probe.height}`, audio: probe.hasAudio },
      `renditions ${renditions.map((r) => `${r.name}(${r.width}x${r.height})`).join(" ")}`,
    );

    // 5. Encode: one ffmpeg run for the whole ladder and the sprite.
    t = now();
    await progress(PROGRESS_STEPS.encodeStart, true);
    const pending = [];
    const parse = createProgressParser((s) => pending.push(progress(encodePercent(s, probe.durationS))));
    await run("ffmpeg", buildEncodeArgs({ input, renditions, hasAudio: probe.hasAudio, sprite }), {
      cwd: out,
      signal,
      onStdout: parse,
    });
    await Promise.all(pending);
    log("encode", ids, `${renditions.length} renditions in ${seconds(now() - t)}`);
    await progress(PROGRESS_STEPS.encodeEnd, true);

    // 6. Thumbnails at 10%, 50% and 90%, and the sprite's WebVTT.
    t = now();
    for (const [i, share] of THUMBNAIL_AT.entries()) {
      const at = Math.min(probe.durationS * share, Math.max(0, probe.durationS - 0.1));
      await run("ffmpeg", buildThumbnailArgs({ input, atSeconds: at, output: join(out, thumbnailName(i)) }), { signal });
    }
    await writeFile(join(out, SPRITE_VTT), buildVtt(sprite, probe.durationS, SPRITE_IMAGE));
    log("thumbnails", ids, `${THUMBNAIL_AT.length} thumbnails and a ${sprite.count} frame sprite in ${seconds(now() - t)}`);
    await progress(PROGRESS_STEPS.thumbnails, true);

    // 7. Upload everything under hls/<video>/.
    t = now();
    const prefix = hlsPrefix(job.videoId);
    const span = PROGRESS_STEPS.uploadEnd - PROGRESS_STEPS.thumbnails;
    const sent = await storage.uploadDir(out, prefix, {
      signal,
      onFile: (n, total) => void progress(PROGRESS_STEPS.thumbnails + (span * n) / total),
    });
    log("upload", ids, `${sent.files} files, ${human(sent.bytes)} in ${seconds(now() - t)}`);

    // 8. Done.
    const top = renditions[renditions.length - 1];
    await db.done(job.jobId, {
      durationS: Math.round(probe.durationS * 1000) / 1000,
      width: top.width,
      height: top.height,
      hlsKey: `${prefix}/${MASTER_PLAYLIST}`,
      thumbnailUrl: config.mediaPublicUrl ? `${config.mediaPublicUrl}/${prefix}/${thumbnailName(0)}` : null,
      previewSpriteKey: `${prefix}/${SPRITE_VTT}`,
      renditions: renditionsJson(renditions),
    });
    log("done", ids, `ready in ${seconds(now() - started)}`);
    return "done";
  } catch (caught) {
    const err = signal.aborted && signal.reason instanceof Error ? signal.reason : caught;
    if (lost) {
      log("lost", ids, "the database took the job back, stopping without reporting");
      return "lost";
    }
    const retry = err instanceof JobError ? err.retry : true;
    const message = err instanceof Error ? err.message : String(err);
    try {
      const result = await db.failed(job.jobId, message, retry);
      log("failed", { ...ids, retry, result }, message);
      return result === "queued" ? "queued" : "failed";
    } catch (reportErr) {
      log("failed", ids, `${message} (and encode_failed did not answer: ${reportErr.message})`);
      return "failed";
    }
  } finally {
    clearTimeout(timer);
    deps.stopSignal?.removeEventListener("abort", onStop);
    if (dir) {
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      log("cleanup", ids, "temp folder removed");
    }
  }
}
