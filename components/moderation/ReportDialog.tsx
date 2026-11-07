"use client";

import { useEffect, useState } from "react";
import { moderationErrorMessage, REASON_LABELS, REPORT_REASONS, reportProblem, DETAILS_MAX, type ReportReason, type TargetKind } from "@/lib/moderation/rules";
import { useSubscriptions } from "@/lib/store/subscriptions";

const TITLES: Record<TargetKind, string> = { video: "Report video", comment: "Report comment", channel: "Report channel" };

/**
 * The 2019 report box: a list of reasons, a few words when needed, CANCEL
 * and REPORT. Sends POST /api/moderation/report and says thanks in the toast.
 */
export function ReportDialog({ kind, targetId, onClose }: { kind: TargetKind; targetId: string; onClose: () => void }) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const showToast = useSubscriptions((s) => s.showToast);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const problem = reportProblem(reason, details);
  const submit = async () => {
    if (problem || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/moderation/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetKind: kind, targetId, reason, details: details.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok && json.error !== "already_reported") {
        setError(moderationErrorMessage(json.error));
        return;
      }
      onClose();
      showToast(json.error === "already_reported" ? moderationErrorMessage("already_reported") : "Thanks for reporting");
    } catch {
      setError(moderationErrorMessage("failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-4" role="dialog" aria-modal aria-label={TITLES[kind]} data-report-dialog={kind}>
      <div className="w-full max-w-[400px] rounded-sm bg-surface py-5" style={{ boxShadow: "var(--menu-shadow)" }}>
        <h2 className="px-6 text-[16px] font-medium text-text">{TITLES[kind]}</h2>
        <fieldset className="mt-3" disabled={busy}>
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="flex h-10 cursor-pointer items-center gap-4 px-6 text-[14px] text-text hover:bg-hover" data-report-reason={r}>
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => setReason(r)}
                className="h-5 w-5 accent-[var(--link)]"
              />
              {REASON_LABELS[r]}
            </label>
          ))}
        </fieldset>
        {reason && (
          <div className="mt-2 px-6">
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={DETAILS_MAX}
              rows={3}
              placeholder={reason === "other" ? "Tell us what's wrong" : "Add details (optional)"}
              aria-label="Details"
              className="w-full resize-none border-b border-divider bg-transparent py-1 text-[14px] text-text outline-none placeholder:text-text-2 focus:border-text"
              data-report-details
            />
            <p className="text-right text-[12px] text-text-2">
              {details.trim().length}/{DETAILS_MAX}
            </p>
          </div>
        )}
        {error && (
          <p className="mt-2 px-6 text-[13px] text-[var(--error)]" role="alert" data-report-error>
            {error}
          </p>
        )}
        <p className="mt-3 px-6 text-[12px] leading-4 text-text-2">
          Reports are reviewed by the sloptube team. Misusing reports can get your account limited.
        </p>
        <div className="mt-4 flex justify-end gap-2 px-4">
          <button type="button" className="btn-text" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-text !text-link disabled:!text-text-2 disabled:opacity-60" disabled={Boolean(problem) || busy} onClick={() => void submit()} data-report-send>
            Report
          </button>
        </div>
      </div>
    </div>
  );
}
