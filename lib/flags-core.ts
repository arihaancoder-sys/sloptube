// Pure feature flag logic, shared by the server, the browser and the tests.
// No imports on purpose, so `node --test` can load it directly.

export type FlagMode = "off" | "test" | "everyone";

export type Flag = {
  key: string;
  label: string;
  description: string;
  mode: FlagMode;
  users: string[];
  updated_at: string | null;
};

/**
 * Used only when the flags cannot be read at all (database not connected, or
 * migration 001 not applied yet). A row in the table always wins.
 */
export const FALLBACK_MODES: Record<string, FlagMode> = {
  accounts: "everyone",
};

export function isFlagMode(value: unknown): value is FlagMode {
  return value === "off" || value === "test" || value === "everyone";
}

/** off = hidden, test = only listed user ids, everyone = all. */
export function evaluateFlag(flag: Pick<Flag, "mode" | "users"> | undefined, userId: string | null): boolean {
  if (!flag) return false;
  if (flag.mode === "everyone") return true;
  if (flag.mode === "test") return userId !== null && flag.users.includes(userId);
  return false;
}
