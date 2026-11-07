import { create } from "zustand";
import type { SupabaseConfig } from "@/lib/supabase/env";

/** What the browser knows about the signed in person. Never secrets. */
export type SessionUser = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  /** False until username and birthdate are confirmed (complete_signup). */
  onboarded: boolean;
  /** The person's channel handle, or null before migration 004 is applied. */
  channelHandle: string | null;
};

type SessionState = {
  /** True once the server has handed its values over for this page load. */
  loaded: boolean;
  config: SupabaseConfig | null;
  user: SessionUser | null;
  /** Feature flags already evaluated for this person: key to on or off. */
  flags: Record<string, boolean>;
  setSession: (s: {
    config: SupabaseConfig | null;
    user: SessionUser | null;
    flags: Record<string, boolean>;
  }) => void;
};

export const useSession = create<SessionState>((set) => ({
  loaded: false,
  config: null,
  user: null,
  flags: {},
  setSession: (s) => set({ ...s, loaded: true }),
}));

/** Client side flag check. Use flagOn() from lib/flags.ts on the server. */
export function useFlag(key: string): boolean {
  return useSession((s) => s.flags[key] === true);
}
