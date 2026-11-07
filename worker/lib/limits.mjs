// Every number the encoder works with, in one place.
// Keep MAX_ATTEMPTS and the stale time in step with supabase/migrations/006_processing.sql.

/** A job is tried this many times before the video is marked failed (encode_max_attempts()). */
export const MAX_ATTEMPTS = 3;

/** A worker stops a job after 2 hours. The database takes a job back after 2 h 15 min. */
export const JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000;

/** How long the worker waits between claim_encode_job calls when there is nothing to do. */
export const POLL_MS = 5000;

/** The shortest gap between two encode_progress calls. */
export const PROGRESS_EVERY_MS = 3000;

/** HLS segment length in seconds. Keyframes are forced on this grid. */
export const SEGMENT_SECONDS = 4;

/**
 * The rendition ladder. A source only gets the rungs it can fill: we never
 * upscale. `height` is the short side, so a portrait 1080x1920 video is "1080p".
 */
export const LADDER = [
  { name: "360p", height: 360, videoKbps: 800, audioKbps: 96 },
  { name: "720p", height: 720, videoKbps: 2800, audioKbps: 128 },
  { name: "1080p", height: 1080, videoKbps: 5000, audioKbps: 128 },
];

/** A source between two rungs gets an extra rung at its own size when it is this much bigger than the rung below. */
export const NATIVE_RUNG_MIN_RATIO = 1.25;

/** Above this frame rate the video bitrates get 1.5 times as many bits. */
export const HIGH_FPS = 31;

/** Thumbnails: where in the video (share of the duration) and how wide. The first is the default. */
export const THUMBNAIL_AT = [0.1, 0.5, 0.9];
export const THUMBNAIL_WIDTH = 1280;

/** The hover preview sprite: one 160x90 frame every 5 s, at most 100 frames, 10 per row. */
export const SPRITE = { width: 160, height: 90, everySeconds: 5, maxFrames: 100, columns: 10 };

/** Free disk needed before a download: the source this many times over, plus a fixed margin. */
export const DISK_SOURCE_FACTOR = 3;
export const DISK_MARGIN_BYTES = 1024 * 1024 * 1024;

/** x264 speed. veryfast keeps a shared vCPU box near real time with good enough quality. */
export const X264_PRESET = "veryfast";

/**
 * How often an idle worker drains storage_cleanup (014_studio.sql): the R2
 * folders of videos the trash purged after 30 days.
 */
export const CLEANUP_EVERY_MS = 10 * 60 * 1000;

/** Folders claimed per cleanup round (claim_cleanup's lim). */
export const CLEANUP_BATCH = 20;

/** How often, between encodes, the worker posts queued Yapin' announcements (feature 16). */
export const YAPIN_EVERY_MS = 15000;
