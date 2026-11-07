"use client";

import Link from "next/link";
import { useState } from "react";
import type { FoundChannel } from "@/lib/moderation/server";
import { DETAILS_MAX, type ModAction } from "@/lib/moderation/rules";
import { strikesLabel } from "@/lib/moderation/strikes";
import type { SuspendedChannel } from "@/lib/moderation/types";
import { formatDate } from "@/lib/watch/format";
import { card } from "./AdminShell";
import { ACTION_DONE, ACTION_LABELS, useAdminAction } from "./useAdminAction";

function ChannelActions({ id, actions, preview, needReason }: { id: string; actions: ModAction[]; preview?: boolean; needReason: boolean }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const { run, busy } = useAdminAction(preview);
  const act = async (action: ModAction) => {
    if (needReason && action !== "unsuspend" && action !== "unban" && !reason.trim()) return setNote("Add a reason first.");
    const out = await run({ action, targetKind: "channel", targetId: id, reason: reason.trim() });
    setNote(out.ok ? ACTION_DONE[action] : out.message);
  };
  return (
    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
      {needReason && (
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={DETAILS_MAX}
          placeholder="Reason"
          aria-label="Reason"
          className="h-9 w-full min-w-0 shrink-0 rounded-[2px] border border-divider bg-transparent sm:w-auto sm:flex-1 px-2 text-[13px] text-text outline-none placeholder:text-text-2 focus:border-[var(--studio-accent)]"
        />
      )}
      <div className="flex flex-wrap gap-1">
        {actions.map((a) => (
          <button
            key={a}
            type="button"
            disabled={busy}
            onClick={() => void act(a)}
            className={`h-9 rounded-[2px] px-3 text-[13px] font-medium uppercase disabled:opacity-50 ${
              a === "suspend" || a === "ban" ? "text-[var(--error)] hover:bg-[var(--error)]/10" : "text-[var(--studio-accent)] hover:bg-hover"
            }`}
            data-channel-action={a}
          >
            {ACTION_LABELS[a]}
          </button>
        ))}
      </div>
      {note && (
        <p className="text-[13px] text-text-2" role="status">
          {note}
        </p>
      )}
    </div>
  );
}

/** Suspend or unsuspend a channel directly, and the channels suspended now. */
export function AdminChannels({ suspended, found, query, preview }: { suspended: SuspendedChannel[]; found: FoundChannel | null; query: string; preview?: boolean }) {
  return (
    <section aria-label="Channels" className="mt-10" data-admin-channels>
      <h2 className="text-[16px] font-medium text-text">Channels</h2>
      <form method="get" action="/admin" className="mt-3 flex gap-2">
        <input
          name="channel"
          defaultValue={query}
          placeholder="Channel handle, like @name"
          aria-label="Channel handle"
          className="h-9 min-w-0 flex-1 rounded-[2px] border border-divider bg-surface px-2 text-[13px] text-text outline-none placeholder:text-text-2 focus:border-[var(--studio-accent)]"
          data-channel-find
        />
        <button type="submit" className="btn-blue">
          Find
        </button>
      </form>
      {query && (
        <div className={`${card} mt-3 p-4`} data-channel-found={found ? found.handle : "none"}>
          {found ? (
            <>
              <p className="text-[14px] text-text">
                <Link href={`/@${found.handle}`} className="font-medium hover:underline">
                  {found.name}
                </Link>{" "}
                <span className="text-text-2">@{found.handle}</span>
                {found.suspended && <span className="font-medium text-[var(--error)]"> · Suspended</span>}
              </p>
              <ChannelActions
                key={found.id}
                id={found.id}
                preview={preview}
                needReason
                actions={found.suspended ? ["unsuspend", "strike", "ban"] : ["suspend", "strike", "ban"]}
              />
            </>
          ) : (
            <p className="text-[14px] text-text-2">No channel with that handle.</p>
          )}
        </div>
      )}

      <h3 className="mt-6 text-[14px] font-medium text-text">Suspended now</h3>
      {suspended.length === 0 ? (
        <p className="mt-2 text-[14px] text-text-2" data-suspended-empty>
          No channel is suspended.
        </p>
      ) : (
        <ul className={`${card} mt-2 divide-y divide-divider`}>
          {suspended.map((c) => (
            <li key={c.id} className="p-4" data-suspended={c.handle}>
              <p className="text-[14px] text-text">
                <Link href={`/@${c.handle}`} className="font-medium hover:underline">
                  {c.name}
                </Link>{" "}
                <span className="text-text-2">
                  @{c.handle} · since {formatDate(c.suspendedAt)} · {strikesLabel(c.strikes)}
                  {c.banned ? " · Banned" : ""}
                </span>
              </p>
              {c.reason && <p className="mt-0.5 text-[13px] text-text-2">{c.reason}</p>}
              <ChannelActions id={c.id} preview={preview} needReason={false} actions={c.banned ? ["unsuspend", "unban"] : ["unsuspend"]} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
