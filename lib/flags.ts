import "server-only";
import { cache } from "react";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { FALLBACK_MODES, evaluateFlag, isFlagMode, type Flag } from "@/lib/flags-core";
import { readSupabaseConfig } from "@/lib/supabase/env";

export type FlagsResult = {
  /** "table" when read from public.feature_flags, "fallback" otherwise. */
  source: "table" | "fallback";
  flags: Flag[];
};

function fallback(): FlagsResult {
  return {
    source: "fallback",
    flags: Object.entries(FALLBACK_MODES).map(([key, mode]) => ({
      key,
      label: key,
      description: "Built in default, the flags table could not be read.",
      mode,
      users: [],
      updated_at: null,
    })),
  };
}

/**
 * All flags, read once per request (React cache dedupes the calls).
 * Flags are public, so this uses a plain client without the session cookie.
 */
export const getFlags = cache(async (): Promise<FlagsResult> => {
  const config = readSupabaseConfig();
  if (!config) return fallback();

  const supabase = createSupabaseClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase
    .from("feature_flags")
    .select("key, label, description, mode, users, updated_at")
    .order("key");
  if (error || !data) return fallback();

  return {
    source: "table",
    flags: data
      .filter((row) => isFlagMode(row.mode))
      .map((row) => ({ ...row, users: row.users ?? [] }) as Flag),
  };
});

/**
 * Is the feature on for this person?
 * Leave userId out to check the person making the request.
 * Pass null to check for a signed out visitor.
 */
export async function flagOn(key: string, userId?: string | null): Promise<boolean> {
  const { flags } = await getFlags();
  const id = userId === undefined ? ((await getCurrentUser())?.id ?? null) : userId;
  return evaluateFlag(
    flags.find((f) => f.key === key),
    id,
  );
}

/**
 * Every flag evaluated for one person, for the browser store.
 * Only true or false goes to the browser, never the user id lists.
 */
export async function evaluateAllFlags(userId: string | null): Promise<Record<string, boolean>> {
  const { flags } = await getFlags();
  return Object.fromEntries(flags.map((f) => [f.key, evaluateFlag(f, userId)]));
}
