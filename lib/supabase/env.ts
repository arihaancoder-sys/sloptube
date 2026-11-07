export const SUPABASE_URL_ENV = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_KEY_ENV = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export type SupabaseConfig = { url: string; key: string };

/**
 * Reads the Supabase settings on the server at request time.
 * The lookup goes through a variable on purpose so Next does not freeze
 * the values into the build. The same Docker image can then run with
 * whatever is in /opt/sloptube/.env.
 */
export function readSupabaseConfig(): SupabaseConfig | null {
  const env = process.env;
  const url = env[SUPABASE_URL_ENV]?.trim();
  const key = env[SUPABASE_KEY_ENV]?.trim();
  if (!url || !key) return null;
  return { url, key };
}
