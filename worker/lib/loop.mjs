// The worker loop: ask for a job, run it, ask again. One job at a time.
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { drainCleanup } from "./cleanup.mjs";
import { processJob } from "./job.mjs";
import { CLEANUP_EVERY_MS, POLL_MS, YAPIN_EVERY_MS } from "./limits.mjs";
import { drainYapin } from "./yapin.mjs";

/** Resolves after ms, or right away when the signal aborts. */
export function sleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * The marker the update script looks at: while it exists the box does not
 * swap the worker for a newer image, so a running encode is not cut off.
 */
async function markBusy(stateDir, job) {
  if (!stateDir) return;
  await writeFile(join(stateDir, "busy"), `${job.jobId}\n`).catch(() => {});
}

async function markIdle(stateDir) {
  if (!stateDir) return;
  await rm(join(stateDir, "busy"), { force: true }).catch(() => {});
}

/**
 * One turn of the loop. Returns the job's result, "idle" when there was
 * nothing to do, or "error" when the database could not be asked.
 */
export async function tick(deps) {
  const { db, log, config } = deps;
  let job;
  try {
    job = await db.claim(config.workerName);
  } catch (err) {
    log("claim", {}, `could not ask for a job: ${err.message}`);
    return "error";
  }
  if (!job) return "idle";
  await markBusy(config.stateDir, job);
  try {
    return await processJob(job, deps);
  } finally {
    await markIdle(config.stateDir);
  }
}

/** Removes job folders a crashed run left in the work folder. Returns how many. */
export async function cleanWorkDir(workDir) {
  await mkdir(workDir, { recursive: true });
  const stale = (await readdir(workDir)).filter((name) => name.startsWith("job-"));
  await Promise.all(stale.map((name) => rm(join(workDir, name), { recursive: true, force: true })));
  return stale.length;
}

/** Polls every POLL_MS until the stop signal aborts. */
export async function runLoop(deps) {
  const { stopSignal, pollMs = POLL_MS, cleanupEveryMs = CLEANUP_EVERY_MS, yapinEveryMs = YAPIN_EVERY_MS, log, now = Date.now } = deps;
  const cleaned = await cleanWorkDir(deps.config.workDir);
  await markIdle(deps.config.stateDir);
  log("start", { worker: deps.config.workerName }, `polling every ${pollMs / 1000}s${cleaned ? `, removed ${cleaned} old job folders` : ""}`);
  let errors = 0;
  let lastCleanup = -Infinity;
  let lastYapin = -Infinity;
  if (!deps.config.siteUrl) log("yapin", {}, "SITE_URL is not set: Yapin' announcements are not posted");
  while (!stopSignal?.aborted) {
    const result = await tick(deps);
    // Between encodes, now and then: the R2 folders of purged videos.
    if (result === "idle" && now() - lastCleanup >= cleanupEveryMs) {
      lastCleanup = now();
      await drainCleanup(deps, { signal: stopSignal });
    }
    // Between encodes: Yapin' announcements of videos that just went public.
    if (result === "idle" && deps.config.siteUrl && deps.db.claimYapin && now() - lastYapin >= yapinEveryMs) {
      lastYapin = now();
      await drainYapin(deps, { signal: stopSignal });
    }
    if (result === "idle") errors = 0;
    if (result === "error") errors++;
    // Back off up to a minute while the database is unreachable.
    if (result === "idle" || result === "error") await sleep(Math.min(pollMs * 2 ** Math.min(errors, 4), 60000), stopSignal);
  }
  log("stop", { worker: deps.config.workerName }, "stopped");
}
