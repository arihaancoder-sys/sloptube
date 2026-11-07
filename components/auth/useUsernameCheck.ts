"use client";

import { useEffect, useState } from "react";
import { normalizeUsername, usernameProblem } from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";

export type UsernameStatus =
  | { state: "idle" }
  | { state: "invalid"; message: string }
  | { state: "checking" }
  | { state: "available" }
  | { state: "taken" }
  | { state: "unknown" };

/**
 * Checks a username as it is typed: the format right away, then (after a
 * short pause) whether it is free, through public.username_available().
 * `current` is the person's own username, which always counts as theirs.
 */
export function useUsernameCheck(input: string, current?: string): UsernameStatus {
  const name = normalizeUsername(input);
  const problem = name ? usernameProblem(name) : null;
  const [result, setResult] = useState<{ name: string; status: UsernameStatus } | null>(null);

  useEffect(() => {
    if (!name || problem || name === current) return;
    let live = true;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc("username_available", { name });
      if (!live) return;
      setResult({
        name,
        status: error ? { state: "unknown" } : data ? { state: "available" } : { state: "taken" },
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [name, problem, current]);

  if (!name) return { state: "idle" };
  if (problem) return { state: "invalid", message: problem };
  if (name === current) return { state: "available" };
  if (result?.name === name) return result.status;
  return { state: "checking" };
}

export function usernameNote(status: UsernameStatus): { hint?: string; error?: string } {
  switch (status.state) {
    case "invalid":
      return { error: status.message };
    case "taken":
      return { error: "That username is taken. Try another." };
    case "checking":
      return { hint: "Checking..." };
    case "available":
      return { hint: "Available" };
    case "unknown":
      return { hint: "Could not check right now. We will check when you save." };
    default:
      return { hint: "3 to 24 letters, numbers or underscores" };
  }
}
