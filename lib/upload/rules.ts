// Upload rules shared by the /upload page, the API routes and the tests.
// Keep in step with public.create_upload() in supabase/migrations/005_videos.sql.
// No imports on purpose, so Node can load this file directly.

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
export const UPLOADS_PER_DAY = 10;
/** Every part is 16 MB except the last one. R2 wants at least 5 MB per part. */
export const PART_SIZE = 16 * 1024 * 1024;
/** How many parts upload at the same time. */
export const PARALLEL_PARTS = 3;
/** A failed part is tried again this many times before the upload gives up. */
export const PART_RETRIES = 3;
/** How long the presigned part URLs work, in seconds. */
export const PART_URL_TTL_S = 6 * 60 * 60;

export const TITLE_MAX = 100;
export const DESCRIPTION_MAX = 5000;
export const VISIBILITIES = ["private", "unlisted", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

export const VIDEO_STATUSES = ["uploading", "uploaded", "processing", "ready", "failed"] as const;
export type VideoStatus = (typeof VIDEO_STATUSES)[number];

/** Accepted video types and the extension each one is stored with. */
export const VIDEO_TYPES: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
};

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
};

/** The `accept` attribute for the file picker. */
export const ACCEPT = ".mp4,.m4v,.mov,.webm,.mkv,video/mp4,video/quicktime,video/webm,video/x-matroska";

/**
 * The accepted type for a file, or null. Browsers often leave the type empty
 * for .mkv, so the extension decides when the type is missing or generic.
 */
export function videoTypeFor(file: { name: string; type: string }): string | null {
  if (file.type in VIDEO_TYPES) return file.type;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (file.name.includes(".") && ext in EXTENSION_TYPES) {
    if (!file.type || file.type === "application/octet-stream" || file.type.startsWith("video/")) {
      return EXTENSION_TYPES[ext];
    }
  }
  return null;
}

export type FileProblemCode = "bad_type" | "file_empty" | "file_too_big";

/** The rule this file breaks, or null when it can be uploaded. */
export function fileProblemCode(file: { name: string; type: string; size: number }): FileProblemCode | null {
  if (!videoTypeFor(file)) return "bad_type";
  if (!Number.isSafeInteger(file.size) || file.size <= 0) return "file_empty";
  if (file.size > MAX_UPLOAD_BYTES) return "file_too_big";
  return null;
}

/** Why this file cannot be uploaded, in plain words, or null when it is fine. */
export function fileProblem(file: { name: string; type: string; size: number }): string | null {
  const code = fileProblemCode(file);
  return code ? uploadErrorText(code) : null;
}

/** The title the form starts with: the file name without its extension. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.[^./\\]{1,8}$/, "").replace(/\s+/g, " ").trim();
  return (base || "Untitled video").slice(0, TITLE_MAX);
}

export type Part = { partNumber: number; start: number; end: number };

/** Splits a file of `bytes` into numbered parts. `end` is exclusive, like Blob.slice. */
export function planParts(bytes: number, partSize = PART_SIZE): Part[] {
  if (!Number.isSafeInteger(bytes) || bytes <= 0) return [];
  const parts: Part[] = [];
  for (let start = 0, n = 1; start < bytes; start += partSize, n++) {
    parts.push({ partNumber: n, start, end: Math.min(start + partSize, bytes) });
  }
  return parts;
}

/** The R2 key for an upload. The database builds the same key in create_upload(). */
export function sourceKey(ownerId: string, videoId: string, mime: string): string | null {
  const ext = VIDEO_TYPES[mime];
  if (!ext || !isUuid(ownerId) || !isUuid(videoId)) return null;
  return `uploads/${ownerId.toLowerCase()}/${videoId.toLowerCase()}/source.${ext}`;
}

/** Is this key one that create_upload() could have made for this owner? */
export function keyBelongsTo(key: string, ownerId: string): boolean {
  return /^uploads\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/source\.(mp4|mov|webm|mkv)$/.test(key) &&
    key.startsWith(`uploads/${ownerId.toLowerCase()}/`);
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export type Details = { title: string; description: string; visibility: Visibility };

/** Why the details form cannot be saved, or null. */
export function detailsProblem(d: { title?: unknown; description?: unknown; visibility?: unknown }): string | null {
  const title = typeof d.title === "string" ? d.title.trim() : "";
  if (!title) return "Add a title.";
  if (title.length > TITLE_MAX) return `Titles can be up to ${TITLE_MAX} characters.`;
  if (typeof d.description !== "string" && d.description !== undefined) return "The description must be text.";
  if (typeof d.description === "string" && d.description.length > DESCRIPTION_MAX) {
    return `Descriptions can be up to ${DESCRIPTION_MAX} characters.`;
  }
  if (!VISIBILITIES.includes(d.visibility as Visibility)) return "Pick private, unlisted or public.";
  return null;
}

/** 1536 -> "1.5 KB", using 1024 steps like the file picker does. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Upload speed for the progress line, like "4.2 MB/s". */
export function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(Math.max(0, bytesPerSecond))}/s`;
}

/** Whole percent, never 100 until every byte is in. */
export function percentDone(sent: number, total: number): number {
  if (total <= 0) return 0;
  if (sent >= total) return 100;
  return Math.min(99, Math.floor((sent / total) * 100));
}

/** Friendly text for an error code from the RPCs or the routes. */
export function uploadErrorText(code: string | null | undefined): string {
  switch (code) {
    case "not_signed_in":
      return "Sign in to upload.";
    case "upload_off":
      return "Uploads are switched off right now.";
    case "not_onboarded":
      return "Finish setting up your account before you upload.";
    case "too_young":
      return "You must be 13 or older to upload.";
    case "no_channel":
      return "Your account does not have a channel yet.";
    case "title_invalid":
      return "Add a title of 1 to 100 characters.";
    case "description_too_long":
      return `Descriptions can be up to ${DESCRIPTION_MAX} characters.`;
    case "bad_visibility":
      return "Pick private, unlisted or public.";
    case "file_empty":
      return "This file is empty.";
    case "file_too_big":
      return "This file is bigger than 2 GB, the most one upload can be.";
    case "bad_type":
      return "Only MP4, MOV, WebM and MKV videos can be uploaded.";
    case "daily_limit":
      return `You can upload ${UPLOADS_PER_DAY} videos a day. Try again tomorrow.`;
    case "not_configured":
      return "Uploads are not configured on this server yet.";
    case "size_mismatch":
      return "The uploaded file did not arrive complete. Try again.";
    case "blocked_words":
      return "The title or description contains a word that isn't allowed here. Change it and try again.";
    case "suspended":
      return "Your channel is suspended, so you can't upload.";
    case "banned":
      return "This account has been banned.";
    case "no_db":
      return "database not connected";
    default:
      return "Something went wrong. Try again.";
  }
}
