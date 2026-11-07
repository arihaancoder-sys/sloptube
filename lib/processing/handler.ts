// The logic behind GET /api/videos/[id]/status. The route file only wires in
// Supabase, the signed in user and the flag, so the tests run this with fakes.
// Only relative imports, so Node can load this file directly.

import { progressFor, readJob, type LiveStatus } from "./status.ts";

export type StatusVideoRow = {
  id: string;
  owner_id: string;
  status: LiveStatus["status"];
  thumbnail_url: string | null;
  error: string | null;
};

export type StatusContext = {
  /** null when the Supabase settings are missing. */
  db: {
    /** The video if the signed in person can read it, or null. */
    video(id: string): Promise<StatusVideoRow | null>;
    /** The encode_jobs row, or null (no job yet, or migration 006 not applied). */
    job(videoId: string): Promise<unknown>;
  } | null;
  userId: () => Promise<string | null>;
  flagOn: (userId: string) => Promise<boolean>;
  /** A link to the default thumbnail when the row has no thumbnail_url. */
  thumbnail: (videoId: string) => Promise<string | null>;
};

export type StatusResult = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fail(status: number, error: string): StatusResult {
  return { status, body: { error } };
}

/** Owner only: anybody else gets 404, the same as a video that does not exist. */
export async function videoStatus(id: string, ctx: StatusContext): Promise<StatusResult> {
  if (!ctx.db) return fail(503, "no_db");
  const userId = await ctx.userId();
  if (!userId) return fail(401, "not_signed_in");
  if (!(await ctx.flagOn(userId))) return fail(403, "processing_off");
  if (!UUID.test(id)) return fail(404, "not_found");

  const video = await ctx.db.video(id.toLowerCase());
  if (!video || video.owner_id !== userId) return fail(404, "not_found");

  const job = readJob(await ctx.db.job(video.id));
  const thumbnailUrl = video.status === "ready" ? (video.thumbnail_url ?? (await ctx.thumbnail(video.id))) : null;
  const body: LiveStatus = {
    id: video.id,
    status: video.status,
    progress: progressFor(video.status, job),
    job,
    thumbnailUrl,
    error: video.status === "failed" ? video.error : null,
  };
  return { status: 200, body };
}
