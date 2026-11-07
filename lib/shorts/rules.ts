// Snips: what makes a video a short, the feed's score, the numbers shared by
// the routes, the pages and the tests. Keep them in step with
// supabase/migrations/013_shorts.sql. Only relative imports, so Node can load
// this file directly.

import { SHORT_VIEW_SECONDS } from "../engagement/rules.ts";
import { TRENDING_GRAVITY } from "../feed/score.ts";
import { formatTime } from "../watch/format.ts";

/** A short is this long or less (the duration rounded down, as the player shows it). */
export const SHORT_MAX_S = 60;

/** A short counts a view (and as watched) after this many seconds: viewThreshold(d, true). */
export const SHORT_VIEW_S = SHORT_VIEW_SECONDS;

/** Snips per page of /shorts. list_shorts takes at most 30. */
export const SHORTS_PAGE_SIZE = 10;

/** Snips on the home shelf. */
export const SHELF_SIZE = 12;

/** The shelf sits after this many grid cards (see lib/shorts/shelf.ts). */
export const SHELF_AFTER = 4;

/** Snips on a channel's Snips tab per page. */
export const CHANNEL_SHORTS_PAGE = 24;

export type ShortShape = { durationS: number | null | undefined; width: number | null | undefined; height: number | null | undefined };

/**
 * Vertical (taller than wide) and 60 seconds or less, unless the uploader
 * said no (`choice` false). Same as video_is_short() in SQL.
 */
export function isShort(shape: ShortShape, choice: boolean | null = null): boolean {
  if (choice === false) return false;
  const w = Number(shape.width);
  const h = Number(shape.height);
  const d = Number(shape.durationS);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(d)) return false;
  return w > 0 && h > w && d > 0 && Math.floor(d) <= SHORT_MAX_S;
}

/**
 * Why a file cannot be uploaded as a short, in words for the upload page, or
 * null when it can. `shape` null means the browser could not read the file.
 */
export function shortProblem(shape: ShortShape | null): string | null {
  if (!shape) {
    return "This browser can't read the file's size and length. If it is vertical and 60 seconds or less, it becomes a Snip by itself after processing.";
  }
  const w = Number(shape.width);
  const h = Number(shape.height);
  const d = Number(shape.durationS);
  const tall = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > w;
  const brief = Number.isFinite(d) && d > 0 && Math.floor(d) <= SHORT_MAX_S;
  if (tall && brief) return null;
  const parts: string[] = [];
  if (!tall) {
    parts.push(
      w > 0 && w === h
        ? `It's square (${w} x ${h}). Snips are vertical: taller than wide.`
        : `It's horizontal (${w || "?"} x ${h || "?"}). Snips are vertical: taller than wide.`,
    );
  }
  if (!brief) {
    parts.push(
      Number.isFinite(d) && d > 0
        ? `It's ${formatTime(d)} long. Snips are 60 seconds or less.`
        : "Its length could not be read. Snips are 60 seconds or less.",
    );
  }
  return parts.join(" ");
}

/**
 * The feed score of one short at `asOf` (milliseconds): the trending math of
 * the home feed with likes and comments added and one point to start, so new
 * shorts without views still rank by how new they are. Rounded to 6
 * decimals, like shorts_score() in SQL.
 */
export function shortsScore(
  counts: { views: number; likes: number; comments: number },
  publishedAt: string | number | Date,
  asOf: number,
): number {
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  const pos = (n: number) => (Number.isFinite(n) && n > 0 ? n : 0);
  const points = 1 + pos(counts.views) + 2 * pos(counts.likes) + 3 * pos(counts.comments);
  const hours = Math.max((asOf - t) / 3_600_000, 1);
  return Math.round((points / Math.pow(hours, TRENDING_GRAVITY)) * 1e6) / 1e6;
}

/** The codes the database raises, and what the page says. */
const MESSAGES: Record<string, string> = {
  shorts_off: "Snips aren't on yet.",
  not_signed_in: "Sign in first.",
  not_found: "This video isn't there anymore.",
  not_allowed: "Only the uploader can change that.",
  not_a_short: "This video is not vertical and 60 seconds or less, so it can't be a Snip.",
  rate_limited: "You're doing that very fast. Try again in a bit.",
  not_set_up: "Snips aren't set up yet.",
  no_db: "Database not connected.",
};

/** The error code from a database message, or "failed". */
export function shortsErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function shortsErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status a route answers for an error code. */
export function shortsStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "shorts_off":
    case "not_allowed":
      return 403;
    case "not_found":
      return 404;
    case "not_a_short":
    case "bad_request":
      return 400;
    case "rate_limited":
      return 429;
    default:
      return 503;
  }
}
