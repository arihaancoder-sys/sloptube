// The admin queue: open reports grouped by what they point at. No imports
// beyond types, so Node loads it directly.
import type { ReportKind, ReportReason, TargetKind } from "./rules.ts";

/** One open report as admin_reports() answers it. */
export type QueueReport = {
  id: string;
  kind: ReportKind;
  targetKind: TargetKind;
  targetId: string;
  reason: ReportReason | "appeal";
  details: string;
  createdAt: string;
  reporterName: string;
  targetLabel: string | null;
  videoId: string | null;
  channel: { id: string; handle: string; name: string; suspended: boolean; strikes: number } | null;
  ownerBanned: boolean;
  ownerAdmin: boolean;
  removed: boolean;
  gone: boolean;
};

/** One row of the queue: every open report on one target (appeals apart). */
export type QueueGroup = {
  key: string;
  kind: ReportKind;
  targetKind: TargetKind;
  targetId: string;
  count: number;
  /** How many reports gave each reason, most first. */
  reasons: { reason: ReportReason | "appeal"; count: number }[];
  latest: QueueReport;
  firstAt: string;
  targetLabel: string | null;
  videoId: string | null;
  channel: QueueReport["channel"];
  ownerBanned: boolean;
  ownerAdmin: boolean;
  removed: boolean;
  gone: boolean;
};

export const groupKey = (r: Pick<QueueReport, "kind" | "targetKind" | "targetId">) => `${r.kind}:${r.targetKind}:${r.targetId}`;

const at = (s: string) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
};

/**
 * Groups the open reports by target, an appeal apart from the reports on
 * the same video. Appeals come first (someone is waiting on them), then the
 * targets with the most reports, then the most recent. Within a group the
 * latest report gives the reason and the text shown.
 */
export function groupReports(reports: readonly QueueReport[]): QueueGroup[] {
  const groups = new Map<string, { list: QueueReport[] }>();
  for (const r of reports) {
    const k = groupKey(r);
    const g = groups.get(k);
    if (g) g.list.push(r);
    else groups.set(k, { list: [r] });
  }
  const out: QueueGroup[] = [];
  for (const [key, { list }] of groups) {
    const sorted = [...list].sort((a, b) => at(b.createdAt) - at(a.createdAt) || (a.id < b.id ? 1 : -1));
    const latest = sorted[0];
    const tally = new Map<QueueReport["reason"], number>();
    for (const r of sorted) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
    out.push({
      key,
      kind: latest.kind,
      targetKind: latest.targetKind,
      targetId: latest.targetId,
      count: sorted.length,
      reasons: [...tally].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
      latest,
      firstAt: sorted[sorted.length - 1].createdAt,
      targetLabel: latest.targetLabel,
      videoId: latest.videoId,
      channel: latest.channel,
      ownerBanned: latest.ownerBanned,
      ownerAdmin: latest.ownerAdmin,
      removed: latest.removed,
      gone: latest.gone,
    });
  }
  return out.sort(
    (a, b) =>
      Number(b.kind === "appeal") - Number(a.kind === "appeal") ||
      b.count - a.count ||
      at(b.latest.createdAt) - at(a.latest.createdAt) ||
      a.key.localeCompare(b.key),
  );
}

/** Which actions the queue offers for a group. */
export function groupActions(g: Pick<QueueGroup, "kind" | "targetKind" | "removed" | "gone" | "ownerAdmin" | "ownerBanned" | "channel">): string[] {
  if (g.gone) return ["dismiss"];
  if (g.kind === "appeal") return g.removed ? ["restore", "dismiss"] : ["dismiss"];
  const out = ["dismiss"];
  if ((g.targetKind === "video" || g.targetKind === "comment") && !g.removed) out.push("remove");
  if (!g.ownerAdmin) {
    out.push("strike");
    out.push(g.channel?.suspended ? "unsuspend" : "suspend");
    out.push(g.ownerBanned ? "unban" : "ban");
  }
  return out;
}

/** The admin_reports row reader. */
export function rowToReport(r: Record<string, unknown>): QueueReport {
  const kind = r.kind === "appeal" ? "appeal" : "report";
  const tk = r.target_kind === "comment" || r.target_kind === "channel" ? r.target_kind : "video";
  return {
    id: String(r.id),
    kind,
    targetKind: tk,
    targetId: String(r.target_id),
    reason: String(r.reason ?? "other") as QueueReport["reason"],
    details: String(r.details ?? ""),
    createdAt: String(r.created_at ?? new Date(0).toISOString()),
    reporterName: String(r.reporter_name ?? "someone"),
    targetLabel: (r.target_label as string | null) ?? null,
    videoId: (r.video_id as string | null) ?? null,
    channel: r.channel_id
      ? {
          id: String(r.channel_id),
          handle: String(r.channel_handle ?? ""),
          name: String(r.channel_name ?? r.channel_handle ?? ""),
          suspended: r.channel_suspended === true,
          strikes: Number(r.channel_strikes ?? 0) || 0,
        }
      : null,
    ownerBanned: r.owner_banned === true,
    ownerAdmin: r.owner_admin === true,
    removed: r.target_removed === true,
    gone: r.target_gone === true,
  };
}
