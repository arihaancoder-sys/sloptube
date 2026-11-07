// Yapin' integration (feature 16): the numbers, checks and texts. Keep them in
// step with supabase/migrations/018_yapin.sql, 019_yapin_facts.sql and worker/lib/yapin.mjs.
// No imports, so Node loads it directly.

/** unlink_yapin, set_yapin_webhook, list_yapin_posts and yapin_status take this many calls a minute per person. */
export const YAPIN_PER_MINUTE = 30;
export const WEBHOOK_MAX = 500;

/** The sites allowed to frame /embed/<id> (CSP frame-ancestors). */
export const EMBED_FRAME_ANCESTORS = ["'self'", "https://yapin.gg", "https://*.yapin.gg", "https://yapper.website", "https://*.yapper.website"];
export const embedCsp = () => `frame-ancestors ${EMBED_FRAME_ANCESTORS.join(" ")}`;

/** The hosts that serve Yapin' incoming webhooks (one service on two domains). Keep in step with 019 and worker/lib/yapin.mjs. */
export const YAPIN_WEBHOOK_HOSTS = ["yapin.gg", "www.yapin.gg", "yapper.website", "www.yapper.website"];

/**
 * The same check as yapin_webhook_is_valid in 019: https://<one of the hosts
 * above>/api/webhooks/<id>/<token>, nothing else, at most 500 characters.
 */
export function isYapinWebhook(url: string): boolean {
  return url.length <= WEBHOOK_MAX && /^https:\/\/(www\.)?(yapin\.gg|yapper\.website)\/api\/webhooks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(url);
}

/** What is wrong with a webhook URL before it goes out, or null. '' disconnects. */
export function webhookProblem(url: string): string | null {
  const clean = url.trim();
  if (clean === "") return null;
  return isYapinWebhook(clean) ? null : "bad_webhook";
}

/**
 * Share to Yapin'. Yapin' has no share page, so this stays null: the share
 * box copies a ready message and opens yapin.gg to paste it in. If Yapin'
 * ever adds one, put it here with {url} and {text} and it is used instead.
 */
export const YAPIN_SHARE_TEMPLATE: string | null = null;
export const YAPIN_HOME = "https://www.yapin.gg/";

/** The message Share to Yapin' copies: the title, then the link (Yapin' unfurls it into a card). */
export function shareMessage(title: string, link: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  return t ? `${t}\n${link}` : link;
}

/** Where Share to Yapin' sends people. */
export function shareTarget(title: string, link: string, template: string | null = YAPIN_SHARE_TEMPLATE): string {
  if (!template) return YAPIN_HOME;
  return template.replace("{url}", encodeURIComponent(link)).replace("{text}", encodeURIComponent(title));
}

const MESSAGES: Record<string, string> = {
  yapin_off: "Yapin' isn't switched on here.",
  no_db: "database not connected",
  not_set_up: "Yapin' isn't set up yet: run migrations 018 and 019.",
  not_signed_in: "Sign in first.",
  no_channel: "Make your channel first.",
  bad_webhook: "Paste the webhook URL from your Yapin' channel settings. It looks like https://www.yapin.gg/api/webhooks/...",
  yapin_taken: "That Yapin' account is linked to another sloptube account.",
  rate_limited: "Too many changes for now. Try again in a minute.",
  needs_email: "Add an email address under Account first: Yapin' is the only way into this account.",
  failed: "Something went wrong. Try again.",
};

export function yapinErrorText(code: string): string {
  return MESSAGES[code] ?? MESSAGES.failed;
}

export function yapinStatus(code: string): number {
  switch (code) {
    case "yapin_off":
    case "no_db":
    case "not_set_up":
      return 503;
    case "not_signed_in":
      return 401;
    case "rate_limited":
      return 429;
    case "bad_webhook":
    case "bad_request":
      return 400;
    case "no_channel":
    case "yapin_taken":
    case "needs_email":
      return 409;
    default:
      return 500;
  }
}

/** The ?yapin= note /login and /settings show after the callback. */
const NOTES: Record<string, string> = {
  linked: "Your Yapin' account is linked. You can sign in with it now.",
  unlinked: "Your Yapin' account is unlinked.",
  taken: MESSAGES.yapin_taken,
  denied: "Sign in with Yapin' was cancelled.",
  error: "Sign in with Yapin' did not finish. Try again.",
};

export function yapinNote(code: string | null | undefined): string | null {
  return code ? (NOTES[code] ?? null) : null;
}

// Accounts made by Sign in with Yapin' -----------------------------------------------------

/**
 * Yapin' shares no email address, but a Supabase account needs one. A new
 * account made by Sign in with Yapin' gets yapin_<id>@users.noreply.<this
 * site's host>. Nothing reads mail there: profiles.email_placeholder is set
 * (019) and the app never shows or mails it. Settings > Account lets the
 * person add a real address later.
 */
export function placeholderEmail(yapinId: string, siteHost: string): string {
  return `yapin_${yapinId.toLowerCase()}@users.noreply.${siteHost.toLowerCase()}`;
}

/** Is this one of the addresses placeholderEmail makes? Same check as yapin_is_placeholder_email in 019. */
export function isPlaceholderEmail(email: string | null | undefined): boolean {
  return typeof email === "string" && /^yapin_[a-z0-9_-]+@users\.noreply\.[^@\s]+$/i.test(email);
}

/** A post in the studio list, by its status in yapin_posts. */
export const POST_STATUS_TEXT: Record<string, string> = {
  queued: "Waiting",
  sending: "Sending",
  sent: "Posted",
  failed: "Failed",
};
