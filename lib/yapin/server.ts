import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { cleanOrigin } from "@/lib/seo/meta";
import { originOf } from "@/lib/studio/http";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { mediaPublicBase, rowToVideo, type WatchRow } from "@/lib/watch/server";
import type { WatchVideo } from "@/lib/watch/types";
import { readYapinConfig, type YapinConfig } from "./env";
import { CALLBACK_PATH } from "./oauth";

type Db = SupabaseClient;

/** This site's address for the redirect URI: SITE_URL when set (it must match what is registered at yapin.gg), else the request's. */
export function yapinOrigin(request: Request): string {
  return cleanOrigin(process.env["SITE_URL"]) ?? originOf(request) ?? new URL(request.url).origin;
}

export const redirectUriFor = (request: Request) => `${yapinOrigin(request)}${CALLBACK_PATH}`;

/**
 * Sign in with Yapin' for this person: the flag on and the Yapin' app and the
 * service role key set on the server. Null when it is not available.
 */
export async function yapinSignIn(userId?: string | null): Promise<YapinConfig | null> {
  await connection();
  if (!readSupabaseConfig()) return null;
  const config = readYapinConfig();
  if (!config) return null;
  return (await flagOn("yapin", userId)) ? config : null;
}

/** The yapin flag for the person making the request (Share to Yapin', the studio card). */
export async function yapinOn(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return false;
  return flagOn("yapin");
}

/** A client with the service role key. Only the Yapin' routes use it, never for anything the browser sends as is. */
export function serviceClient(config: YapinConfig): Db | null {
  const supabase = readSupabaseConfig();
  if (!supabase) return null;
  return createSupabaseClient(supabase.url, config.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** The P0001 code from an RPC error, or a general one. */
export function rpcCode(error: { code?: string; message?: string } | null): string {
  if (!error) return "failed";
  if (error.code === "PGRST202" || error.code === "42883") return "not_set_up";
  if (error.code === "P0001" && error.message) return error.message;
  return "failed";
}

// Settings > Connections --------------------------------------------------------------

export type ConnectionState =
  /** Hidden: the flag is off or the Yapin' app is not set on the server. */
  | { kind: "off" }
  /** needsEmail: only a placeholder address, so Unlink is refused (Yapin' is the only way in). */
  | { kind: "ready"; linked: boolean; username: string | null; needsEmail: boolean }
  | { kind: "error"; code: string };

export async function connectionState(): Promise<ConnectionState> {
  const user = await getCurrentUser();
  if (!user || !(await yapinSignIn(user.id))) return { kind: "off" };
  const supabase = await createClient();
  if (!supabase) return { kind: "off" };
  const { data, error } = await supabase.rpc("yapin_status");
  if (error) return { kind: "error", code: rpcCode(error) };
  const row = (Array.isArray(data) ? data[0] : data) as { linked?: boolean; yapin_username?: string | null; needs_email?: boolean } | null;
  return { kind: "ready", linked: row?.linked === true, username: row?.yapin_username ?? null, needsEmail: row?.needs_email === true || user.emailPlaceholder };
}

export async function unlinkYapin(): Promise<{ ok: true } | { error: string }> {
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await yapinSignIn(user.id))) return { error: "yapin_off" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { error } = await supabase.rpc("unlink_yapin");
  return error ? { error: rpcCode(error) } : { ok: true };
}

// Studio: announcements -------------------------------------------------------------------

export type YapinPost = {
  id: string;
  videoId: string;
  title: string;
  status: "queued" | "sending" | "sent" | "failed";
  attempts: number;
  error: string | null;
  queuedAt: string;
  finishedAt: string | null;
};

export type Announcements = { connected: boolean; hint: string | null; posts: YapinPost[] };

type PostRow = {
  id: string | null;
  video_id: string | null;
  title: string | null;
  status: YapinPost["status"] | null;
  attempts: number | null;
  error: string | null;
  queued_at: string | null;
  finished_at: string | null;
  connected: boolean | null;
  url_hint: string | null;
};

export function toAnnouncements(rows: PostRow[]): Announcements {
  const first = rows[0];
  return {
    connected: first?.connected === true,
    hint: first?.url_hint ?? null,
    posts: rows
      .filter((r) => r.id && r.video_id && r.status)
      .map((r) => ({
        id: r.id!,
        videoId: r.video_id!,
        title: r.title ?? "",
        status: r.status!,
        attempts: Number(r.attempts) || 0,
        error: r.error,
        queuedAt: r.queued_at ?? "",
        finishedAt: r.finished_at,
      })),
  };
}

async function studioCaller(): Promise<{ supabase: Db } | { error: string }> {
  await connection();
  if (!readSupabaseConfig()) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!user) return { error: "not_signed_in" };
  if (!(await flagOn("yapin", user.id))) return { error: "yapin_off" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  return { supabase };
}

export async function announcements(): Promise<Announcements | { error: string }> {
  const c = await studioCaller();
  if ("error" in c) return c;
  const { data, error } = await c.supabase.rpc("list_yapin_posts", { lim: 50 });
  if (error) return { error: rpcCode(error) };
  return toAnnouncements((data ?? []) as PostRow[]);
}

export async function setWebhook(url: string): Promise<{ connected: boolean; hint: string | null } | { error: string }> {
  const c = await studioCaller();
  if ("error" in c) return c;
  const { data, error } = await c.supabase.rpc("set_yapin_webhook", { url });
  if (error) return { error: rpcCode(error) };
  const hint = typeof data === "string" ? data : null;
  return { connected: hint !== null, hint };
}

// /embed/<id> ---------------------------------------------------------------------------------

export type EmbedState =
  | { kind: "off" }
  | { kind: "no-db" }
  | { kind: "missing" }
  | { kind: "ready"; video: WatchVideo };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The player only page. Answers for public and unlisted videos that are ready,
 * with the watch and yapin flags on for a signed out visitor (link previews
 * are fetched signed out, and a framed page has no cookies).
 */
export async function embedState(id: string): Promise<EmbedState> {
  await connection();
  const config = readSupabaseConfig();
  if (!config) return { kind: "no-db" };
  const [watchOn, yapin] = await Promise.all([flagOn("watch", null), flagOn("yapin", null)]);
  if (!watchOn || !yapin) return { kind: "off" };
  if (!UUID.test(id)) return { kind: "missing" };
  const anon = createSupabaseClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await anon.rpc("watch_video", { video_id: id.toLowerCase() });
  const row = (!error && Array.isArray(data) ? data[0] : null) as WatchRow | null;
  if (!row || row.status !== "ready" || row.visibility === "private") return { kind: "missing" };
  const video = rowToVideo(row, mediaPublicBase());
  return video.src ? { kind: "ready", video } : { kind: "missing" };
}
