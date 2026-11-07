"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useSession } from "@/lib/store/session";

/**
 * Supabase client for the browser.
 * The server passes the settings down at request time (see SessionProvider),
 * so the browser never depends on values frozen into the build.
 * Returns null when the database is not configured.
 */
export function createClient(): SupabaseClient | null {
  const config = useSession.getState().config;
  if (!config) return null;
  return createBrowserClient(config.url, config.key);
}
