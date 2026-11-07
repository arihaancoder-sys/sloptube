// Moderation's numbers, reasons and error texts. Keep them in step with
// supabase/migrations/016_moderation.sql. No imports, so Node loads it directly.

/** report_target takes at most this many reports a day per person. Same as moderation_reports_per_day(). */
export const REPORTS_PER_DAY = 10;
/** A report's or an appeal's text, and an admin's reason. */
export const DETAILS_MAX = 500;
/** A comment with more links than this is refused. Same as moderation_link_limit(). */
export const LINK_LIMIT = 5;

export const REPORT_REASONS = ["spam", "sexual", "violent", "harassment", "copyright", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export type TargetKind = "video" | "comment" | "channel";
export type ReportKind = "report" | "appeal";

/** The 2019 report dialog's wording. */
export const REASON_LABELS: Record<ReportReason | "appeal", string> = {
  spam: "Spam or misleading",
  sexual: "Sexual content",
  violent: "Violent or repulsive content",
  harassment: "Harassment or bullying",
  copyright: "Infringes my rights",
  other: "Something else",
  appeal: "Appeal",
};

export function isReason(v: unknown): v is ReportReason {
  return typeof v === "string" && (REPORT_REASONS as readonly string[]).includes(v);
}

export function isTargetKind(v: unknown): v is TargetKind {
  return v === "video" || v === "comment" || v === "channel";
}

/** What is wrong with a report before it goes out, or null. */
export function reportProblem(reason: string | null, details: string): string | null {
  if (!isReason(reason)) return "bad_reason";
  const text = details.trim();
  if (text.length > DETAILS_MAX) return "details_too_long";
  if (reason === "other" && text.length === 0) return "details_required";
  return null;
}

// Admin actions -------------------------------------------------------------------------

export const ACTIONS = ["dismiss", "remove", "restore", "strike", "suspend", "unsuspend", "ban", "unban"] as const;
export type ModAction = (typeof ACTIONS)[number];

export function isAction(v: unknown): v is ModAction {
  return typeof v === "string" && (ACTIONS as readonly string[]).includes(v);
}

/** These need a reason: the uploader or the log shows it. */
export function actionNeedsReason(a: ModAction): boolean {
  return a === "remove" || a === "strike" || a === "suspend" || a === "ban";
}

/** How a mod_log action reads on /admin/log. */
export const LOG_LABELS: Record<string, string> = {
  dismiss: "Dismissed reports",
  remove_video: "Removed a video",
  remove_comment: "Removed a comment",
  restore_video: "Restored a video",
  strike: "Gave a strike",
  suspend: "Suspended a channel",
  unsuspend: "Unsuspended a channel",
  ban: "Banned a user",
  unban: "Unbanned a user",
  add_word: "Added a word",
  remove_word: "Removed a word",
};

// Errors ------------------------------------------------------------------------------------

const MESSAGES: Record<string, string> = {
  moderation_off: "Reporting isn't on yet.",
  not_signed_in: "Sign in to report.",
  not_admin: "That page isn't available.",
  not_found: "That's gone already.",
  not_allowed: "That can't be done here.",
  bad_kind: "That can't be reported.",
  bad_reason: "Pick a reason.",
  details_required: "Tell us a bit more.",
  details_too_long: `Keep it under ${DETAILS_MAX} characters.`,
  already_reported: "You reported this already. Thanks.",
  rate_limited: `That's ${REPORTS_PER_DAY} reports today. Try again tomorrow.`,
  bad_action: "That action isn't available here.",
  reason_required: "Add a reason first.",
  reason_too_long: `Keep the reason under ${DETAILS_MAX} characters.`,
  not_removed: "That video isn't removed.",
  already_appealed: "You appealed this already.",
  bad_word: "Words are 2 to 40 letters or digits, with single spaces, ' or -, and an optional * at the end.",
  banned: "This account has been banned.",
  suspended: "Your channel is suspended, so you can't upload or comment.",
  removed: "This video was removed by moderation.",
  blocked_words: "That contains a word that isn't allowed here. Change it and try again.",
  too_many_links: `Comments can have up to ${LINK_LIMIT} links.`,
  bad_request: "Something was off with that request.",
};

/** The code in a database error message, like "already_reported". */
export function moderationErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function moderationErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** The HTTP status for an error code. not_admin is a 404 like the page. */
export function moderationStatus(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "moderation_off":
    case "not_allowed":
    case "banned":
    case "suspended":
      return 403;
    case "not_found":
    case "not_admin":
      return 404;
    case "already_reported":
    case "already_appealed":
      return 409;
    case "rate_limited":
      return 429;
    case "no_db":
    case "not_set_up":
      return 503;
    case "failed":
      return 500;
    default:
      return 400;
  }
}
