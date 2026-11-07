"use client";

import { useEffect } from "react";
import { useSession, type SessionUser } from "@/lib/store/session";
import type { SupabaseConfig } from "@/lib/supabase/env";

/**
 * Hands what the server read for this request (database settings, the signed
 * in person, evaluated feature flags) to the browser store.
 */
export function SessionProvider({
  config,
  user,
  flags,
}: {
  config: SupabaseConfig | null;
  user: SessionUser | null;
  flags: Record<string, boolean>;
}) {
  const setSession = useSession((s) => s.setSession);
  useEffect(() => {
    setSession({ config, user, flags });
  }, [config, user, flags, setSession]);
  return null;
}
