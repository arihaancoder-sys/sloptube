import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { createClient } from "@/lib/supabase/server";
import type { StatusContext, StatusVideoRow } from "./handler";
import { signedThumbnailUrl } from "./media";
import { readJob, type JobInfo } from "./status";

/** The real Supabase, session and flag for /api/videos/[id]/status. */
export async function statusContext(): Promise<StatusContext> {
  const supabase = await createClient();
  return {
    db: supabase
      ? {
          async video(id) {
            const { data } = await supabase
              .from("videos")
              .select("id, owner_id, status, thumbnail_url, error")
              .eq("id", id)
              .maybeSingle();
            return (data as StatusVideoRow | null) ?? null;
          },
          async job(videoId) {
            const { data } = await supabase
              .from("encode_jobs")
              .select("status, progress, attempts")
              .eq("video_id", videoId)
              .maybeSingle();
            return data;
          },
        }
      : null,
    userId: async () => (await getCurrentUser())?.id ?? null,
    flagOn: (userId) => flagOn("processing", userId),
    thumbnail: signedThumbnailUrl,
  };
}

/**
 * The encode jobs of these videos, by video id. Row level security only shows
 * jobs of the person's own videos. Empty when migration 006 is not applied.
 */
export async function jobsFor(supabase: SupabaseClient, videoIds: string[]): Promise<Map<string, JobInfo>> {
  const out = new Map<string, JobInfo>();
  if (videoIds.length === 0) return out;
  const { data, error } = await supabase
    .from("encode_jobs")
    .select("video_id, status, progress, attempts")
    .in("video_id", videoIds);
  if (error || !data) return out;
  for (const row of data as { video_id: string }[]) {
    const job = readJob(row);
    if (job) out.set(row.video_id, job);
  }
  return out;
}
