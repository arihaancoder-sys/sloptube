// What the engagement routes and pages hand to the browser. Everything here
// is safe to show: no keys, no viewer ids. Only relative imports, so Node
// can load this file directly.

import { rowToCard, type FeedCard, type FeedRow } from "../feed/types.ts";
import { progressFraction, type Reaction } from "./rules.ts";

/** The watch page's likes and resume point for this viewer. */
export type WatchEngagement = {
  likes: number;
  /** Only for the owner. */
  dislikes: number | null;
  reaction: Reaction | null;
  /** The saved position for a signed in viewer, or null (then the browser's own is used). */
  positionS: number | null;
  durationS: number | null;
  signedIn: boolean;
};

/** A row from video_engagement(). */
export type EngagementRow = {
  like_count: number | string | null;
  dislike_count: number | string | null;
  my_reaction: string | null;
  position_s: number | string | null;
  duration_s: number | string | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowToEngagement(row: EngagementRow | null, signedIn: boolean): WatchEngagement {
  const reaction = row?.my_reaction === "like" || row?.my_reaction === "dislike" ? row.my_reaction : null;
  return {
    likes: num(row?.like_count) ?? 0,
    dislikes: num(row?.dislike_count),
    reaction,
    positionS: signedIn ? num(row?.position_s) : null,
    durationS: num(row?.duration_s),
    signedIn,
  };
}

/** A video on the history page: a feed card plus where it was left. */
export type HistoryCard = FeedCard & {
  description: string;
  positionS: number;
  /** 0 to 1, for the red bar. */
  progress: number;
  watchedAt: string;
};

export type HistoryPage = { cards: HistoryCard[]; next: string | null };

/** A row from my_history(). */
export type HistoryRow = FeedRow & {
  description: string | null;
  position_s: number | string | null;
  progress: number | string | null;
  watched_at: string;
};

export function rowToHistoryCard(row: HistoryRow, publicBase: string | null): HistoryCard {
  const card = rowToCard(row, publicBase);
  const positionS = num(row.position_s) ?? 0;
  const progress = num(row.progress) ?? progressFraction(positionS, card.durationS);
  return {
    ...card,
    description: row.description ?? "",
    positionS,
    progress: Math.min(1, Math.max(0, progress)),
    watchedAt: row.watched_at,
  };
}

/** A row from my_progress(). */
export type ProgressRow = { video_id: string; position_s: number | string | null; duration_s: number | string | null };

/** id to fraction, for every id asked about (0 when there is no history). */
export function progressMap(ids: string[], rows: ProgressRow[]): Record<string, number> {
  const out: Record<string, number> = Object.fromEntries(ids.map((id) => [id, 0]));
  for (const r of rows) out[r.video_id] = progressFraction(num(r.position_s), num(r.duration_s));
  return out;
}

/** What the reaction route answers. */
export type ReactionResult = { reaction: Reaction | null; likes: number; dislikes: number | null };

/** What the ping route answers. */
export type PingResult = { counted: boolean; views: number };
