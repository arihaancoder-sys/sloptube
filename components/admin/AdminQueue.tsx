"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { groupActions, type QueueGroup } from "@/lib/moderation/queue";
import { actionNeedsReason, DETAILS_MAX, REASON_LABELS, type ModAction } from "@/lib/moderation/rules";
import { strikesLabel } from "@/lib/moderation/strikes";
import { timeAgo } from "@/lib/watch/format";
import { card } from "./AdminShell";
import { ACTION_DONE, ACTION_LABELS, useAdminAction } from "./useAdminAction";

const KIND_LABEL = { video: "Video", comment: "Comment", channel: "Channel" } as const;

const DANGER = new Set<ModAction>(["remove", "strike", "suspend", "ban"]);

function targetHref(g: QueueGroup): string | null {
  if (g.targetKind === "channel") return g.channel ? `/@${g.channel.handle}` : null;
  if (g.videoId) return `/watch?v=${g.videoId}`;
  return null;
}

function Group({ g, now, preview, onDone }: { g: QueueGroup; now: number; preview?: boolean; onDone: (text: string, closes: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { run, busy } = useAdminAction(preview);
  const actions = groupActions(g) as ModAction[];
  const href = targetHref(g);
  const appeal = g.kind === "appeal";

  const act = async (action: ModAction) => {
    if (actionNeedsReason(action) && !reason.trim()) {
      setError("Add a reason first. The uploader and the log show it.");
      return;
    }
    setError(null);
    // Strikes, suspensions and bans go to whoever is behind the target.
    const out = await run({ action, targetKind: g.targetKind, targetId: g.targetId, reason: reason.trim(), kind: g.kind });
    if (!out.ok) return setError(out.message);
    const closes = action !== "unsuspend" && action !== "unban";
    onDone(`${ACTION_DONE[action]}${out.suspended && action === "strike" ? ": that was the third strike, the channel is suspended" : ""}`, closes);
  };

  return (
    <li className={`${card} p-4`} data-queue-group={g.key} data-queue-kind={g.kind} data-queue-target={g.targetKind}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
        <span
          className={`rounded-[2px] px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.5px] ${
            appeal ? "bg-[var(--studio-accent)] text-white" : "bg-hover text-text-2"
          }`}
        >
          {appeal ? "Appeal" : KIND_LABEL[g.targetKind]}
        </span>
        <div className="min-w-0 flex-1">
          {href && !g.gone ? (
            <Link href={href} className="line-clamp-2 break-words text-[14px] font-medium leading-5 text-text hover:underline" data-queue-label>
              {g.targetLabel || "(no text)"}
            </Link>
          ) : (
            <p className="line-clamp-2 break-words text-[14px] font-medium leading-5 text-text-2" data-queue-label>
              {g.gone ? "This is gone already" : g.targetLabel || "(no text)"}
            </p>
          )}
          {g.channel && (
            <p className="mt-0.5 text-[12px] leading-4 text-text-2">
              <Link href={`/@${g.channel.handle}`} className="hover:underline">
                {g.channel.name}
              </Link>{" "}
              · {strikesLabel(g.channel.strikes)}
              {g.channel.suspended && <span className="font-medium text-[var(--error)]"> · Suspended</span>}
              {g.ownerBanned && <span className="font-medium text-[var(--error)]"> · Banned</span>}
              {g.removed && !appeal && <span> · Already removed</span>}
            </p>
          )}
        </div>
        <span className="shrink-0 text-[13px] font-medium text-text" data-queue-count={g.count}>
          {appeal ? "" : g.count === 1 ? "1 report" : `${g.count} reports`}
        </span>
      </div>

      <div className="mt-3 border-l-2 border-divider pl-3 text-[13px] leading-[18px]">
        <p className="text-text">
          <span className="font-medium" data-queue-latest-reason>
            {REASON_LABELS[g.latest.reason]}
          </span>
          <span className="text-text-2">
            {" "}
            · {g.latest.reporterName} · {timeAgo(g.latest.createdAt, now)}
          </span>
        </p>
        {g.latest.details && <p className="mt-0.5 whitespace-pre-wrap break-words text-text-2">&ldquo;{g.latest.details}&rdquo;</p>}
        {g.reasons.length > 1 && (
          <p className="mt-1 text-[12px] text-text-2" data-queue-reasons>
            {g.reasons.map((r) => `${REASON_LABELS[r.reason]} ${r.count}`).join(" · ")}
          </p>
        )}
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={DETAILS_MAX}
          placeholder={appeal ? "Note (optional)" : "Reason (shown to the uploader)"}
          aria-label="Reason"
          className="h-9 w-full min-w-0 shrink-0 rounded-[2px] border border-divider bg-transparent sm:w-auto sm:flex-1 px-2 text-[13px] text-text outline-none placeholder:text-text-2 focus:border-[var(--studio-accent)]"
          data-queue-reason
        />
        <div className="flex flex-wrap gap-1">
          {actions.map((a) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              onClick={() => void act(a)}
              className={`h-9 rounded-[2px] px-3 text-[13px] font-medium uppercase disabled:opacity-50 ${
                DANGER.has(a) ? "text-[var(--error)] hover:bg-[var(--error)]/10" : "text-[var(--studio-accent)] hover:bg-hover"
              }`}
              data-action={a}
            >
              {ACTION_LABELS[a]}
            </button>
          ))}
        </div>
      </div>
      {error && (
        <p className="mt-2 text-[13px] text-[var(--error)]" role="alert" data-queue-error>
          {error}
        </p>
      )}
    </li>
  );
}

/** The open reports, grouped by target, appeals first. */
export function AdminQueue({ groups, now, preview }: { groups: QueueGroup[]; now: number; preview?: boolean }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const shown = groups.filter((g) => !gone.has(g.key));
  const total = shown.reduce((n, g) => n + (g.kind === "report" ? g.count : 0), 0);
  const appeals = shown.filter((g) => g.kind === "appeal").length;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <section aria-label="Open reports" data-queue={shown.length}>
      <p className="mb-3 text-[14px] text-text-2" data-queue-summary>
        {shown.length === 0
          ? "Nothing to review."
          : `${total === 1 ? "1 open report" : `${total} open reports`} on ${shown.length - appeals === 1 ? "1 target" : `${shown.length - appeals} targets`}${
              appeals ? `, ${appeals === 1 ? "1 appeal" : `${appeals} appeals`}` : ""
            }`}
      </p>
      {shown.length === 0 ? (
        <div className={`${card} px-4 py-12 text-center text-[14px] text-text-2`} data-queue-empty>
          The queue is empty. New reports and appeals show up here.
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((g) => (
            <Group
              key={g.key}
              g={g}
              now={now}
              preview={preview}
              onDone={(text, closes) => {
                setToast(text);
                if (closes) setGone((s) => new Set(s).add(g.key));
              }}
            />
          ))}
        </ul>
      )}
      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-[2px] bg-[#323232] px-4 py-3 text-[14px] text-white shadow-lg"
          data-admin-toast
        >
          {toast}
        </div>
      )}
    </section>
  );
}
