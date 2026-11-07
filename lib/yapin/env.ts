// The Yapin' settings, read on the server at request time (never frozen into
// the build). Only type imports, so the tests load it directly.
import { DEFAULT_YAPIN_BASE, type YapinClient } from "./oauth.ts";

export const YAPIN_CLIENT_ID_ENV = "YAPIN_CLIENT_ID";
export const YAPIN_CLIENT_SECRET_ENV = "YAPIN_CLIENT_SECRET";
/** Signing in someone else's account needs the Supabase service role on the app server. */
export const SERVICE_ROLE_ENV = "SUPABASE_SERVICE_ROLE_KEY";
/** Only for the checks in scripts/yapin-shots.mjs: a stand in for yapin.gg. */
export const YAPIN_BASE_ENV = "YAPIN_BASE_URL";

export type YapinConfig = YapinClient & { serviceRoleKey: string };

/**
 * The Yapin' app and the service role key, or null when any is missing:
 * Continue with Yapin' and Connections are then hidden and the routes answer
 * 503 yapin_off.
 */
export function readYapinConfig(env: Record<string, string | undefined> = process.env): YapinConfig | null {
  const clientId = env[YAPIN_CLIENT_ID_ENV]?.trim();
  const clientSecret = env[YAPIN_CLIENT_SECRET_ENV]?.trim();
  const serviceRoleKey = env[SERVICE_ROLE_ENV]?.trim();
  if (!clientId || !clientSecret || !serviceRoleKey) return null;
  const base = (env[YAPIN_BASE_ENV]?.trim() || DEFAULT_YAPIN_BASE).replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/.test(base)) return null;
  return { clientId, clientSecret, serviceRoleKey, base };
}
