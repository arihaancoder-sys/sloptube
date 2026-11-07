import "server-only";
import { cache } from "react";
import type { SessionUser } from "@/lib/store/session";
import { createClient } from "@/lib/supabase/server";
import { isPlaceholderEmail } from "@/lib/yapin/rules";

export type CurrentUser = SessionUser & {
  /** The real address, or null (also for a Sign in with Yapin' placeholder, which is never shown). */
  email: string | null;
  /** The account only has a placeholder address (feature 16b): Settings offers to add one. */
  emailPlaceholder: boolean;
  bio: string;
};

/** Public profile columns. birthdate is never readable through the API. */
export const PROFILE_COLUMNS = "username, display_name, avatar_url, bio, onboarded";

/**
 * The signed in person and their profile, read once per request.
 * Returns null when signed out or when the database is not connected.
 * Only call it inside a <Suspense> boundary: it reads the session cookie.
 */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const supabase = await createClient();
  if (!supabase) return null;

  // getClaims verifies the access token (locally when the project uses
  // asymmetric signing keys) instead of trusting the cookie as is.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) return null;
  const id = data.claims.sub;
  const claimed = typeof data.claims.email === "string" ? data.claims.email : null;
  const emailPlaceholder = isPlaceholderEmail(claimed);
  const email = emailPlaceholder ? null : claimed;

  const [{ data: profile }, { data: channel }] = await Promise.all([
    supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", id).maybeSingle(),
    // Fails quietly (null) until migration 004 adds the channels table.
    supabase.from("channels").select("handle").eq("owner_id", id).maybeSingle(),
  ]);

  const fallbackName = email?.split("@")[0] ?? "you";
  return {
    id,
    email,
    emailPlaceholder,
    username: profile?.username ?? fallbackName,
    displayName: profile?.display_name || profile?.username || fallbackName,
    avatarUrl: profile?.avatar_url ?? null,
    bio: profile?.bio ?? "",
    onboarded: profile?.onboarded ?? false,
    channelHandle: channel?.handle ?? null,
  };
});

/** Strip a CurrentUser down to what the browser store may hold. */
export function toSessionUser(user: CurrentUser): SessionUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    onboarded: user.onboarded,
    channelHandle: user.channelHandle,
  };
}
