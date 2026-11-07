// What the studio, the /watch stub and /api/videos/[id]/status say about a
// video while the encoder works on it. No imports on purpose, so Node can
// load this file directly in the tests.

/** The studio and the watch stub ask again this often while a video is being processed. */
export const STATUS_POLL_MS = 5000;

export const JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** The encode_jobs row as the app sees it. */
export type JobInfo = { status: JobStatus; progress: number; attempts: number };

/** The answer of /api/videos/[id]/status, and what the pages start with. */
export type LiveStatus = {
  id: string;
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  /** 0 to 100 while waiting or encoding, 100 when ready, null when unknown. */
  progress: number | null;
  /** The job, or null when processing is off or migration 006 is not applied. */
  job: JobInfo | null;
  thumbnailUrl: string | null;
  error: string | null;
};

/** The default thumbnail the encoder writes. Keep in step with worker/lib/ffmpeg.mjs. */
export function defaultThumbnailKey(videoId: string): string {
  return `hls/${videoId.toLowerCase()}/thumb-1.webp`;
}

export function isJobStatus(value: unknown): value is JobStatus {
  return typeof value === "string" && (JOB_STATUSES as readonly string[]).includes(value);
}

/** Reads a row from encode_jobs, or null when it does not look like one. */
export function readJob(row: unknown): JobInfo | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!isJobStatus(r.status)) return null;
  const progress = Math.max(0, Math.min(100, Math.floor(Number(r.progress) || 0)));
  return { status: r.status, progress, attempts: Math.max(0, Math.floor(Number(r.attempts) || 0)) };
}

/** Still on its way to ready: worth asking again. */
export function isActive(status: LiveStatus["status"]): boolean {
  return status === "uploaded" || status === "processing";
}

/** The percent to show, or null when there is nothing to show. */
export function progressFor(status: LiveStatus["status"], job: JobInfo | null): number | null {
  if (status === "ready") return 100;
  if (!isActive(status) || !job) return null;
  return job.status === "running" ? job.progress : 0;
}

/**
 * The short line under the status badge in the studio, or null.
 *   "Processing, 42%"  "Waiting to process"  "Trying again (attempt 2 of 3)"
 */
export function processingLine(s: Pick<LiveStatus, "status" | "job" | "progress">): string | null {
  if (!isActive(s.status) || !s.job) return null;
  if (s.job.status === "running") return `Processing, ${s.progress ?? s.job.progress}%`;
  if (s.job.status === "queued" && s.job.attempts > 0) return `Trying again (attempt ${s.job.attempts + 1} of 3)`;
  return "Waiting to process";
}
