import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { decodeCursor, encodeCursor } from "./cursor";
import { TRENDING_COUNT } from "./score";
import { rowToCard, type FeedCard, type FeedKind, type FeedPage, type FeedRow } from "./types";

/** The public bucket domain, when set (see the Watch page section of the README). */
function mediaPublicBase(): string | null {
  return readPublicBase(process.env.MEDIA_PUBLIC_URL);
}

/** Cards per page on the home grid and the channel Videos tab. */
export const FEED_PAGE_SIZE = 24;

export type FeedState =
  /** The feed flag is off: the pages keep their placeholders. */
  | { kind: "off" }
  | { kind: "no-db" }
  /** feed_videos() is not there yet: migration 008 not applied. */
  | { kind: "not-set-up" }
  /** `now` is when the page was read, so "3 days ago" is the same on the server and in the browser. */
  | { kind: "ready"; page: FeedPage; now: number };

function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883";
}

/** Is the feed on for the person making this request? Reads the request. */
export async function feedGate(): Promise<"no-db" | "off" | "on"> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  return (await flagOn("feed", user?.id ?? null)) ? "on" : "off";
}

/**
 * One page of the feed. `cursor` comes from the previous page's `next`.
 * Trending has one page, the top 50. Call inside <Suspense>: it reads the request.
 */
export async function feedState(
  kind: FeedKind,
  opts: { cursor?: string | null; channelId?: string | null; limit?: number } = {},
): Promise<FeedState> {
  const gate = await feedGate();
  if (gate !== "on") return { kind: gate };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  const limit = kind === "trending" ? TRENDING_COUNT : Math.min(Math.max(opts.limit ?? FEED_PAGE_SIZE, 1), 50);
  const cursor = kind === "trending" ? null : decodeCursor(opts.cursor);
  if (opts.cursor && kind !== "trending" && !cursor) return { kind: "ready", page: { cards: [], next: null }, now: Date.now() };
  const forChannel = kind === "channel" || kind === "channel_shorts";
  if (forChannel && !opts.channelId) return { kind: "ready", page: { cards: [], next: null }, now: Date.now() };

  // With the shorts flag on (feature 11, migration 013) shorts have their own
  // shelf and tab, so the home grid and the Videos tab leave them out.
  const shortsOn = await flagOn("shorts", (await getCurrentUser())?.id ?? null);
  if (kind === "channel_shorts" && !shortsOn) return { kind: "ready", page: { cards: [], next: null }, now: Date.now() };
  const { data, error } = await supabase.rpc("feed_videos", {
    kind,
    cursor: cursor?.publishedAt ?? null,
    cursor_id: cursor?.id ?? null,
    lim: limit,
    for_channel: forChannel ? opts.channelId : null,
    ...(shortsOn && (kind === "newest" || kind === "channel") ? { exclude_shorts: true } : {}),
  });
  if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : { kind: "ready", page: { cards: [], next: null }, now: Date.now() };

  const rows = (Array.isArray(data) ? data : []) as FeedRow[];
  const publicBase = mediaPublicBase();
  const cards = rows.map((r) => rowToCard(r, publicBase));
  const last = rows[rows.length - 1];
  const next =
    kind !== "trending" && last && rows.length === limit ? encodeCursor({ publishedAt: last.published_at, id: last.id }) : null;
  return { kind: "ready", page: { cards, next }, now: Date.now() };
}

/**
 * Up next for the watch page: same channel first, then the newest. null when
 * related_videos() is not there yet, so the caller can fall back.
 */
export async function relatedCards(videoId: string, limit = 12): Promise<FeedCard[] | null> {
  const supabase = await createClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("related_videos", { video_id: videoId, lim: limit });
  if (error) return null;
  const publicBase = mediaPublicBase();
  return ((Array.isArray(data) ? data : []) as FeedRow[]).map((r) => rowToCard(r, publicBase));
}
