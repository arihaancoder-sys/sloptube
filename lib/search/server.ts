import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { decodeSearchCursor, encodeSearchCursor } from "./cursor";
import { filtersToSql, showsChannels, showsVideos, type SearchFilters } from "./query";
import { CHANNELS_ONLY, CHANNELS_ON_TOP, SEARCH_PAGE_SIZE, SUGGEST_LIMIT } from "./rules";
import { dedupeSuggestions } from "./suggest";
import {
  rowToSearchChannel,
  rowToSearchVideo,
  type SearchChannel,
  type SearchChannelRow,
  type SearchPage,
  type SearchVideoRow,
} from "./types";

export type SearchGate = "no-db" | "off" | "on";

/** Is search on for the person making this request? Reads the request. */
export async function searchGate(): Promise<SearchGate> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  return (await flagOn("search", user?.id ?? null)) ? "on" : "off";
}

/** Database codes for "the function is not there": migration 010 not applied. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883";
}

type Problem = "not-set-up" | "rate-limited" | "failed";

function problemOf(error: { code?: string; message?: string }): Problem {
  if (notSetUp(error.code)) return "not-set-up";
  if ((error.message ?? "").trim() === "rate_limited") return "rate-limited";
  return "failed";
}

/**
 * The visitor's address as the reverse proxy in front of the app saw it
 * (Caddy sets X-Forwarded-For). The database counts signed out searches per
 * address with it. Never stored anywhere else.
 */
async function clientAddress(): Promise<string | null> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  return first && first.length <= 64 && /^[0-9a-fA-F:.]+$/.test(first) ? first : null;
}

async function searchClient() {
  const address = await clientAddress();
  return createClient(address ? { headers: { "x-search-client": address } } : {});
}

export type VideosState =
  | { kind: "off" | "no-db" | Problem }
  | { kind: "ready"; page: SearchPage };

/** One page of video results. `cursor` comes from the previous page's `next`. */
export async function searchVideos(q: string, filters: SearchFilters, cursor: string | null = null): Promise<VideosState> {
  const gate = await searchGate();
  if (gate !== "on") return { kind: gate };
  const empty = { kind: "ready" as const, page: { videos: [], next: null } };
  if (!q || !showsVideos(filters)) return empty;
  const after = decodeSearchCursor(cursor);
  if (cursor && !after) return empty;
  const supabase = await searchClient();
  if (!supabase) return { kind: "no-db" };

  const { data, error } = await supabase.rpc("search_videos", {
    q,
    cursor_rank: after?.key ?? null,
    cursor_id: after?.id ?? null,
    lim: SEARCH_PAGE_SIZE,
    filters: filtersToSql(filters),
  });
  if (error) return { kind: problemOf(error) };

  const rows = (Array.isArray(data) ? data : []) as SearchVideoRow[];
  const publicBase = readPublicBase(process.env.MEDIA_PUBLIC_URL);
  const last = rows[rows.length - 1];
  return {
    kind: "ready",
    page: {
      videos: rows.map((r) => rowToSearchVideo(r, publicBase)),
      next: last && rows.length === SEARCH_PAGE_SIZE ? encodeSearchCursor({ key: Number(last.sort_key), id: last.id }) : null,
    },
  };
}

export type ResultsState =
  | { kind: "off" | "no-db" | "empty-query" | Problem }
  | { kind: "ready"; page: SearchPage; channels: SearchChannel[]; now: number };

/** The first page of /results: channel rows (when they fit the filters) and videos. */
export async function searchResults(q: string, filters: SearchFilters): Promise<ResultsState> {
  const gate = await searchGate();
  if (gate !== "on") return { kind: gate };
  if (!q) return { kind: "empty-query" };
  const supabase = await searchClient();
  if (!supabase) return { kind: "no-db" };

  const channelCall = showsChannels(filters)
    ? supabase.rpc("search_channels", { q, lim: filters.type === "channel" ? CHANNELS_ONLY : CHANNELS_ON_TOP })
    : null;
  const [videos, channels] = await Promise.all([searchVideos(q, filters), channelCall]);
  if (videos.kind !== "ready") return { kind: videos.kind };
  if (channels?.error) {
    const problem = problemOf(channels.error);
    if (problem !== "failed") return { kind: problem };
  }
  const rows = (channels && Array.isArray(channels.data) ? channels.data : []) as SearchChannelRow[];
  return { kind: "ready", page: videos.page, channels: rows.map(rowToSearchChannel), now: Date.now() };
}

export type SuggestState = { kind: "off" | "no-db" | Problem } | { kind: "ready"; suggestions: string[] };

/** Up to ten suggestions for what is typed so far. */
export async function searchSuggest(q: string): Promise<SuggestState> {
  const gate = await searchGate();
  if (gate !== "on") return { kind: gate };
  if (!q) return { kind: "ready", suggestions: [] };
  const supabase = await searchClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.rpc("search_suggest", { q, lim: SUGGEST_LIMIT });
  if (error) return { kind: problemOf(error) };
  const list = (Array.isArray(data) ? data : []).map((r: { suggestion?: unknown }) => r?.suggestion);
  return { kind: "ready", suggestions: dedupeSuggestions(list) };
}
