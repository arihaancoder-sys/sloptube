// Made up rows for /admin in `next dev` without a database, so the pages can
// be seen (and filmed) before anything is set up. No real data.
import type { QueueReport } from "./queue.ts";
import type { LogEntry, SuspendedChannel, Word } from "./types.ts";

const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const ago = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
const channel = { id: id(80), handle: "sample_channel", name: "Sample Channel", suspended: false, strikes: 1 };

function report(n: number, over: Partial<QueueReport>): QueueReport {
  return {
    id: id(n), kind: "report", targetKind: "video", targetId: id(1), reason: "spam", details: "", createdAt: ago(n),
    reporterName: "A viewer", targetLabel: "Free gift cards, click the link", videoId: id(1), channel,
    ownerBanned: false, ownerAdmin: false, removed: false, gone: false, ...over,
  };
}

export function previewQueue(): QueueReport[] {
  return [
    report(11, { reason: "spam", details: "Same link in every video" }),
    report(12, {}),
    report(13, { reason: "other", details: "Misleading title" }),
    report(14, { targetKind: "comment", targetId: id(2), reason: "harassment", targetLabel: "You should quit, nobody watches this", details: "" }),
    report(15, { kind: "appeal", reason: "appeal", targetId: id(3), videoId: id(3), targetLabel: "Kitchen knife skills", details: "It is a cooking video.", removed: true }),
  ];
}

export function previewSuspended(): SuspendedChannel[] {
  return [{ id: id(81), handle: "spam_place", name: "Spam Place", suspendedAt: ago(30), reason: "3 strikes in 90 days", strikes: 3, banned: false }];
}

export function previewLog(): LogEntry[] {
  const e = (n: number, action: string, targetKind: string, targetLabel: string, reason: string): LogEntry => ({
    id: id(40 + n), createdAt: ago(n * 5), action, targetKind, targetId: id(1), targetLabel, reason, actorName: "Admin",
  });
  return [
    e(1, "remove_video", "video", "Free gift cards, click the link", "Spam links"),
    e(2, "strike", "channel", "Spam Place", "Spam links"),
    e(3, "add_word", "word", "giftcard*", ""),
    e(4, "dismiss", "comment", "First!", ""),
  ];
}

export function previewWords(): Word[] {
  return [
    { word: "free gift card", createdAt: ago(50), addedBy: "admin" },
    { word: "giftcard*", createdAt: ago(20), addedBy: "admin" },
  ];
}
