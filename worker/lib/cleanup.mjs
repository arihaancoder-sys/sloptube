// Empties the R2 folders of videos the trash purged (014_studio.sql).
// purge_trash() queues hls/<video>/ and uploads/<owner>/<video>/ in
// storage_cleanup; this claims a few at a time, deletes every object under
// each prefix and reports back. A folder that fails is tried again later
// (up to 5 times, the database counts).
import { CLEANUP_BATCH } from "./limits.mjs";

/** Only a video's own two folders, never anything wider. Same check as storage_cleanup_prefix_valid. */
export function isCleanupPrefix(prefix) {
  const id = "[0-9a-f-]{36}";
  return typeof prefix === "string" && (new RegExp(`^hls/${id}/$`).test(prefix) || new RegExp(`^uploads/${id}/${id}/$`).test(prefix));
}

/**
 * One round. Returns { done, failed } (0 and 0 when there was nothing), or
 * null when the database could not be asked.
 */
export async function drainCleanup({ db, storage, log, config }, { signal } = {}) {
  let rows;
  try {
    rows = await db.claimCleanup(config.workerName, CLEANUP_BATCH);
  } catch (err) {
    log("cleanup", {}, `could not ask for folders to clean: ${err.message}`);
    return null;
  }
  let done = 0;
  let failed = 0;
  for (const row of rows) {
    if (signal?.aborted) break;
    try {
      if (!isCleanupPrefix(row.prefix)) throw new Error(`refusing to delete under ${JSON.stringify(row.prefix)}`);
      const n = await storage.deletePrefix(row.prefix, signal);
      await db.cleanupDone(row.id, n);
      log("cleanup", { prefix: row.prefix }, `deleted ${n} objects`);
      done++;
    } catch (err) {
      failed++;
      log("cleanup", { prefix: row.prefix, attempt: row.attempt }, `failed: ${err.message}`);
      await db.cleanupFailed(row.id, err.message).catch(() => {});
    }
  }
  return { done, failed };
}
