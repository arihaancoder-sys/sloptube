// Strike maths. Same as channel_active_strikes() and mod_action in
// supabase/migrations/016_moderation.sql. No imports, so Node loads it directly.

/** A strike counts for this many days. Same as moderation_strike_days(). */
export const STRIKE_DAYS = 90;
/** This many strikes at once suspend the channel. Same as moderation_strike_limit(). */
export const STRIKE_LIMIT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

const ms = (t: string | number) => (typeof t === "number" ? t : Date.parse(t));

/** The strikes still counting at now: given less than 90 days ago, and not in the future. */
export function activeStrikes(given: (string | number)[], now: number = Date.now()): number[] {
  return given
    .map(ms)
    .filter((t) => Number.isFinite(t) && t <= now && now - t < STRIKE_DAYS * DAY_MS)
    .sort((a, b) => a - b);
}

export type StrikeState = {
  active: number;
  /** Strikes left before a suspension (0 once suspended by strikes). */
  left: number;
  /** True when the active strikes reach the limit. */
  suspends: boolean;
  /** When the oldest active strike stops counting, epoch ms, or null. */
  nextExpiry: number | null;
};

export function strikeState(given: (string | number)[], now: number = Date.now()): StrikeState {
  const active = activeStrikes(given, now);
  return {
    active: active.length,
    left: Math.max(0, STRIKE_LIMIT - active.length),
    suspends: active.length >= STRIKE_LIMIT,
    nextExpiry: active.length ? active[0] + STRIKE_DAYS * DAY_MS : null,
  };
}

/** Would one more strike now suspend the channel? */
export function strikeWouldSuspend(given: (string | number)[], now: number = Date.now()): boolean {
  return activeStrikes(given, now).length + 1 >= STRIKE_LIMIT;
}

/** "1 of 3 strikes", for the queue and the studio notice. */
export function strikesLabel(active: number): string {
  return `${active} of ${STRIKE_LIMIT} strikes`;
}
