import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { previewOverview, previewRows } from "./preview";
import { deleteObject, headObject, signedGet, signedPut, storageConfigured } from "./storage";
import { readOverview, rowToStudio, type CommentsMode, type Overview, type StudioRow, type Visibility } from "./types";
import {
  BULK_MAX,
  STILLS,
  THUMBNAIL_MAX_BYTES,
  THUMBNAIL_TYPES,
  customThumbnailName,
  isThumbnailName,
  studioErrorCode,
  tagsProblem,
  thumbnailKey,
} from "./rules";

type Fail = { error: string };
type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

const publicBase = () => readPublicBase(process.env.MEDIA_PUBLIC_URL);

/** "The function is not there": migration 014 not applied yet. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01" || code === "42703";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : studioErrorCode(error.message);
}

/**
 * The picture for a video in the studio: the stored public link, else the
 * file straight from MEDIA_PUBLIC_URL, else a signed R2 link (the studio
 * does not depend on the watch flag the way /api/media does).
 */
export async function thumbnailLink(id: string, name: string | null, url: string | null): Promise<string | null> {
  if (url) return url;
  const file = name ?? "thumb-1.webp";
  const base = publicBase();
  if (base) return `${base}/${thumbnailKey(id, file)}`;
  return signedGet(thumbnailKey(id, file));
}

/** rowToStudio and readOverview take a sync function, so the links are worked out first. */
async function withLinks(rows: Record<string, unknown>[]) {
  const links = new Map<string, string | null>();
  await Promise.all(
    rows
      .filter((r) => r && r.status === "ready")
      .map(async (r) => links.set(String(r.id), await thumbnailLink(String(r.id), (r.thumbnail_name as string) ?? null, (r.thumbnail_url as string) ?? null))),
  );
  return (id: string) => links.get(id) ?? null;
}

export type Gate = "no-db" | "off" | "signed-out" | { user: CurrentUser; supabase: Db };

/** Is the studio on for the person asking, and who is it? Reads the request. */
export async function studioGate(): Promise<Gate> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  if (!(await flagOn("studio", user?.id ?? null))) return "off";
  if (!user) return "signed-out";
  const supabase = await createClient();
  if (!supabase) return "no-db";
  return { user, supabase };
}

/** Just the flag, for the layout and the nav. Reads the request. */
export async function studioOn(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return process.env.NODE_ENV === "development";
  const user = await getCurrentUser();
  return flagOn("studio", user?.id ?? null);
}

type Simple = "off" | "signed-out" | "not-set-up";

/** No database: a preview in `next dev`, else the notice. */
const noDb = () => process.env.NODE_ENV === "development";

export type OverviewState = { kind: Simple | "no-db" } | { kind: "ready"; overview: Overview; preview?: boolean };

export async function studioOverview(): Promise<OverviewState> {
  const gate = await studioGate();
  if (gate === "no-db") return noDb() ? { kind: "ready", overview: previewOverview(), preview: true } : { kind: "no-db" };
  if (typeof gate === "string") return { kind: gate };
  const { data, error } = await gate.supabase.rpc("studio_overview");
  if (error) return codeOf(error) === "not_set_up" ? { kind: "not-set-up" } : { kind: "off" };
  const raw = (data ?? null) as Record<string, unknown> | null;
  const latest = raw?.latest as Record<string, unknown> | null;
  const link = await withLinks(latest ? [latest] : []);
  return { kind: "ready", overview: readOverview(raw, link) };
}

export type ContentState =
  | { kind: Simple | "no-db" }
  | { kind: "ready"; rows: StudioRow[]; now: number; preview?: boolean };

/** The Content list, or with trash the trash. */
export async function studioContent(trash: boolean): Promise<ContentState> {
  const gate = await studioGate();
  if (gate === "no-db") return noDb() ? { kind: "ready", rows: previewRows(trash), now: Date.now(), preview: true } : { kind: "no-db" };
  if (typeof gate === "string") return { kind: gate };
  const { data, error } = await gate.supabase.rpc("studio_videos", { trash });
  if (error) return codeOf(error) === "not_set_up" ? { kind: "not-set-up" } : { kind: "off" };
  const rows = (Array.isArray(data) ? data : []) as Record<string, unknown>[];
  const link = await withLinks(rows);
  return { kind: "ready", rows: rows.map((r) => rowToStudio(r, link)), now: Date.now() };
}

export type Still = { name: string; url: string };

export type EditState =
  | { kind: Simple | "no-db" | "missing" }
  | {
      kind: "ready";
      video: StudioRow;
      /** The encoder's three stills, once the video is ready. */
      stills: Still[];
      /** The custom picture in use, when there is one. */
      custom: Still | null;
      channelDefault: CommentsMode;
      commentsOn: boolean;
      shortsOn: boolean;
      uploadsConfigured: boolean;
      preview?: boolean;
    };

/** One of the caller's videos for /studio/video/<id>/edit. */
export async function studioVideo(id: string): Promise<EditState> {
  const gate = await studioGate();
  if (gate === "no-db") {
    if (!noDb()) return { kind: "no-db" };
    const video = previewRows(false).find((v) => v.id === id) ?? previewRows(false)[0];
    return {
      kind: "ready", video, stills: [], custom: null, channelDefault: "on", commentsOn: true, shortsOn: true,
      uploadsConfigured: false, preview: true,
    };
  }
  if (typeof gate === "string") return { kind: gate };
  const { data, error } = await gate.supabase.rpc("studio_videos", { trash: false });
  if (error) return codeOf(error) === "not_set_up" ? { kind: "not-set-up" } : { kind: "off" };
  const raw = ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).find((r) => r.id === id);
  if (!raw) return { kind: "missing" };
  const link = await withLinks([raw]);
  const video = rowToStudio(raw, link);
  const stills: Still[] = [];
  if (video.status === "ready") {
    for (const name of STILLS) {
      const url = await thumbnailLink(video.id, name, null);
      if (url) stills.push({ name, url });
    }
  }
  const custom = video.thumbnailName?.startsWith("custom-") && video.thumbnail ? { name: video.thumbnailName, url: video.thumbnail } : null;
  const [commentsOn, shortsOn, channel] = await Promise.all([
    flagOn("comments", gate.user.id),
    flagOn("shorts", gate.user.id),
    gate.supabase.from("channels").select("comments_default").eq("owner_id", gate.user.id).maybeSingle(),
  ]);
  const d = (channel.data as { comments_default?: string } | null)?.comments_default;
  return {
    kind: "ready",
    video,
    stills,
    custom,
    channelDefault: d === "off" || d === "held" ? d : "on",
    commentsOn,
    shortsOn,
    uploadsConfigured: storageConfigured(),
  };
}

// Changes -------------------------------------------------------------------------------------

async function writer(): Promise<{ user: CurrentUser; supabase: Db } | Fail> {
  const gate = await studioGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "studio_off" };
  if (gate === "signed-out") return { error: "not_signed_in" };
  return gate;
}

export type BulkName = "visibility" | "trash" | "restore";

export async function bulkChange(ids: string[], action: BulkName, visibility: Visibility | null): Promise<{ changed: number } | Fail> {
  if (ids.length > BULK_MAX) return { error: "too_many" };
  const w = await writer();
  if ("error" in w) return w;
  const { data, error } = await w.supabase.rpc("studio_bulk", { video_ids: ids, action, visibility });
  return error ? { error: codeOf(error) } : { changed: Number(data) || 0 };
}

export type Details = { title: string; description: string; visibility: Visibility; tags: string[] };

export async function saveDetails(id: string, d: Details): Promise<{ ok: true } | Fail> {
  if (tagsProblem(d.tags)) return { error: "tags_invalid" };
  const w = await writer();
  if ("error" in w) return w;
  const { error } = await w.supabase.rpc("update_video", {
    video_id: id,
    title: d.title,
    description: d.description,
    visibility: d.visibility,
    tags: d.tags,
  });
  return error ? { error: codeOf(error) } : { ok: true };
}

/**
 * The link stored in thumbnail_url, so the feeds, search and the watch page
 * show the pick: MEDIA_PUBLIC_URL when set, else this site's own /api/media
 * route when the site runs on https, else null (only the studio shows it).
 */
function storedUrl(id: string, name: string | null, origin: string | null): string | null {
  if (!name) return null;
  const base = publicBase();
  if (base?.startsWith("https://")) return `${base}/${thumbnailKey(id, name)}`;
  if (origin?.startsWith("https://")) return `${origin}/api/media/${id}/${name}`;
  return null;
}

/** One of the stills, or null for the default. */
export async function pickThumbnail(id: string, name: string | null, origin: string | null): Promise<{ url: string | null } | Fail> {
  if (name !== null && !(STILLS as readonly string[]).includes(name)) return { error: "thumbnail_invalid" };
  const w = await writer();
  if ("error" in w) return w;
  // thumb-1.webp is the default: store it as null so the encoder's own link is used.
  const chosen = name === "thumb-1.webp" ? null : name;
  const url = storedUrl(id, chosen, origin);
  const { error } = await w.supabase.rpc("set_video_thumbnail", { video_id: id, name: chosen, url });
  if (error) return { error: codeOf(error) };
  return { url: await thumbnailLink(id, chosen, url) };
}

/** Step 1 of a custom thumbnail: a name and a PUT link. */
export async function signThumbnail(id: string, mime: string, bytes: number): Promise<{ name: string; url: string } | Fail> {
  if (!THUMBNAIL_TYPES[mime] || !(bytes > 0) || bytes > THUMBNAIL_MAX_BYTES) return { error: "thumbnail_invalid" };
  const w = await writer();
  if ("error" in w) return w;
  if (!storageConfigured()) return { error: "storage_not_configured" };
  // Only the owner of a ready video gets a link: studio_videos only lists the caller's own.
  const { data, error } = await w.supabase.rpc("studio_videos", { trash: false });
  if (error) return { error: codeOf(error) };
  const v = ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).find((r) => r.id === id);
  if (!v) return { error: "not_found" };
  if (v.status !== "ready" || !v.hls_key) return { error: "not_ready" };
  const name = customThumbnailName(mime, crypto.getRandomValues(new Uint8Array(16)));
  const url = name ? await signedPut(thumbnailKey(id, name), mime) : null;
  return name && url ? { name, url } : { error: "storage_not_configured" };
}

/** Step 2: the file is in R2. Check it, then use it. */
export async function finishThumbnail(id: string, name: string, origin: string | null): Promise<{ url: string | null } | Fail> {
  if (!isThumbnailName(name) || !name.startsWith("custom-")) return { error: "thumbnail_invalid" };
  const w = await writer();
  if ("error" in w) return w;
  const key = thumbnailKey(id, name);
  const head = await headObject(key).catch(() => null);
  if (!head) return { error: "upload_failed" };
  if (head.bytes <= 0 || head.bytes > THUMBNAIL_MAX_BYTES || !head.type || !THUMBNAIL_TYPES[head.type]) {
    await deleteObject(key);
    return { error: "thumbnail_invalid" };
  }
  const url = storedUrl(id, name, origin);
  const { error } = await w.supabase.rpc("set_video_thumbnail", { video_id: id, name, url });
  if (error) {
    await deleteObject(key);
    return { error: codeOf(error) };
  }
  return { url: await thumbnailLink(id, name, url) };
}
