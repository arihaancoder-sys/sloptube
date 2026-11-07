"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { removeAvatars } from "@/lib/accounts/avatar";
import { removeBanners } from "@/lib/channels/banner";
import { accountErrorText } from "@/lib/accounts/validation";
import { createClient } from "@/lib/supabase/client";

/** Delete account, with a confirmation step: type your username. */
export function DeleteAccount({
  userId,
  username,
  disabled,
}: {
  userId: string;
  username: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const supabase = createClient();
    if (!supabase) return setError("database not connected");
    setBusy(true);
    setError(null);
    await removeAvatars(supabase, userId);
    // The bucket only exists once migration 004 is applied; a failure here is fine.
    await removeBanners(supabase, userId).catch(() => {});
    const { error } = await supabase.rpc("delete_account");
    if (error) {
      setBusy(false);
      return setError(accountErrorText(error.message));
    }
    await supabase.auth.signOut();
    router.push("/");
    router.refresh();
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="btn-text !text-error disabled:opacity-50"
      >
        Delete account
      </button>
    );
  }

  return (
    <div role="alertdialog" aria-labelledby="delete-title" className="max-w-[440px] rounded-sm border border-divider p-4">
      <p id="delete-title" className="text-[14px] font-medium text-text">
        This cannot be undone.
      </p>
      <p className="mt-1 text-[14px] text-text-2">
        Type <strong className="text-text">{username}</strong> to confirm.
      </p>
      <input
        aria-label="Type your username to confirm"
        className="field mt-3"
        value={typed}
        autoCapitalize="none"
        onChange={(e) => setTyped(e.target.value)}
      />
      {error && <p role="alert" className="mt-2 text-[13px] text-error">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => setOpen(false)} className="btn-text">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || typed.trim().toLowerCase() !== username}
          onClick={remove}
          className="btn-blue !bg-[var(--red)]"
        >
          {busy ? "Deleting" : "Delete account"}
        </button>
      </div>
    </div>
  );
}
