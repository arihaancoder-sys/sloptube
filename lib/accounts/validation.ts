// Account rules shared by the forms and the tests (`node --test tests/`).
// Keep in step with public.username_is_valid() in supabase/migrations/002_profiles.sql.
// No imports on purpose, so Node can load this file directly.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const USERNAME_PATTERN = /^[a-z0-9_]{3,24}$/;
export const MIN_AGE = 13;
export const DISPLAY_NAME_MAX = 50;
export const BIO_MAX = 1000;
export const PASSWORD_MIN = 8;

export const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "api", "auth", "channel", "flags", "help", "history",
  "library", "login", "logout", "me", "moderator", "null", "root", "settings",
  "signup", "sloptube", "staff", "subscriptions", "support", "system", "trending",
  "undefined", "upload", "watch", "welcome",
]);

/** Usernames are stored lower case. Trims spaces and a leading "@". */
export function normalizeUsername(input: string): string {
  return input.trim().replace(/^@/, "").toLowerCase();
}

/** Returns a short reason, or null when the username is fine. Expects a normalized name. */
export function usernameProblem(name: string): string | null {
  if (name.length < USERNAME_MIN) return `Use at least ${USERNAME_MIN} characters.`;
  if (name.length > USERNAME_MAX) return `Use at most ${USERNAME_MAX} characters.`;
  if (!USERNAME_PATTERN.test(name)) return "Use only letters, numbers and underscores.";
  if (RESERVED_USERNAMES.has(name)) return "That username is reserved.";
  return null;
}

export type CalendarDate = { year: number; month: number; day: number };

/** Parses "YYYY-MM-DD" into a real calendar date, or null. */
export function parseDate(value: string): CalendarDate | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

export function formatDate({ year, month, day }: CalendarDate): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today in the person's own calendar (local time). */
export function today(now: Date = new Date()): CalendarDate {
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/** Age in whole years on the given day. Someone born on 29 Feb turns a year older on 1 Mar. */
export function ageOn(birth: CalendarDate, on: CalendarDate): number {
  let age = on.year - birth.year;
  if (on.month < birth.month || (on.month === birth.month && on.day < birth.day)) age--;
  return age;
}

export type BirthdateProblem = "birthdate_required" | "invalid_birthdate" | "too_young";

/** Checks a "YYYY-MM-DD" birthdate against the 13+ rule. Null means fine. */
export function birthdateProblem(value: string, on: CalendarDate = today()): BirthdateProblem | null {
  if (!value.trim()) return "birthdate_required";
  const birth = parseDate(value);
  if (!birth) return "invalid_birthdate";
  if (birth.year < 1900 || formatDate(birth) > formatDate(on)) return "invalid_birthdate";
  if (ageOn(birth, on) < MIN_AGE) return "too_young";
  return null;
}

export const AVATAR_TYPES = ["image/png", "image/jpeg", "image/webp"];
export const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const AVATAR_SIZE_PX = 256;

/** Checks a picked file before it is resized. Null means fine. */
export function avatarFileProblem(file: { type: string; size: number }): string | null {
  if (!AVATAR_TYPES.includes(file.type)) return "Use a PNG, JPG or WebP image.";
  if (file.size > AVATAR_MAX_BYTES) return "The image must be 2 MB or smaller.";
  return null;
}

/** Friendly text for the error codes raised by the database functions and auth. */
export function accountErrorText(code: string): string {
  const known: Record<string, string> = {
    not_signed_in: "Your session ended. Sign in again.",
    invalid_username: "That username cannot be used. Use 3 to 24 letters, numbers or underscores.",
    username_taken: "That username is taken. Try another.",
    birthdate_required: "Enter your birthday.",
    invalid_birthdate: "Enter a real birthday.",
    too_young: `You must be ${MIN_AGE} or older to use sloptube.`,
    already_complete: "Your account is already set up.",
  };
  for (const key of Object.keys(known)) {
    if (code.includes(key)) return known[key];
  }
  if (/invalid login credentials/i.test(code)) return "Wrong email or password.";
  if (/email not confirmed/i.test(code)) return "Confirm your email first. Check your inbox for the link.";
  if (/user already registered/i.test(code)) return "There is already an account with that email. Sign in instead.";
  if (/database error saving new user/i.test(code)) return "Could not create the account. Check your birthday and try again.";
  return code || "Something went wrong. Try again.";
}
