import "server-only";
import { connection } from "next/server";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { studioGate, thumbnailLink } from "@/lib/studio/server";
import { previewChannel, previewRealtime, previewVideo } from "./preview";
import type { HourPoint, Range } from "./rules";
import { statsErrorCode } from "./rules";
import { readChannelAnalytics, readRealtime, readVideoAnalytics, type ChannelAnalytics, type VideoAnalytics } from "./types";

type Db = Exclude<Awaited<ReturnType<typeof studioGate>>, string>["supabase"];
type Fail = { error: string };

/** "The function is not there": migration 015 not applied yet. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01" || code === "42703";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : statsErrorCode(error.message);
}

/** No database: a preview in `next dev`, else the notice. */
const noDb = () => process.env.NODE_ENV === "development";

/** The studio and the stats flag, for the nav and the links. Reads the request. */
export async function statsOn(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return noDb();
  const [studio, stats] = await Promise.all([flagOn("studio"), flagOn("stats")]);
  return studio && stats;
}

type StatsGate = "no-db" | "off" | "stats-off" | "signed-out" | { userId: string; supabase: Db };

/** The studio first (its own coming soon page), then the stats flag. */
async function statsGate(): Promise<StatsGate> {
  const gate = await studioGate();
  if (typeof gate === "string") return gate;
  if (!(await flagOn("stats", gate.user.id))) return "stats-off";
  return { userId: gate.user.id, supabase: gate.supabase };
}

/** The thumbnail links worked out ahead, since the readers take a sync function. */
async function links(rows: Record<string, unknown>[]) {
  const map = new Map<string, string | null>();
  await Promise.all(
    rows
      .filter((r) => r.status === "ready")
      .map(async (r) => map.set(String(r.id), await thumbnailLink(String(r.id), (r.thumbnail_name as string) ?? null, (r.thumbnail_url as string) ?? null))),
  );
  return (id: string) => map.get(id) ?? null;
}

type Simple = "off" | "stats-off" | "signed-out" | "not-set-up" | "no-db";
const simple = (code: string): { kind: Simple } | { kind: "error"; code: string } =>
  code === "not_set_up" ? { kind: "not-set-up" } : code === "stats_off" ? { kind: "stats-off" } : code === "studio_off" ? { kind: "off" } : { kind: "error", code };

export type ChannelState =
  | { kind: Simple }
  | { kind: "error"; code: string }
  | { kind: "ready"; data: ChannelAnalytics; realtime: HourPoint[]; preview?: boolean };

async function realtimeRows(supabase: Db, videoId: string | null): Promise<HourPoint[] | Fail> {
  const { data, error } = await supabase.rpc("realtime_views", { video_id: videoId });
  return error ? { error: codeOf(error) } : readRealtime(data);
}

/** /studio/analytics: the channel for a range, and the last 48 hours. */
export async function channelAnalytics(range: Range): Promise<ChannelState> {
  const gate = await statsGate();
  if (gate === "no-db") return noDb() ? { kind: "ready", data: previewChannel(range), realtime: previewRealtime(), preview: true } : { kind: "no-db" };
  if (typeof gate === "string") return { kind: gate };
  const { data, error } = await gate.supabase.rpc("studio_analytics", { range });
  if (error) return simple(codeOf(error));
  const raw = (data ?? {}) as Record<string, unknown>;
  const top = (Array.isArray(raw.top) ? raw.top : []) as Record<string, unknown>[];
  const realtime = await realtimeRows(gate.supabase, null);
  if ("error" in realtime) return simple(realtime.error);
  return { kind: "ready", data: readChannelAnalytics(raw, await links(top)), realtime };
}

export type VideoState =
  | { kind: Simple | "missing" }
  | { kind: "error"; code: string }
  | { kind: "ready"; data: VideoAnalytics; realtime: HourPoint[]; preview?: boolean };

/** /studio/video/<id>/analytics: one of the caller's videos. */
export async function videoAnalytics(videoId: string, range: Range): Promise<VideoState> {
  const gate = await statsGate();
  if (gate === "no-db") {
    return noDb() ? { kind: "ready", data: previewVideo(videoId, range), realtime: previewRealtime(), preview: true } : { kind: "no-db" };
  }
  if (typeof gate === "string") return { kind: gate };
  const { data, error } = await gate.supabase.rpc("video_analytics", { video_id: videoId, range });
  if (error) {
    const code = codeOf(error);
    return code === "not_found" || code === "not_allowed" ? { kind: "missing" } : simple(code);
  }
  const raw = (data ?? {}) as Record<string, unknown>;
  const video = (raw.video ?? {}) as Record<string, unknown>;
  const realtime = await realtimeRows(gate.supabase, videoId);
  if ("error" in realtime) return simple(realtime.error);
  return { kind: "ready", data: readVideoAnalytics(raw, await links([video])), realtime };
}

// The JSON routes -------------------------------------------------------------------------------

/** What a route answers when the page's state is not "ready". */
function routeError(gate: Exclude<StatsGate, { userId: string }>): Fail {
  switch (gate) {
    case "no-db":
      return { error: "no_db" };
    case "off":
      return { error: "studio_off" };
    case "stats-off":
      return { error: "stats_off" };
    case "signed-out":
      return { error: "not_signed_in" };
  }
}

export async function channelJson(range: Range): Promise<ChannelAnalytics | Fail> {
  const gate = await statsGate();
  if (typeof gate === "string") return routeError(gate);
  const { data, error } = await gate.supabase.rpc("studio_analytics", { range });
  if (error) return { error: codeOf(error) };
  const raw = (data ?? {}) as Record<string, unknown>;
  return readChannelAnalytics(raw, await links((Array.isArray(raw.top) ? raw.top : []) as Record<string, unknown>[]));
}

export async function videoJson(videoId: string, range: Range): Promise<VideoAnalytics | Fail> {
  const gate = await statsGate();
  if (typeof gate === "string") return routeError(gate);
  const { data, error } = await gate.supabase.rpc("video_analytics", { video_id: videoId, range });
  if (error) return { error: codeOf(error) };
  const raw = (data ?? {}) as Record<string, unknown>;
  return readVideoAnalytics(raw, await links([(raw.video ?? {}) as Record<string, unknown>]));
}

export async function realtimeJson(videoId: string | null): Promise<{ hours: HourPoint[] } | Fail> {
  const gate = await statsGate();
  if (typeof gate === "string") return routeError(gate);
  const rows = await realtimeRows(gate.supabase, videoId);
  return "error" in rows ? rows : { hours: rows };
}
