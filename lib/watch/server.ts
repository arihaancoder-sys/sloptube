import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { jobsFor } from "@/lib/processing/server";
import { progressFor, type LiveStatus } from "@/lib/processing/status";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readR2Config } from "@/lib/upload/env";
import { createR2Client } from "@/lib/upload/r2";
import { playbackUrls, readPublicBase, type MediaContext, type MediaVideo } from "./media";
import { createMediaStorage } from "./r2";
import type { UpNextVideo, WatchRendition, WatchVideo } from "./types";
import { relatedCards } from "@/lib/feed/server";
import { engagementFor } from "@/lib/engagement/server";
import type { WatchEngagement } from "@/lib/engagement/types";
import { commentsFor } from "@/lib/comments/server";
import type { CommentsInitial } from "@/lib/comments/types";

/** Up next asks for this many videos. */
const UP_NEXT_LIMIT = 12;

/** The public bucket domain, when the owner set one up. Read at request time. */
export function mediaPublicBase(): string | null {
  return readPublicBase(process.env.MEDIA_PUBLIC_URL);
}

/** The real Supabase, flag and R2 for /api/media/[video]/[...path]. */
export async function mediaContext(): Promise<MediaContext> {
  const supabase = await createClient();
  const r2 = readR2Config();
  return {
    db: supabase
      ? {
          async watchVideo(id) {
            const { data, error } = await supabase.rpc("watch_video", { video_id: id });
            if (error || !Array.isArray(data) || data.length === 0) return null;
            return data[0] as MediaVideo;
          },
        }
      : null,
    flagOn: () => flagOn("watch"),
    storage: r2 ? createMediaStorage(createR2Client(r2), r2.bucket) : null,
  };
}

export type WatchRow = {
  id: string;
  title: string;
  description: string;
  visibility: WatchVideo["visibility"];
  status: LiveStatus["status"];
  is_owner: boolean | null;
  created_at: string;
  published_at: string | null;
  duration_s: number | string | null;
  views: number | string | null;
  renditions: unknown;
  thumbnail_url: string | null;
  hls_key: string | null;
  preview_sprite_key: string | null;
  channel_id: string;
  channel_handle: string;
  channel_name: string;
  channel_avatar_url: string | null;
  channel_subscriber_count: number | null;
};

function toRenditions(value: unknown): WatchRendition[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r) => r && typeof r.name === "string" && Number(r.height) > 0)
    .map((r) => ({ name: r.name, width: Number(r.width) || 0, height: Number(r.height) }));
}

function num(v: number | string | null): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowToVideo(row: WatchRow, publicBase: string | null): WatchVideo {
  const urls = row.hls_key ? playbackUrls(row.id, row.hls_key, row.preview_sprite_key, publicBase) : null;
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? "",
    visibility: row.visibility,
    isOwner: row.is_owner === true,
    date: row.published_at ?? row.created_at,
    durationS: num(row.duration_s),
    views: num(row.views) ?? 0,
    renditions: toRenditions(row.renditions),
    thumbnail: row.thumbnail_url ?? urls?.thumbnail("thumb-1.webp") ?? null,
    src: urls?.src ?? null,
    spriteVtt: urls?.spriteVtt ?? null,
    channel: {
      id: row.channel_id,
      handle: row.channel_handle,
      name: row.channel_name,
      avatarUrl: row.channel_avatar_url,
      subscriberCount: row.channel_subscriber_count ?? 0,
    },
  };
}

export type WatchPageState =
  /** The watch flag is off: /watch keeps the feature 4 stub. */
  | { kind: "off" }
  | { kind: "no-db" }
  /** watch_video() is not there yet: migration 007 not applied. */
  | { kind: "not-set-up" }
  /** Private, missing, failed, or a broken link. */
  | { kind: "missing" }
  /** Public or unlisted, but not ready yet. */
  | { kind: "processing"; title: string }
  /** The owner, before the video is ready: progress when the processing flag is on. */
  | { kind: "owner-processing"; video: WatchVideo; live: LiveStatus; processingOn: boolean }
  /**
   * engagement: likes and the saved position with the engagement flag on (feature 9), else null.
   * comments: the first page with the comments flag on (feature 10), "no-db" in the preview, else null.
   */
  | {
      kind: "ready";
      video: WatchVideo;
      upNext: UpNextVideo[];
      preview: boolean;
      engagement: WatchEngagement | null;
      comments: CommentsInitial | "no-db" | null;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** What /watch?v=<id> shows. Reads the request, so call it inside <Suspense>. */
// cache: generateMetadata and the page read the same state once per request.
export const watchPageState = cache(async function watchPageState(v: string | null): Promise<WatchPageState> {
  await connection();
  if (!readSupabaseConfig()) {
    return process.env.NODE_ENV === "development" ? previewState(v) : { kind: "no-db" };
  }
  const user = await getCurrentUser();
  if (!(await flagOn("watch", user?.id ?? null))) return { kind: "off" };
  if (!v || !UUID.test(v)) return { kind: "missing" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  const { data, error } = await supabase.rpc("watch_video", { video_id: v.toLowerCase() });
  if (error) return error.code === "PGRST202" || error.code === "42883" ? { kind: "not-set-up" } : { kind: "missing" };
  const row = (Array.isArray(data) ? data[0] : null) as WatchRow | null;
  if (!row) return { kind: "missing" };

  const publicBase = mediaPublicBase();
  const video = rowToVideo(row, publicBase);
  if (row.status !== "ready") {
    if (!video.isOwner) return row.status === "failed" ? { kind: "missing" } : { kind: "processing", title: row.title };
    const processingOn = await flagOn("processing", user?.id ?? null);
    const jobs = processingOn ? await jobsFor(supabase, [row.id]) : new Map();
    const job = jobs.get(row.id) ?? null;
    const live: LiveStatus = {
      id: row.id,
      status: row.status,
      progress: progressFor(row.status, job),
      job,
      thumbnailUrl: null,
      error: null,
    };
    return { kind: "owner-processing", video, live, processingOn };
  }
  if (!video.src) return { kind: "missing" };

  const [upNext, engagement, comments] = await Promise.all([
    upNextFor(supabase, row, publicBase, user?.id ?? null),
    engagementFor(row.id),
    commentsFor(row.id),
  ]);
  return { kind: "ready", video, upNext, preview: false, engagement, comments };
});

/**
 * Up next. With the feed flag on: related_videos() (same channel first, then
 * the newest). Otherwise, or before migration 008: more from this channel.
 */
async function upNextFor(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  row: WatchRow,
  publicBase: string | null,
  userId: string | null,
): Promise<UpNextVideo[]> {
  if (await flagOn("feed", userId)) {
    const related = await relatedCards(row.id, UP_NEXT_LIMIT);
    if (related) {
      return related.map((c) => ({
        id: c.id,
        title: c.title,
        thumbnail: c.thumbnail,
        durationS: c.durationS,
        views: c.views,
        date: c.publishedAt,
        channelName: c.channel.name,
      }));
    }
  }
  const { data: more } = await supabase
    .from("videos")
    .select("id, title, duration_s, views, thumbnail_url, published_at, hls_key")
    .eq("channel_id", row.channel_id)
    .eq("visibility", "public")
    .eq("status", "ready")
    .neq("id", row.id)
    .order("published_at", { ascending: false })
    .limit(UP_NEXT_LIMIT);
  return ((more ?? []) as Record<string, unknown>[]).map((m) => {
    const id = String(m.id);
    const hlsKey = typeof m.hls_key === "string" ? m.hls_key : `hls/${id}/master.m3u8`;
    return {
      id,
      title: String(m.title),
      thumbnail: (m.thumbnail_url as string | null) ?? playbackUrls(id, hlsKey, null, publicBase).thumbnail("thumb-1.webp"),
      durationS: num(m.duration_s as number | null),
      views: num(m.views as number | null) ?? 0,
      date: (m.published_at as string | null) ?? null,
    };
  });
}

// Preview ---------------------------------------------------------------------------

/** The sample ids, the same ones /studio/videos shows in its preview. */
export const PREVIEW_READY_ID = "00000000-0000-4000-8000-000000000004";
export const PREVIEW_PROCESSING_ID = "00000000-0000-4000-8000-000000000003";

/**
 * `npm run dev` without the Supabase settings: a sample video, so the page can
 * be seen (and filmed) without a database. With MEDIA_PUBLIC_URL set it plays
 * whatever is under hls/<sample id>/ there; scripts/watch-shots.mjs serves a
 * generated 3 second clip that way. Made up text, no real data.
 */
function previewState(v: string | null): WatchPageState {
  const publicBase = mediaPublicBase();
  const id = v?.toLowerCase() === PREVIEW_PROCESSING_ID ? PREVIEW_PROCESSING_ID : PREVIEW_READY_ID;
  const row: WatchRow = {
    id,
    title: id === PREVIEW_READY_ID ? "Sample: ready to watch" : "Sample: being processed",
    description:
      "A sample video for the watch page preview.\n\nIt is a 3 second test pattern made with ffmpeg, encoded to HLS at " +
      "360p and 720p like the encoder does.\n\nThe description is long enough to need SHOW MORE: it keeps going for a " +
      "few lines so the fold can be seen.\nLine four.\nLine five.",
    visibility: "public",
    status: id === PREVIEW_READY_ID ? "ready" : "processing",
    is_owner: id !== PREVIEW_READY_ID,
    created_at: "2026-11-03T18:20:00Z",
    published_at: "2026-11-03T18:20:00Z",
    duration_s: 3,
    views: 1234,
    renditions: [
      { name: "360p", width: 640, height: 360 },
      { name: "720p", width: 1280, height: 720 },
    ],
    thumbnail_url: null,
    hls_key: `hls/${id}/master.m3u8`,
    preview_sprite_key: `hls/${id}/sprite.vtt`,
    channel_id: "00000000-0000-4000-8000-0000000000c1",
    channel_handle: "sample",
    channel_name: "Sample Channel",
    channel_avatar_url: null,
    channel_subscriber_count: 12345,
  };
  if (id === PREVIEW_PROCESSING_ID) {
    const job = { status: "running" as const, progress: 42, attempts: 1 };
    return {
      kind: "owner-processing",
      video: rowToVideo(row, publicBase),
      live: { id, status: "processing", progress: 42, job, thumbnailUrl: null, error: null },
      processingOn: true,
    };
  }
  const video = rowToVideo(row, publicBase);
  if (!publicBase) {
    Object.assign(video, { src: null, spriteVtt: null, thumbnail: "/sample-thumbnail.svg" });
  }
  return { kind: "ready", video, upNext: [], preview: true, engagement: null, comments: "no-db" };
}
