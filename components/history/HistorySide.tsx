"use client";

import { useEffect, useState, type ComponentType } from "react";
import { DeleteIcon, PauseCircleIcon, PlayCircleIcon } from "@/components/icons";
import { engagementErrorMessage } from "@/lib/engagement/rules";
import { useSubscriptions } from "@/lib/store/subscriptions";

type Ask = null | "clear" | "pause" | "resume";

const ASKS: Record<Exclude<Ask, null>, { title: string; text: string; confirm: string }> = {
  clear: {
    title: "Clear watch history?",
    text: "Your sloptube watch history will be cleared, and the red bars and resume points go with it.",
    confirm: "Clear watch history",
  },
  pause: {
    title: "Pause watch history?",
    text: "Videos you watch while it is paused won't show up here, and won't remember where you stopped.",
    confirm: "Pause",
  },
  resume: {
    title: "Turn on watch history?",
    text: "Videos you watch will show up here again, with where you stopped.",
    confirm: "Turn on",
  },
};

function SideButton({
  Icon,
  label,
  onClick,
  ...rest
}: { Icon: ComponentType<{ className?: string }>; label: string; onClick: () => void } & Record<`data-${string}`, unknown>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-10 items-center gap-4 px-3 text-[14px] font-medium uppercase tracking-[0.007px] text-text-2 hover:text-text search:px-0"
      {...rest}
    >
      <Icon className="h-6 w-6 text-icon" />
      {label}
    </button>
  );
}

/** The 2019 confirm box: a title, a line, CANCEL and the blue action. */
function Confirm({ ask, busy, onCancel, onConfirm }: { ask: Exclude<Ask, null>; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const a = ASKS[ask];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-confirm-title"
        data-history-confirm={ask}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[400px] rounded-[2px] bg-surface p-6 shadow-[var(--menu-shadow)]"
      >
        <h2 id="history-confirm-title" className="text-[18px] font-normal leading-[26px] text-text">
          {a.title}
        </h2>
        <p className="mt-3 text-[14px] leading-5 text-text-2">{a.text}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="h-9 px-4 text-[14px] font-medium uppercase text-text-2 hover:bg-hover">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-history-confirm-ok
            className="h-9 px-4 text-[14px] font-medium uppercase text-link hover:bg-hover disabled:opacity-60"
          >
            {a.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The right column of the history page: History type, then CLEAR ALL WATCH
 * HISTORY and PAUSE WATCH HISTORY (TURN ON WATCH HISTORY while paused),
 * each behind a confirm box. On narrow screens it sits above the list.
 */
export function HistorySide({ paused: initialPaused, onCleared }: { paused: boolean; onCleared: () => void }) {
  const [paused, setPaused] = useState(initialPaused);
  const [ask, setAsk] = useState<Ask>(null);
  const [busy, setBusy] = useState(false);
  const showToast = useSubscriptions((s) => s.showToast);

  const confirm = async () => {
    if (!ask) return;
    setBusy(true);
    try {
      const res =
        ask === "clear"
          ? await fetch("/api/history", { method: "DELETE", headers: { "content-type": "application/json" }, body: "{}" })
          : await fetch("/api/history", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ paused: ask === "pause" }),
            });
      const body = (await res.json().catch(() => ({}))) as { error?: string; paused?: boolean };
      if (!res.ok) throw new Error(body.error ?? "failed");
      if (ask === "clear") {
        onCleared();
        showToast("Watch history cleared");
      } else {
        setPaused(body.paused === true);
        showToast(body.paused ? "Watch history paused" : "Watch history turned on");
      }
      setAsk(null);
    } catch (err) {
      showToast(engagementErrorMessage(err instanceof Error ? err.message : "failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="history-side" data-history-side data-history-paused={paused ? "1" : "0"}>
      <div className="hidden border-b border-divider pb-4 history:block">
        <h2 className="pb-3 text-[16px] font-normal text-text">History type</h2>
        <label className="flex items-center gap-4 py-2 text-[14px] text-text">
          <input type="radio" checked readOnly className="h-4 w-4 accent-[var(--link)]" />
          Watch history
        </label>
      </div>
      <div className="flex flex-wrap gap-x-6 border-b border-divider py-2 history:flex-col history:border-b-0 history:py-4">
        <SideButton Icon={DeleteIcon} label="Clear all watch history" onClick={() => setAsk("clear")} data-history-clear />
        {paused ? (
          <SideButton Icon={PlayCircleIcon} label="Turn on watch history" onClick={() => setAsk("resume")} data-history-pause="on" />
        ) : (
          <SideButton Icon={PauseCircleIcon} label="Pause watch history" onClick={() => setAsk("pause")} data-history-pause="off" />
        )}
      </div>
      {paused && (
        <p className="px-3 pb-3 text-[13px] leading-[18px] text-text-2 history:px-0" data-history-paused-note>
          Watch history is paused. Videos you watch now are not added.
        </p>
      )}
      {ask && <Confirm ask={ask} busy={busy} onCancel={() => setAsk(null)} onConfirm={() => void confirm()} />}
    </aside>
  );
}
