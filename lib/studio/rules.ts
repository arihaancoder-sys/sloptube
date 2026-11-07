// The studio's numbers and checks. Keep them in step with
// supabase/migrations/014_studio.sql. No imports, so Node loads it directly.

/** How long the trash keeps a video before it goes for good. Same as studio_trash_days(). */
export const TRASH_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** studio_bulk takes at most this many videos at once. */
export const BULK_MAX = 100;

export const TAGS_MAX = 15;
export const TAG_MAX = 30;
export const TAGS_TOTAL_MAX = 500;

/** A custom thumbnail: 2 MB at most, JPEG, PNG or WebP, like the 2019 Studio. */
export const THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const THUMBNAIL_TYPES: Record<string, "jpg" | "png" | "webp"> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
/** The encoder writes these three stills (worker/lib/ffmpeg.mjs, thumbnailName). */
export const STILLS = ["thumb-1.webp", "thumb-2.webp", "thumb-3.webp"] as const;

// The trash ------------------------------------------------------------------------------

export type TrashExpiry = {
  /** When purge_trash() may delete it, as epoch ms. */
  purgeAt: number;
  /** Whole days left, rounded up, never below 0. */
  daysLeft: number;
  /** True once the 30 days are over (the daily purge has not run yet). */
  expired: boolean;
};

/** When a video put in the trash at deletedAt goes for good, seen at now. */
export function trashExpiry(deletedAt: string | number, now: number = Date.now()): TrashExpiry {
  const at = typeof deletedAt === "number" ? deletedAt : Date.parse(deletedAt);
  const purgeAt = (Number.isFinite(at) ? at : now) + TRASH_DAYS * DAY_MS;
  const left = purgeAt - now;
  return { purgeAt, daysLeft: left <= 0 ? 0 : Math.ceil(left / DAY_MS), expired: left <= 0 };
}

/** "Deleted forever in 30 days", "in 1 day", "today". */
export function trashLabel(e: TrashExpiry): string {
  if (e.expired || e.daysLeft === 0) return "Deleted forever today";
  return `Deleted forever in ${e.daysLeft} ${e.daysLeft === 1 ? "day" : "days"}`;
}

// Tags --------------------------------------------------------------------------------------

/** "cooking, pancakes,, Pancakes " -> ["cooking", "pancakes"]: trimmed, no blanks, no repeats (any case). */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[,\n]/)) {
    const tag = raw.replace(/\s+/g, " ").trim();
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** Why the tags can't be saved, or null. Same as video_tags_are_valid(). */
export function tagsProblem(tags: string[]): string | null {
  if (tags.length > TAGS_MAX) return `Up to ${TAGS_MAX} tags.`;
  if (tags.some((t) => t.length === 0 || t.length > TAG_MAX)) return `Each tag can be up to ${TAG_MAX} characters.`;
  if (tags.some((t) => t !== t.trim() || /[,\n\r\t]/.test(t))) return "Tags can't hold commas or line breaks.";
  if (tags.join(",").length > TAGS_TOTAL_MAX) return `Tags can be up to ${TAGS_TOTAL_MAX} characters in all.`;
  return null;
}

// Thumbnails ------------------------------------------------------------------------------

/** Same as video_thumbnail_name_is_valid(). */
export function isThumbnailName(name: unknown): name is string {
  return typeof name === "string" && /^(thumb-[1-3]\.webp|custom-[a-z0-9]{12,32}\.(jpg|png|webp))$/.test(name);
}

/** A fresh name for a custom thumbnail, from random bytes. */
export function customThumbnailName(mime: string, random: Uint8Array): string | null {
  const ext = THUMBNAIL_TYPES[mime];
  if (!ext || random.length < 8) return null;
  const id = Array.from(random.slice(0, 16), (b) => b.toString(36).padStart(2, "0")).join("").slice(0, 24);
  return `custom-${id}.${ext}`;
}

export function thumbnailFileProblem(file: { type: string; size: number }): string | null {
  if (!THUMBNAIL_TYPES[file.type]) return "Pick a JPG, PNG or WebP image.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > THUMBNAIL_MAX_BYTES) return "Thumbnails can be up to 2 MB.";
  return null;
}

/** The R2 key of a thumbnail file: next to the video's HLS files, so /api/media serves it. */
export function thumbnailKey(videoId: string, name: string): string {
  return `hls/${videoId.toLowerCase()}/${name}`;
}

// Errors ------------------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  studio_off: "The studio isn't on yet.",
  not_signed_in: "Sign in to use the studio.",
  not_found: "That video is gone.",
  not_allowed: "Only the channel owner can change that.",
  rate_limited: "That's a lot of changes at once. Wait a minute and try again.",
  bad_action: "That action isn't available.",
  bad_visibility: "Pick public, unlisted or private.",
  too_many: `Pick up to ${BULK_MAX} videos at once.`,
  in_trash: "Restore the video from the trash first.",
  title_invalid: "Add a title of up to 100 characters.",
  description_invalid: "Descriptions can be up to 5,000 characters.",
  tags_invalid: "Check the tags: up to 15, each up to 30 characters.",
  thumbnail_invalid: "That thumbnail can't be used.",
  not_ready: "Thumbnails can be changed once the video is processed.",
  storage_not_configured: "Uploads aren't configured on this server.",
  upload_failed: "The upload didn't go through. Try again.",
  bad_request: "Something was off with that request.",
  // Moderation (016).
  blocked_words: "The title or description contains a word that isn't allowed here. Change it and try again.",
  removed: "This video was removed by moderation, so it stays private.",
  suspended: "Your channel is suspended, so your videos stay private.",
  banned: "This account has been banned.",
};

/** The code in a database error message, like "rate_limited". */
export function studioErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function studioErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status for an error code. */
export function studioStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "studio_off":
    case "not_allowed":
    case "removed":
    case "suspended":
    case "banned":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
      return 429;
    case "storage_not_configured":
    case "no_db":
      return 503;
    case "failed":
      return 500;
    default:
      return 400;
  }
}
