import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagPanelErrorCode, PANEL_FLAG_KEY, PANEL_FLAGS, type PanelFlagState } from "@/lib/flag-panel";
import { evaluateFlag, isFlagMode } from "@/lib/flags-core";
import { getFlags } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type Fail = { error: string };

/**
 * Is the person asking an admin with the flag_panel flag on? Reads the request.
 * Nothing is asked of the database for a signed out visitor.
 */
export async function flagPanelOn(): Promise<{ userId: string; supabase: NonNullable<Awaited<ReturnType<typeof createClient>>> } | Fail> {
  await connection();
  if (!readSupabaseConfig()) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  const { flags } = await getFlags();
  if (!evaluateFlag(flags.find((f) => f.key === PANEL_FLAG_KEY), user.id)) return { error: "flag_panel_off" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) return { error: "not_admin" };
  return { userId: user.id, supabase };
}

/**
 * Every panel flag's mode for the admin, with whether they are listed for test
 * mode. Only true or false about their own id goes to the browser, never the lists.
 */
export async function panelFlagStates(userId: string): Promise<Record<string, PanelFlagState>> {
  const { flags } = await getFlags();
  const out: Record<string, PanelFlagState> = {};
  for (const { key } of PANEL_FLAGS) {
    const f = flags.find((x) => x.key === key);
    if (f) out[key] = { mode: f.mode, mine: f.users.includes(userId) };
  }
  return out;
}

/** "The function is not there": migration 020 not applied yet. */
function codeOf(error: { code?: string; message?: string }): string {
  if (error.code === "PGRST202" || error.code === "42883") return "not_set_up";
  return flagPanelErrorCode(error.message);
}

/** set_feature_flag(key, mode) as the admin. */
export async function setFlag(key: string, mode: string): Promise<PanelFlagState | Fail> {
  if (!isFlagMode(mode)) return { error: "bad_mode" };
  const gate = await flagPanelOn();
  if ("error" in gate) return gate;
  const { data, error } = await gate.supabase.rpc("set_feature_flag", { p_key: key, p_mode: mode });
  if (error) return { error: codeOf(error) };
  const r = (data ?? {}) as { mode?: unknown; users?: unknown };
  const users = Array.isArray(r.users) ? (r.users as unknown[]) : [];
  return { mode: isFlagMode(r.mode) ? r.mode : mode, mine: users.includes(gate.userId) };
}
