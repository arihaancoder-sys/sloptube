import "server-only";
import { cookies, headers } from "next/headers";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { engagementErrorCode, HISTORY_PAGE_SIZE, PROGRESS_BATCH, type Reaction } from "./rules";
import {
  progressMap,
  rowToEngagement,
  rowToHistoryCard,
  type EngagementRow,
  type HistoryPage,
  type HistoryRow,
  type PingResult,
  type ProgressRow,
  type ReactionResult,
  type WatchEngagement,
} from "./types";
import { hashViewerCookie, isViewerCookie, newViewerCookie, VIEWER_COOKIE, VIEWER_COOKIE_MAX_AGE } from "./viewer-key";

type Gate = "no-db" | "off" | { userId: string | null };

/** Database codes for "the function or table is not there": migration 011 not applied. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : engagementErrorCode(error.message);
}

/**
 * Is the engagement flag on, and who is asking? Reads the request, so call
 * it inside <Suspense> or a route.
 */
export async function engagementGate(): Promise<Gate> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  if (!(await flagOn("engagement", user?.id ?? null))) return "off";
  return { userId: user?.id ?? null };
}

/**
 * The watch page's likes and saved position, or null when the flag is off
 * or the function is not there yet (the buttons then stay placeholders).
 */
export async function engagementFor(videoId: string): Promise<WatchEngagement | null> {
  const gate = await engagementGate();
  if (typeof gate === "string") return null;
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("video_engagement", { video_id: videoId });
  if (error) return null;
  const row = (Array.isArray(data) ? data[0] : null) as EngagementRow | null;
  return rowToEngagement(row, gate.userId !== null);
}

/** Like, dislike or clear (null). Answers the new state or an error code. */
export async function react(videoId: string, kind: Reaction | null): Promise<ReactionResult | { error: string }> {
  const gate = await engagementGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "engagement_off" };
  if (!gate.userId) return { error: "not_signed_in" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("react", { video_id: videoId, kind });
  if (error) return { error: codeOf(error) };
  const row = (Array.isArray(data) ? data[0] : null) as { reaction: string | null; like_count: number | string; dislike_count: number | string | null } | null;
  if (!row) return { error: "not_found" };
  return {
    reaction: row.reaction === "like" || row.reaction === "dislike" ? row.reaction : null,
    likes: Number(row.like_count) || 0,
    dislikes: row.dislike_count === null ? null : Number(row.dislike_count) || 0,
  };
}

/**
 * The anonymous viewer's key: the 'sv' cookie, made here when it is missing
 * or broken (route handlers only, where cookies can be set). Answers the
 * hash that goes to the database, never the cookie itself.
 */
async function viewerKey(): Promise<string> {
  const store = await cookies();
  let value = store.get(VIEWER_COOKIE)?.value;
  if (!isViewerCookie(value)) {
    value = newViewerCookie();
    const h = await headers();
    const https = h.get("x-forwarded-proto") === "https" || process.env.NODE_ENV === "production";
    store.set(VIEWER_COOKIE, value, {
      httpOnly: true,
      sameSite: "lax",
      secure: https,
      maxAge: VIEWER_COOKIE_MAX_AGE,
      path: "/",
    });
  }
  return hashViewerCookie(value);
}

/** One ping from the player. Signed out viewers are counted by the 'sv' cookie. */
export async function ping(videoId: string, positionS: number, playedS: number, source: string | null = null): Promise<PingResult | { error: string }> {
  const gate = await engagementGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "engagement_off" };
  const key = await viewerKey();
  const supabase = await createClient({ headers: { "x-viewer-key": key } });
  if (!supabase) return { error: "no_db" };
  const args = { video_id: videoId, position_s: positionS, played_s: playedS };
  // source needs migration 015; before it, the three argument call still counts the view.
  let { data, error } = await supabase.rpc("watch_ping", source ? { ...args, source } : args);
  if (error && source && (error.code === "PGRST202" || error.code === "42883")) ({ data, error } = await supabase.rpc("watch_ping", args));
  if (error) return { error: codeOf(error) };
  const row = (Array.isArray(data) ? data[0] : null) as { counted: boolean; views: number | string } | null;
  return { counted: row?.counted === true, views: Number(row?.views) || 0 };
}

export type HistoryState =
  | { kind: "off" | "no-db" | "signed-out" | "not-set-up" }
  | { kind: "ready"; page: HistoryPage; paused: boolean; now: number };

/** One page of the signed in person's history. `cursor` is the last page's `next`. */
export async function historyPage(cursor: string | null = null): Promise<HistoryState> {
  const gate = await engagementGate();
  if (typeof gate === "string") return { kind: gate };
  if (!gate.userId) return { kind: "signed-out" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  const now = Date.now();
  const after = decodeCursor(cursor);
  if (cursor && !after) return { kind: "ready", page: { cards: [], next: null }, paused: false, now };
  const [list, paused] = await Promise.all([
    supabase.rpc("my_history", { cursor: after?.publishedAt ?? null, cursor_id: after?.id ?? null, lim: HISTORY_PAGE_SIZE }),
    cursor ? Promise.resolve({ data: false, error: null }) : supabase.rpc("history_paused"),
  ]);
  if (list.error) return notSetUp(list.error.code) ? { kind: "not-set-up" } : { kind: "ready", page: { cards: [], next: null }, paused: false, now };

  const rows = (Array.isArray(list.data) ? list.data : []) as HistoryRow[];
  const publicBase = readPublicBase(process.env.MEDIA_PUBLIC_URL);
  const last = rows[rows.length - 1];
  return {
    kind: "ready",
    page: {
      cards: rows.map((r) => rowToHistoryCard(r, publicBase)),
      next: last && rows.length === HISTORY_PAGE_SIZE ? encodeCursor({ publishedAt: last.watched_at, id: last.id }) : null,
    },
    paused: paused.data === true,
    now,
  };
}

type Change = { kind: "clear" } | { kind: "remove"; videoId: string } | { kind: "pause"; on: boolean };

/** Clear all, remove one, or pause. These work with the flag off too, so people can always clean up. */
export async function changeHistory(change: Change): Promise<{ ok: true; paused?: boolean } | { error: string }> {
  await connection();
  if (!readSupabaseConfig()) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const call =
    change.kind === "clear"
      ? supabase.rpc("clear_history")
      : change.kind === "remove"
        ? supabase.rpc("remove_from_history", { video_id: change.videoId })
        : supabase.rpc("set_history_paused", { on: change.on });
  const { data, error } = await call;
  if (error) return { error: codeOf(error) };
  return change.kind === "pause" ? { ok: true, paused: data === true } : { ok: true };
}

/** id to fraction watched, for the red bars under the thumbnails on a page. */
export async function progressFor(ids: string[]): Promise<Record<string, number> | { error: string }> {
  const gate = await engagementGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "engagement_off" };
  if (!gate.userId) return {};
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const some = ids.slice(0, PROGRESS_BATCH);
  const { data, error } = await supabase.rpc("my_progress", { video_ids: some });
  if (error) return { error: codeOf(error) };
  return progressMap(some, (Array.isArray(data) ? data : []) as ProgressRow[]);
}
