"use client";

import { useEffect, useState } from "react";
import { handleProblem, handleProblemText, normalizeHandle } from "@/lib/channels/validation";
import { createClient } from "@/lib/supabase/client";

export type HandleStatus =
  | { state: "idle" }
  | { state: "invalid"; message: string }
  | { state: "checking" }
  | { state: "available" }
  | { state: "current" }
  | { state: "taken" }
  | { state: "unknown" };

/**
 * Checks a handle as it is typed: the format right away, then (after a short
 * pause) whether it is free, through public.channel_handle_available().
 */
export function useHandleCheck(input: string, current: string): HandleStatus {
  const handle = normalizeHandle(input);
  const problem = handle ? handleProblem(handle) : null;
  const [result, setResult] = useState<{ handle: string; status: HandleStatus } | null>(null);

  useEffect(() => {
    if (!handle || problem || handle === current) return;
    let live = true;
    const timer = setTimeout(async () => {
      const supabase = createClient();
      if (!supabase) return;
      const { data, error } = await supabase.rpc("channel_handle_available", { handle });
      if (!live) return;
      setResult({
        handle,
        status: error ? { state: "unknown" } : data ? { state: "available" } : { state: "taken" },
      });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [handle, problem, current]);

  if (!handle) return { state: "idle" };
  if (handle === current) return { state: "current" };
  if (problem) return { state: "invalid", message: handleProblemText(problem) };
  if (result?.handle === handle) return result.status;
  return { state: "checking" };
}

export function handleNote(status: HandleStatus): { hint?: string; error?: string } {
  switch (status.state) {
    case "invalid":
      return { error: status.message };
    case "taken":
      return { error: "That handle is taken. Try another." };
    case "checking":
      return { hint: "Checking..." };
    case "available":
      return { hint: "Available" };
    case "current":
      return { hint: "Your current handle" };
    case "unknown":
      return { hint: "Could not check right now. We will check when you save." };
    default:
      return { hint: "3 to 30 letters, numbers, underscores or dots" };
  }
}
