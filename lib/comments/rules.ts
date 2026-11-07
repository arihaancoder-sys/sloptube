// Comments: the numbers and rules shared by the routes, the page and the
// tests. Keep the numbers in step with 012_comments.sql. No imports, so Node
// can load this file directly.

/** Longest comment, in characters (after cleanBody). */
export const BODY_MAX = 2000;

/** post_comment limits per person. */
export const COMMENTS_PER_MINUTE = 10;
export const COMMENTS_PER_DAY = 100;
/** Accounts younger than a day get this many a minute instead. */
export const NEW_ACCOUNT_PER_MINUTE = 3;
/** Likes, edits, deletes, pins and hearts per person per minute. */
export const ACTIONS_PER_MINUTE = 60;

/** Top level comments per page, and replies per "Show more replies". */
export const PAGE_SIZE = 20;
export const REPLIES_PAGE_SIZE = 10;

/** The page asks for comments newer than the newest it has this often. */
export const POLL_MS = 20_000;

/** A comment longer than this many lines folds behind "Read more". */
export const READ_MORE_LINES = 4;

/** /studio/comments shows this many. */
export const STUDIO_LIMIT = 50;

export type CommentSort = "top" | "newest";
export type CommentsMode = "on" | "off" | "held";

export function isSort(v: unknown): v is CommentSort {
  return v === "top" || v === "newest";
}

export function parseSort(v: string | null | undefined): CommentSort {
  return v === "newest" ? "newest" : "top";
}

export function isMode(v: unknown): v is CommentsMode {
  return v === "on" || v === "off" || v === "held";
}

/**
 * Line endings to \n, at most one empty line in a row, no space at the ends.
 * Same as comment_clean_body() in SQL, so the optimistic row shows what
 * the server will store.
 */
export function cleanBody(text: string | null | undefined): string {
  return (text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, "");
}

/** What is wrong with a comment before it is sent, or null when it can go. */
export function bodyProblem(text: string | null | undefined): "bad_body" | "body_too_long" | null {
  const clean = cleanBody(text);
  if (clean.length === 0) return "bad_body";
  // Postgres counts characters, not UTF-16 units.
  if ([...clean].length > BODY_MAX) return "body_too_long";
  return null;
}

/** The codes the database raises, and what the page says. */
const MESSAGES: Record<string, string> = {
  not_signed_in: "Sign in to comment.",
  not_onboarded: "Finish signing up to comment.",
  comments_off: "Comments aren't on yet.",
  comments_disabled: "Comments are turned off.",
  comments_held: "The creator reviews comments before they show. That arrives in a later update.",
  not_found: "This comment isn't there anymore.",
  not_allowed: "You can't do that to this comment.",
  bad_body: "Write something first.",
  body_too_long: `Comments can be up to ${BODY_MAX.toLocaleString("en-US")} characters.`,
  bad_parent: "That comment isn't there anymore, so you can't reply to it.",
  bad_sort: "Something went wrong. Try again.",
  bad_mode: "Something went wrong. Try again.",
  rate_limited_minute: `You can post ${COMMENTS_PER_MINUTE} comments a minute. Wait a moment and try again.`,
  rate_limited_day: `You've posted ${COMMENTS_PER_DAY} comments today. Try again tomorrow.`,
  rate_limited_new: `New accounts can post ${NEW_ACCOUNT_PER_MINUTE} comments a minute. Wait a moment and try again.`,
  rate_limited: "You're doing that very fast. Try again in a bit.",
  not_set_up: "Comments aren't set up yet.",
  // Moderation (016).
  blocked_words: "Your comment contains a word that isn't allowed here. Change it and try again.",
  too_many_links: "Comments can have up to 5 links.",
  suspended: "Your channel is suspended, so you can't comment.",
  banned: "This account has been banned.",
  no_db: "Database not connected.",
};

/** The error code from a database message, or "failed". */
export function commentsErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function commentsErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status a route answers for an error code. */
export function commentsStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "comments_off":
    case "comments_disabled":
    case "comments_held":
    case "not_allowed":
    case "not_onboarded":
    case "suspended":
    case "banned":
      return 403;
    case "not_found":
      return 404;
    case "rate_limited":
    case "rate_limited_minute":
    case "rate_limited_day":
    case "rate_limited_new":
      return 429;
    case "bad_request":
    case "bad_body":
    case "body_too_long":
    case "blocked_words":
    case "too_many_links":
    case "bad_parent":
    case "bad_sort":
    case "bad_mode":
      return 400;
    default:
      return 503;
  }
}

/** "1 Comment", "1,234 Comments": the 2019 header. */
export function commentsHeader(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return `${n.toLocaleString("en-US")} ${n === 1 ? "Comment" : "Comments"}`;
}

/** "View reply", "View 12 replies". */
export function viewRepliesLabel(count: number): string {
  const n = Math.max(0, Math.floor(Number(count) || 0));
  return n === 1 ? "View reply" : `View ${n.toLocaleString("en-US")} replies`;
}

/**
 * About how many lines a comment takes at `charsPerLine` characters a line:
 * each line break starts a line, long lines wrap. The page measures the real
 * height once it is on screen; this is the first guess, so the "Read more"
 * button does not jump in.
 */
export function estimateLines(text: string, charsPerLine: number): number {
  const per = Math.max(1, Math.floor(charsPerLine));
  return text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil([...line].length / per)), 0);
}

export function needsReadMore(text: string | null | undefined, charsPerLine: number, maxLines = READ_MORE_LINES): boolean {
  if (!text) return false;
  return estimateLines(text, charsPerLine) > maxLines;
}

/** "@name " at the start of a reply to a reply, like 2019. */
export function mentionPrefix(handle: string | null | undefined): string {
  const h = (handle ?? "").trim().replace(/^@+/, "");
  return h ? `@${h} ` : "";
}

/** Splits a leading "@handle" off a reply, for the blue link. */
export function splitMention(body: string): { mention: string | null; rest: string } {
  const m = /^@([a-z0-9_.]{3,30})(\s|$)/i.exec(body);
  if (!m) return { mention: null, rest: body };
  return { mention: `@${m[1]}`, rest: body.slice(m[1].length + 1) };
}
