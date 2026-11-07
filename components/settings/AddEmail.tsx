"use client";

import { useState, type FormEvent } from "react";
import { accountErrorText } from "@/lib/accounts/validation";
import { isEmail } from "@/lib/launch/rules";
import { createClient } from "@/lib/supabase/client";
import { isPlaceholderEmail } from "@/lib/yapin/rules";
import { FormError, TextField } from "../auth/fields";

/**
 * Settings > Account for an account made by Sign in with Yapin' (feature 16b).
 * Yapin' shares no email address, so the account only has a placeholder.
 * Adding one is optional: Supabase sends a confirm link to the new address,
 * and once it is opened the address replaces the placeholder (019 clears
 * profiles.email_placeholder). Then the account can also unlink Yapin'.
 */
export function AddEmail() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean = email.trim().toLowerCase();
    if (!isEmail(clean) || isPlaceholderEmail(clean)) return setError("Enter a real email address.");
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser(
      { email: clean },
      { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent("/settings")}` },
    );
    setBusy(false);
    if (error) return setError(accountErrorText(error.message));
    setSentTo(clean);
  }

  return (
    <section data-add-email className="mb-2 rounded-[2px] border border-divider px-4 py-4">
      <h2 className="text-[16px] font-medium text-text">Add an email</h2>
      <p className="mt-1 text-[14px] text-text-2">
        You signed up with Yapin&apos;, which does not share an email address. Add one if you like: it lets you
        unlink Yapin&apos; later. We only use it for your account.
      </p>
      {sentTo ? (
        <p role="status" data-add-email-sent className="mt-3 text-[14px] text-text">
          Check {sentTo} for a link to confirm it.
        </p>
      ) : (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-start gap-3">
          <div className="min-w-[220px] flex-1">
            <TextField label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-add-email-input />
          </div>
          <button type="submit" disabled={busy || !email.trim()} data-add-email-save className="btn-blue !normal-case rounded h-[56px] disabled:opacity-60">
            {busy ? "Sending" : "Send confirm link"}
          </button>
        </form>
      )}
      <FormError message={error} />
    </section>
  );
}
