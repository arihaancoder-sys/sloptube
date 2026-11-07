"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { GoogleIcon } from "../icons";

/**
 * Starts Google sign in through Supabase. Google sends people back to
 * Supabase, which sends them to /auth/callback on this site.
 */
export function GoogleButton({ label, next }: { label: string; next: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy(true);
    setError(null);
    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo } });
    if (error) {
      setBusy(false);
      setError(
        /provider is not enabled/i.test(error.message)
          ? "Google sign in is not switched on yet. Use email for now."
          : error.message,
      );
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="flex h-10 w-full items-center justify-center gap-3 rounded border border-[#dadce0] bg-surface text-[14px] font-medium text-[#3c4043] hover:bg-[#f8faff] disabled:opacity-60 dark:border-[#5f6368] dark:text-[#e8eaed] dark:hover:bg-hover"
      >
        <GoogleIcon className="h-[18px] w-[18px]" />
        {label}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-error">
          {error}
        </p>
      )}
    </div>
  );
}
