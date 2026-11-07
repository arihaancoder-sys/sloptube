// Subscription rules shared by the routes, the button and the tests.
// No imports, so Node can load this file directly.

/** Keep in step with subscription_changes_per_hour() in 009_subscriptions.sql. */
export const SUBSCRIPTION_CHANGES_PER_HOUR = 60;

/** The guide shows this many channels, then SHOW MORE. */
export const GUIDE_CHANNELS = 7;

export type SubAction = "subscribe" | "unsubscribe" | "notify";

export function isSubAction(v: unknown): v is SubAction {
  return v === "subscribe" || v === "unsubscribe" || v === "notify";
}

/** The codes the database raises, and what the route answers. */
const MESSAGES: Record<string, string> = {
  not_signed_in: "Sign in to subscribe.",
  subscriptions_off: "Subscriptions aren't on yet.",
  not_found: "This channel isn't there anymore.",
  own_channel: "You can't subscribe to your own channel.",
  rate_limited: "You're changing subscriptions very fast. Try again in a bit.",
  not_subscribed: "Subscribe first to get notifications.",
  not_set_up: "Subscriptions aren't set up yet.",
  no_db: "Database not connected.",
};

/** The error code from a database message, or "failed". */
export function subErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  if (m in MESSAGES) return m;
  if (/permission denied/i.test(m)) return "not_signed_in";
  return "failed";
}

export function subErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || "Something went wrong. Try again.";
}

/** How many channels the guide shows: 7, or all of them after SHOW MORE. */
export function guideSlice<T>(channels: T[], expanded: boolean): { shown: T[]; more: number } {
  if (expanded || channels.length <= GUIDE_CHANNELS) return { shown: channels, more: 0 };
  return { shown: channels.slice(0, GUIDE_CHANNELS), more: channels.length - GUIDE_CHANNELS };
}

