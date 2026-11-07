"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { YapinIcon } from "@/components/icons";
import { yapinErrorText, yapinNote } from "@/lib/yapin/rules";

/**
 * Settings > Connections (feature 16): link or unlink a Yapin' account. Link
 * goes through yapin.gg and back to /auth/yapin; Unlink asks the API. Once
 * linked, Continue with Yapin' signs in to this account. An account made by
 * Sign in with Yapin' with no real email address yet (needsEmail) cannot
 * unlink: Yapin' is its only way in.
 */
export function Connections({ linked, username, needsEmail = false }: { linked: boolean; username: string | null; needsEmail?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const note = yapinNote(params.get("yapin"));

  async function unlink() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/yapin/unlink", { method: "POST" }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { error?: string } | null;
    setBusy(false);
    if (!res?.ok) return setError(yapinErrorText(json?.error ?? "failed"));
    router.replace("/settings?yapin=unlinked");
    router.refresh();
  }

  return (
    <section data-connections className="mt-8 border-t border-divider pt-6">
      <h2 className="text-[16px] font-medium text-text">Connections</h2>
      <p className="mt-1 text-[14px] text-text-2">Accounts you can use to sign in to sloptube.</p>
      <div data-yapin-connection={linked ? "linked" : "unlinked"} className="mt-4 flex flex-wrap items-center gap-4 rounded-[2px] border border-divider px-4 py-3">
        <YapinIcon className="h-8 w-8 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-text">Yapin&apos;</p>
          <p className="text-[13px] text-text-2">
            {linked ? (username ? `Linked as ${username}` : "Linked") : "Not linked"}
          </p>
        </div>
        {linked && needsEmail ? null : linked ? (
          <button type="button" onClick={unlink} disabled={busy} data-yapin-unlink className="h-9 px-4 text-[14px] font-medium uppercase text-text-2 hover:bg-hover disabled:opacity-60">
            {busy ? "Unlinking" : "Unlink"}
          </button>
        ) : (
          <a href="/auth/yapin/start?mode=link&next=%2Fsettings" data-yapin-link className="btn-blue !normal-case rounded">
            Link
          </a>
        )}
      </div>
      {linked && (
        <p data-yapin-connection-help className="mt-2 text-[12px] text-text-2">
          {needsEmail
            ? "Yapin' is the only way into this account. Add an email address above to be able to unlink it."
            : "After unlinking, Continue with Yapin' makes a new account. Link it here again to sign in to this one."}
        </p>
      )}
      {(error || note) && (
        <p role="status" data-yapin-note className={`mt-2 text-[13px] ${error ? "text-error" : "text-text"}`}>
          {error ?? note}
        </p>
      )}
    </section>
  );
}
