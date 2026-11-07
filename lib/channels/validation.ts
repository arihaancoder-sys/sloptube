// Channel rules shared by the studio form, the pages and the tests (`node --test tests/`).
// Keep in step with public.channel_handle_problem() in supabase/migrations/004_channels.sql.
// No imports on purpose, so Node can load this file directly.

export const HANDLE_MIN = 3;
export const HANDLE_MAX = 30;
export const HANDLE_PATTERN = /^[a-z0-9_.]{3,30}$/;
export const HANDLE_COOLDOWN_DAYS = 14;
export const CHANNEL_NAME_MAX = 50;
export const CHANNEL_DESCRIPTION_MAX = 1000;
export const CHANNEL_LINKS_MAX = 5;
export const CHANNEL_LINK_TITLE_MAX = 40;
export const CHANNEL_LINK_URL_MAX = 300;

/** Paths and words a channel cannot take as its handle. */
export const RESERVED_HANDLES = new Set([
  "about", "admin", "administrator", "api", "auth", "c", "channel", "channels", "embed",
  "feed", "flags", "help", "history", "home", "library", "login", "logout", "me",
  "moderator", "null", "official", "playlist", "results", "root", "settings", "shorts",
  "signup", "sloptube", "staff", "studio", "subscriptions", "support", "system",
  "trending", "undefined", "upload", "user", "videos", "watch", "welcome",
]);

/** Handles are stored lower case. Trims spaces and a leading "@". */
export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

export type HandleProblem = "too_short" | "too_long" | "bad_characters" | "bad_dots" | "reserved";

/** The rule a normalized handle breaks, or null when it is fine. */
export function handleProblem(handle: string): HandleProblem | null {
  if (handle.length < HANDLE_MIN) return "too_short";
  if (handle.length > HANDLE_MAX) return "too_long";
  if (!HANDLE_PATTERN.test(handle)) return "bad_characters";
  if (handle.startsWith(".") || handle.endsWith(".") || handle.includes("..")) return "bad_dots";
  if (RESERVED_HANDLES.has(handle)) return "reserved";
  return null;
}

export function handleProblemText(problem: HandleProblem): string {
  switch (problem) {
    case "too_short":
      return `Use at least ${HANDLE_MIN} characters.`;
    case "too_long":
      return `Use at most ${HANDLE_MAX} characters.`;
    case "bad_characters":
      return "Use only letters, numbers, underscores and dots.";
    case "bad_dots":
      return "A dot cannot come first, last or twice in a row.";
    case "reserved":
      return "That handle is reserved.";
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

export type HandleCooldown =
  | { canChange: true }
  | { canChange: false; nextChangeAt: Date; daysLeft: number };

/**
 * Can the handle be changed now? `changedAt` is channels.handle_changed_at:
 * null means the handle was never changed, so the first change is always free.
 */
export function handleCooldown(changedAt: string | Date | null, now: Date = new Date()): HandleCooldown {
  if (!changedAt) return { canChange: true };
  const last = changedAt instanceof Date ? changedAt : new Date(changedAt);
  if (Number.isNaN(last.getTime())) return { canChange: true };
  const next = new Date(last.getTime() + HANDLE_COOLDOWN_DAYS * DAY_MS);
  if (now.getTime() >= next.getTime()) return { canChange: true };
  return { canChange: false, nextChangeAt: next, daysLeft: Math.ceil((next.getTime() - now.getTime()) / DAY_MS) };
}

export function cooldownText(cooldown: HandleCooldown): string | null {
  if (cooldown.canChange) return null;
  const when = cooldown.nextChangeAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const days = cooldown.daysLeft === 1 ? "1 day" : `${cooldown.daysLeft} days`;
  return `You can change your handle again on ${when} (in ${days}). Handles can change once every ${HANDLE_COOLDOWN_DAYS} days.`;
}

export type ChannelLink = { title: string; url: string };

/** Checks one About link. Null means fine. */
export function linkProblem(link: ChannelLink): string | null {
  const title = link.title.trim();
  const url = link.url.trim();
  if (!title) return "Give the link a title.";
  if (title.length > CHANNEL_LINK_TITLE_MAX) return `Use at most ${CHANNEL_LINK_TITLE_MAX} characters for a link title.`;
  if (url.length > CHANNEL_LINK_URL_MAX) return "That link is too long.";
  if (!/^https:\/\/[^\s/$.?#][^\s]*$/i.test(url)) return "Links must start with https://";
  return null;
}

/** Keeps only the links that can be saved, trimmed. */
export function cleanLinks(links: ChannelLink[]): ChannelLink[] {
  return links
    .map((l) => ({ title: l.title.trim(), url: l.url.trim() }))
    .filter((l) => linkProblem(l) === null)
    .slice(0, CHANNEL_LINKS_MAX);
}

export const BANNER_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const BANNER_MAX_BYTES = 6 * 1024 * 1024;
export const BANNER_MIN_WIDTH = 1024;
/** The 2019 desktop banner: 2560 x 423. */
export const BANNER_WIDTH = 2560;
export const BANNER_HEIGHT = 423;

/** Checks a picked banner file before it is resized. Null means fine. */
export function bannerFileProblem(file: { type: string; size: number }): string | null {
  if (!BANNER_TYPES.includes(file.type)) return "Use a PNG, JPG or WebP image.";
  if (file.size > BANNER_MAX_BYTES) return "The image must be 6 MB or smaller.";
  return null;
}

export function bannerSizeProblem(width: number): string | null {
  if (width < BANNER_MIN_WIDTH) return `Use an image at least ${BANNER_MIN_WIDTH} pixels wide. 2560 works best.`;
  return null;
}

/**
 * The source rectangle that center crops an image to the 2560 x 423 banner shape.
 */
export function bannerCrop(width: number, height: number): { sx: number; sy: number; sw: number; sh: number } {
  const ratio = BANNER_WIDTH / BANNER_HEIGHT;
  if (width / height > ratio) {
    const sw = Math.round(height * ratio);
    return { sx: Math.round((width - sw) / 2), sy: 0, sw, sh: height };
  }
  const sh = Math.round(width / ratio);
  return { sx: 0, sy: Math.round((height - sh) / 2), sw: width, sh };
}

/** "No subscribers", "1 subscriber", "999 subscribers", "1.2K subscribers", "3.4M subscribers". */
export function formatSubscribers(count: number): string {
  const n = Math.max(0, Math.floor(count || 0));
  if (n === 0) return "No subscribers";
  if (n === 1) return "1 subscriber";
  return `${compactCount(n)} subscribers`;
}

/** 2019 style short counts: 999, 1.2K, 12K, 1.2M, 1.2B. */
export function compactCount(n: number): string {
  const units: [number, string][] = [
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ];
  for (const [size, suffix] of units) {
    if (n >= size) {
      const v = n / size;
      const shown = v < 10 ? Math.floor(v * 10) / 10 : Math.floor(v);
      return `${shown}${suffix}`;
    }
  }
  return String(n);
}

/** "Nov 4, 2026", in UTC so the server and the browser agree. */
export function formatJoined(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** Friendly text for the error codes raised by the channel database functions. */
export function channelErrorText(code: string): string {
  const known: Record<string, string> = {
    not_signed_in: "Your session ended. Sign in again.",
    no_channel: "Your channel is not set up yet. Ask the owner to run migration 004.",
    handle_invalid: "That handle cannot be used. Use 3 to 30 letters, numbers, underscores or dots.",
    handle_reserved: "That handle is reserved.",
    handle_taken: "That handle is taken. Try another.",
    handle_cooldown: `Handles can change once every ${HANDLE_COOLDOWN_DAYS} days.`,
  };
  for (const key of Object.keys(known)) {
    if (code.includes(key)) return known[key];
  }
  return code || "Something went wrong. Try again.";
}

/** The browser tab title for a channel page, from the URL segment alone. */
export function channelTitle(segment: string, tab?: string): string {
  let handle = segment;
  try {
    handle = decodeURIComponent(segment);
  } catch {
    // keep the raw segment
  }
  handle = normalizeHandle(handle).replace(/[^a-z0-9_.]/g, "").slice(0, HANDLE_MAX);
  return `${tab ? `${tab} | ` : ""}@${handle || "channel"} | sloptube`;
}
