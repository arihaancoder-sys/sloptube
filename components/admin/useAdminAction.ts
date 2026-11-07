"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { moderationErrorMessage, type ModAction, type ReportKind, type TargetKind } from "@/lib/moderation/rules";

export type ActionInput = { action: ModAction; targetKind: TargetKind; targetId: string; reason: string; kind?: ReportKind };
export type ActionOutcome = { ok: true; closed: number; suspended: boolean } | { ok: false; message: string };

/** POST /api/admin/action, then the server data is read again. */
export function useAdminAction(preview?: boolean) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const run = async (input: ActionInput): Promise<ActionOutcome> => {
    if (preview) return { ok: true, closed: 1, suspended: input.action === "suspend" || input.action === "ban" };
    setBusy(true);
    try {
      const res = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "report", ...input }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; closed?: number; suspended?: boolean };
      if (!res.ok) return { ok: false, message: moderationErrorMessage(json.error) };
      router.refresh();
      return { ok: true, closed: Number(json.closed ?? 0), suspended: json.suspended === true };
    } catch {
      return { ok: false, message: moderationErrorMessage("failed") };
    } finally {
      setBusy(false);
    }
  };
  return { run, busy };
}

export const ACTION_LABELS: Record<ModAction, string> = {
  dismiss: "Dismiss",
  remove: "Remove",
  restore: "Restore video",
  strike: "Strike channel",
  suspend: "Suspend channel",
  unsuspend: "Unsuspend",
  ban: "Ban user",
  unban: "Unban",
};

export const ACTION_DONE: Record<ModAction, string> = {
  dismiss: "Dismissed",
  remove: "Removed",
  restore: "Restored",
  strike: "Strike given",
  suspend: "Channel suspended",
  unsuspend: "Channel unsuspended",
  ban: "User banned",
  unban: "User unbanned",
};
