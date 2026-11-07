import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { readSupabaseConfig } from "./env";

/**
 * Supabase client for Server Components, Server Functions and Route Handlers.
 * Returns null when the database is not configured, so callers can show
 * a friendly state instead of crashing. `headers` go on every request it
 * makes (search sends the visitor's address for its rate limit).
 */
export async function createClient(opts: { headers?: Record<string, string> } = {}) {
  const config = readSupabaseConfig();
  if (!config) return null;

  const cookieStore = await cookies();

  return createServerClient(config.url, config.key, {
    ...(opts.headers ? { global: { headers: opts.headers } } : {}),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read only.
          // Session refresh will happen in a Route Handler or proxy later.
        }
      },
    },
  });
}
