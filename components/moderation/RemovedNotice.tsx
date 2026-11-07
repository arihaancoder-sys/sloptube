"use client";

import { useEffect, useState } from "react";
import { DETAILS_MAX, moderationErrorMessage } from "@/lib/moderation/rules";
import { useFlag } from "@/lib/store/session";

type Appeal = "open" | "dismissed" | "actioned" | null;

function AppealDialog({ videoId, title, onClose, onSent }: { videoId: string; title: string; onClose: () => void; onSent: () => void }) {
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/moderation/appeal", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ videoId, details: details.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && json.error !== "already_appealed") {
        setError(moderationErrorMessage(json.error));
        return;
      }
      onSent();
    } catch {
      setError(moderationErrorMessage("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal aria-label="Appeal the removal" data-appeal-dialog>
      <div className="w-full max-w-[440px] rounded-sm bg-surface p-6" style={{ boxShadow: "var(--menu-shadow)" }}>
        <h2 className="text-[16px] font-medium text-text">Appeal the removal</h2>
        <p className="mt-2 text-[14px] leading-5 text-text-2">
          Tell the team why <span className="text-text">{title}</span> follows the rules. Someone will look at it again.
        </p>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={DETAILS_MAX}
          rows={4}
          placeholder="Why should it come back?"
          aria-label="Why should it come back?"
          className="mt-4 w-full resize-none rounded-[2px] border border-divider bg-transparent p-2 text-[14px] text-text outline-none placeholder:text-text-2 focus:border-[var(--studio-accent,var(--link))]"
          data-appeal-details
        />
        {error && (
          <p className="mt-2 text-[13px] text-[var(--error)]" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-text" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-text !text-link" disabled={busy} onClick={() => void send()} data-appeal-send>
            Send appeal
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * "Your video was removed" on a studio Content row: the reason, and an
 * appeal (a report of kind appeal the admins see in their queue).
 */
export function RemovedNotice({ videoId, title, reason, appeal: initial }: { videoId: string; title: string; reason: string | null; appeal: Appeal }) {
  const on = useFlag("moderation");
  const [appeal, setAppeal] = useState<Appeal>(initial);
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-1 rounded-[2px] border-l-[3px] border-[var(--error)] bg-[var(--error)]/10 px-2 py-1.5 text-[12px] leading-4" data-removed-notice data-appeal={appeal ?? "none"}>
      <p className="font-medium text-text">Your video was removed</p>
      <p className="text-text-2">
        {reason ? `Reason: ${reason}. ` : ""}It stays private and is deleted 30 days after the removal.
      </p>
      {appeal === "open" ? (
        <p className="mt-1 text-text-2" data-appeal-state="open">
          Appeal sent. We will look at it again.
        </p>
      ) : appeal === "dismissed" ? (
        <p className="mt-1 text-text-2" data-appeal-state="dismissed">
          Your appeal was turned down.
        </p>
      ) : (
        on && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="mt-1 h-7 rounded-[2px] px-2 text-[12px] font-medium uppercase text-[var(--studio-accent,var(--link))] hover:bg-hover"
            data-appeal-open
          >
            Appeal
          </button>
        )
      )}
      {open && (
        <AppealDialog
          videoId={videoId}
          title={title}
          onClose={() => setOpen(false)}
          onSent={() => {
            setOpen(false);
            setAppeal("open");
          }}
        />
      )}
    </div>
  );
}
