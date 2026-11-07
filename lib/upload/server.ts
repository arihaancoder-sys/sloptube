import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { signedThumbnailUrl } from "@/lib/processing/media";
import { previewVideos } from "@/lib/processing/preview";
import { jobsFor } from "@/lib/processing/server";
import { progressFor, type JobInfo } from "@/lib/processing/status";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readR2Config } from "./env";
import type { VideoStatus, Visibility } from "./rules";

export type UploadPageState =
  /** No Supabase settings while running `next dev`: show the page as a preview. */
  | { kind: "preview" }
  /** The flag is off for this person (also when the database is not connected in production). */
  | { kind: "off"; noDb: boolean }
  | { kind: "signed-out" }
  | { kind: "not-onboarded" }
  | { kind: "ready"; user: CurrentUser; configured: boolean };

/** What /upload should show. Reads the request, so call it inside <Suspense>. */
export async function uploadPageState(): Promise<UploadPageState> {
  await connection();
  if (!readSupabaseConfig()) {
    return process.env.NODE_ENV === "development" ? { kind: "preview" } : { kind: "off", noDb: true };
  }
  const user = await getCurrentUser();
  if (!(await flagOn("upload", user?.id ?? null))) return { kind: "off", noDb: false };
  if (!user) return { kind: "signed-out" };
  if (!user.onboarded) return { kind: "not-onboarded" };
  return { kind: "ready", user, configured: readR2Config() !== null };
}

export type StudioVideo = {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  status: VideoStatus;
  sourceBytes: number | null;
  thumbnailUrl: string | null;
  error: string | null;
  createdAt: string;
  /** The encode job (feature 4), or null when processing is off or there is none. */
  job: JobInfo | null;
  /** 0 to 100 on the way to ready, 100 when ready, null when unknown. */
  progress: number | null;
};

const VIDEO_COLUMNS = "id, owner_id, title, description, visibility, status, source_bytes, thumbnail_url, error, created_at";

type VideoRow = {
  id: string;
  owner_id: string;
  title: string;
  description: string;
  visibility: Visibility;
  status: VideoStatus;
  source_bytes: number | string | null;
  thumbnail_url: string | null;
  error: string | null;
  created_at: string;
};

function rowToVideo(r: VideoRow): StudioVideo {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    visibility: r.visibility,
    status: r.status,
    sourceBytes: r.source_bytes === null ? null : Number(r.source_bytes),
    thumbnailUrl: r.thumbnail_url,
    error: r.error,
    createdAt: r.created_at,
    job: null,
    progress: null,
  };
}

/**
 * Adds the encode progress (when the processing flag is on) and, for ready
 * videos without a public thumbnail_url, a signed link to the thumbnail.
 */
async function withProcessing(
  supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>,
  videos: StudioVideo[],
  processingOn: boolean,
): Promise<StudioVideo[]> {
  const jobs = processingOn
    ? await jobsFor(
        supabase,
        videos.filter((v) => v.status === "uploaded" || v.status === "processing").map((v) => v.id),
      )
    : new Map<string, JobInfo>();
  return Promise.all(
    videos.map(async (v) => {
      const job = jobs.get(v.id) ?? null;
      const thumbnailUrl =
        v.status === "ready" ? (v.thumbnailUrl ?? (await signedThumbnailUrl(v.id))) : v.thumbnailUrl;
      return { ...v, job, progress: progressFor(v.status, job), thumbnailUrl };
    }),
  );
}

export type StudioVideosState =
  /** No Supabase settings while running `next dev`: sample rows in every state. */
  | { kind: "preview"; videos: StudioVideo[] }
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "signed-out" }
  /** The videos table could not be read (migration 005 not applied yet). */
  | { kind: "not-set-up" }
  /** processingOn: the processing flag is on, so the list shows progress and polls. */
  | { kind: "ready"; videos: StudioVideo[]; processingOn: boolean };

/** The signed in person's videos for /studio/videos, newest first. */
export async function myVideos(): Promise<StudioVideosState> {
  await connection();
  if (!readSupabaseConfig()) {
    return process.env.NODE_ENV === "development" ? { kind: "preview", videos: previewVideos() } : { kind: "no-db" };
  }
  const user = await getCurrentUser();
  if (!(await flagOn("upload", user?.id ?? null))) return { kind: "off" };
  if (!user) return { kind: "signed-out" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_COLUMNS)
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error || !data) return { kind: "not-set-up" };
  const processingOn = await flagOn("processing", user.id);
  const videos = await withProcessing(supabase, (data as VideoRow[]).map(rowToVideo), processingOn);
  return { kind: "ready", videos, processingOn };
}

export type WatchState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "missing" }
  /** isOwner and processingOn decide whether the stub shows "Processing, N%" and polls. */
  | { kind: "found"; video: StudioVideo; isOwner: boolean; processingOn: boolean };

/** One video for the /watch stub. Row level security decides who can see it. */
export async function videoForWatch(id: string | null): Promise<WatchState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("upload", user?.id ?? null))) return { kind: "off" };
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return { kind: "missing" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data } = await supabase.from("videos").select(VIDEO_COLUMNS).eq("id", id).maybeSingle();
  if (!data) return { kind: "missing" };
  const row = data as VideoRow;
  const isOwner = user?.id === row.owner_id;
  const processingOn = isOwner && (await flagOn("processing", user?.id ?? null));
  const [video] = await withProcessing(supabase, [rowToVideo(row)], processingOn);
  return { kind: "found", video, isOwner, processingOn };
}
