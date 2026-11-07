import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { CHANNEL_COLUMNS, rowToChannel, type Channel } from "./types";
import { handleProblem, normalizeHandle } from "./validation";

export type ChannelState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "missing" }
  /** The channels table could not be read (migration 004 not applied yet). */
  | { kind: "not-set-up" }
  | { kind: "ready"; channel: Channel; isOwner: boolean; user: CurrentUser | null };

async function channelsGate(): Promise<"no-db" | "off" | { user: CurrentUser | null }> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  if (!(await flagOn("channels", user?.id ?? null))) return "off";
  return { user };
}

/** A URL segment like "antic" or "%40antic" turned into a handle, or null when it cannot be one. */
export function handleFromSegment(segment: string): string | null {
  let raw = segment;
  try {
    raw = decodeURIComponent(segment);
  } catch {
    return null;
  }
  const handle = normalizeHandle(raw);
  return handleProblem(handle) === null ? handle : null;
}

/**
 * What /@handle should show for this request. Reads the request, so call it
 * inside a <Suspense> boundary.
 */
// cache: generateMetadata and the page read the same channel once per request.
export const channelByHandle = cache(async function channelByHandle(segment: string): Promise<ChannelState> {
  const gate = await channelsGate();
  if (gate === "no-db" || gate === "off") return { kind: gate };
  const handle = handleFromSegment(segment);
  if (!handle) return { kind: "missing" };

  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase
    .from("channels")
    .select(CHANNEL_COLUMNS)
    .eq("handle", handle)
    .maybeSingle();
  if (error) return { kind: "not-set-up" };
  if (!data) return { kind: "missing" };
  const channel = rowToChannel(data);
  return { kind: "ready", channel, isOwner: gate.user?.id === channel.ownerId, user: gate.user };
});

/** The handle for a channel id, for the /channel/[id] redirect. */
export async function handleForChannelId(id: string): Promise<ChannelState | { kind: "handle"; handle: string }> {
  const gate = await channelsGate();
  if (gate === "no-db" || gate === "off") return { kind: gate };
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { kind: "missing" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.from("channels").select("handle").eq("id", id).maybeSingle();
  if (error) return { kind: "not-set-up" };
  if (!data) return { kind: "missing" };
  return { kind: "handle", handle: data.handle };
}

export type StudioState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "signed-out" }
  | { kind: "not-set-up" }
  | { kind: "ready"; channel: Channel; user: CurrentUser };

/** What /studio/channel should show. Call inside a <Suspense> boundary. */
export async function myChannel(): Promise<StudioState> {
  const gate = await channelsGate();
  if (gate === "no-db" || gate === "off") return { kind: gate };
  const user = gate.user;
  if (!user) return { kind: "signed-out" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.from("channels").select(CHANNEL_COLUMNS).eq("owner_id", user.id).maybeSingle();
  if (error || !data) return { kind: "not-set-up" };
  return { kind: "ready", channel: rowToChannel(data), user };
}
