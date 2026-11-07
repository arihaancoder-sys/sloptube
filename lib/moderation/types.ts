// Rows of the admin RPCs as the pages use them. Only relative imports, so
// Node can load this file directly.

export type LogEntry = {
  id: string;
  createdAt: string;
  action: string;
  targetKind: string;
  targetId: string | null;
  targetLabel: string;
  reason: string;
  actorName: string;
};

export type SuspendedChannel = {
  id: string;
  handle: string;
  name: string;
  suspendedAt: string;
  reason: string;
  strikes: number;
  banned: boolean;
};

export type Word = { word: string; createdAt: string; addedBy: string };

export function rowToLog(r: Record<string, unknown>): LogEntry {
  return {
    id: String(r.id),
    createdAt: String(r.created_at ?? new Date(0).toISOString()),
    action: String(r.action ?? ""),
    targetKind: String(r.target_kind ?? ""),
    targetId: (r.target_id as string | null) ?? null,
    targetLabel: String(r.target_label ?? ""),
    reason: String(r.reason ?? ""),
    actorName: String(r.actor_name ?? ""),
  };
}

export function rowToSuspended(r: Record<string, unknown>): SuspendedChannel {
  return {
    id: String(r.channel_id),
    handle: String(r.handle ?? ""),
    name: String(r.name ?? r.handle ?? ""),
    suspendedAt: String(r.suspended_at ?? new Date(0).toISOString()),
    reason: String(r.reason ?? ""),
    strikes: Number(r.strikes ?? 0) || 0,
    banned: r.banned === true,
  };
}

export function rowToWord(r: Record<string, unknown>): Word {
  return { word: String(r.word ?? ""), createdAt: String(r.created_at ?? ""), addedBy: String(r.added_by ?? "") };
}
