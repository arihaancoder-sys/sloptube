// The launch pack's numbers, topics and error texts. Keep them in step with
// supabase/migrations/017_launch.sql. No imports, so Node loads it directly.

/** contact_send takes this many messages a day per email address and per network address. Same as contact_per_day(). */
export const CONTACT_PER_DAY = 5;
export const NAME_MAX = 80;
export const EMAIL_MAX = 254;
export const BODY_MIN = 10;
export const BODY_MAX = 4000;

export const CONTACT_TOPICS = ["general", "press", "legal", "safety", "bug", "other"] as const;
export type ContactTopic = (typeof CONTACT_TOPICS)[number];

export const TOPIC_LABELS: Record<ContactTopic, string> = {
  general: "General question",
  press: "Press",
  legal: "Legal or copyright",
  safety: "Safety concern",
  bug: "Something is broken",
  other: "Something else",
};

export function isTopic(v: unknown): v is ContactTopic {
  return typeof v === "string" && (CONTACT_TOPICS as readonly string[]).includes(v);
}

/** The same shape check as contact_email_shape in 017. */
export function isEmail(v: string): boolean {
  return v.length <= EMAIL_MAX && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v);
}

export type ContactInput = { name: string; email: string; topic: string; body: string };

/** The message as contact_send cleans it: one space between words in the name, the email in lower case. */
export function cleanContact(input: ContactInput): ContactInput {
  return {
    name: input.name.replace(/\s+/g, " ").trim(),
    email: input.email.trim().toLowerCase(),
    topic: input.topic.trim() || "general",
    body: input.body.trim(),
  };
}

/** What is wrong with a message before it goes out, or null. Same order as contact_send. */
export function contactProblem(input: ContactInput): string | null {
  const m = cleanContact(input);
  if (m.name.length === 0 || m.name.length > NAME_MAX) return "bad_name";
  if (!isEmail(m.email)) return "bad_email";
  if (!isTopic(m.topic)) return "bad_topic";
  if (m.body.length < BODY_MIN) return "too_short";
  if (m.body.length > BODY_MAX) return "too_long";
  return null;
}

const MESSAGES: Record<string, string> = {
  launch_off: "The contact form isn't on yet.",
  no_db: "database not connected",
  not_set_up: "The contact form isn't set up yet: run migration 017.",
  bad_name: `Add your name (up to ${NAME_MAX} characters).`,
  bad_email: "Enter an email address we can reply to.",
  bad_topic: "Pick what your message is about.",
  too_short: `Write a few more words (at least ${BODY_MIN} characters).`,
  too_long: `Keep it under ${BODY_MAX} characters.`,
  rate_limited: `That's ${CONTACT_PER_DAY} messages today from you. Try again tomorrow.`,
  not_admin: "Only admins can do that.",
  not_found: "That message is gone.",
  bad_request: "Something went wrong. Try again.",
  failed: "Something went wrong. Try again.",
};

/** The error code in a database error message, or "failed". */
export function launchErrorCode(message: string | null | undefined): string {
  const m = (message ?? "").trim();
  return m in MESSAGES ? m : "failed";
}

export function launchErrorMessage(code: string | null | undefined): string {
  return (code && MESSAGES[code]) || MESSAGES.failed;
}

/** The HTTP status for an error code. not_admin is a 404 like /admin. */
export function launchStatus(code: string): number {
  switch (code) {
    case "launch_off":
      return 403;
    case "no_db":
    case "not_set_up":
      return 503;
    case "rate_limited":
      return 429;
    case "not_admin":
    case "not_found":
      return 404;
    case "failed":
      return 500;
    default:
      return 400;
  }
}
