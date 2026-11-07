// The worker RPCs from supabase/migrations/006_processing.sql (and the
// storage_cleanup queue from 014_studio.sql), called with the
// service role key. Only this box ever holds that key.
import { createClient } from "@supabase/supabase-js";

export function createSupabase(url, serviceRoleKey) {
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function rpcError(name, error) {
  return new Error(`${name}: ${error.message ?? "database error"}`);
}

/** The queue, on top of a Supabase client. */
export function createDb(supabase) {
  return {
    /** The next job for this worker, or null when there is nothing to do. */
    async claim(worker) {
      const { data, error } = await supabase.rpc("claim_encode_job", { worker });
      if (error) throw rpcError("claim_encode_job", error);
      const row = Array.isArray(data) ? data[0] : data;
      if (!row?.job_id) return null;
      return {
        jobId: row.job_id,
        videoId: row.video_id,
        ownerId: row.owner_id,
        sourceKey: row.source_key,
        sourceBytes: row.source_bytes === null ? null : Number(row.source_bytes),
        sourceMime: row.source_mime,
        attempt: Number(row.attempt),
      };
    },

    /** False when the job is not running any more (taken back as stale). */
    async progress(jobId, pct) {
      const { data, error } = await supabase.rpc("encode_progress", { job_id: jobId, pct });
      if (error) throw rpcError("encode_progress", error);
      return data !== false;
    },

    async done(jobId, r) {
      const { error } = await supabase.rpc("encode_done", {
        job_id: jobId,
        duration_s: r.durationS,
        width: r.width,
        height: r.height,
        hls_key: r.hlsKey,
        thumbnail_url: r.thumbnailUrl,
        preview_sprite_key: r.previewSpriteKey,
        renditions: r.renditions,
      });
      if (error) throw rpcError("encode_done", error);
    },

    /** 'queued' when it will be tried again, 'failed' when the video is failed. */
    async failed(jobId, message, retry = true) {
      const { data, error } = await supabase.rpc("encode_failed", { job_id: jobId, error: message, retry });
      if (error) throw rpcError("encode_failed", error);
      return data;
    },

    /** The next R2 folders to empty (014_studio.sql): [{ id, prefix, attempt }]. */
    async claimCleanup(worker, lim) {
      const { data, error } = await supabase.rpc("claim_cleanup", { worker, lim });
      if (error) throw rpcError("claim_cleanup", error);
      return (Array.isArray(data) ? data : []).map((r) => ({ id: r.id, prefix: r.prefix, attempt: Number(r.attempt) }));
    },

    async cleanupDone(id, deleted) {
      const { error } = await supabase.rpc("cleanup_done", { cleanup_id: id, deleted });
      if (error) throw rpcError("cleanup_done", error);
    },

    async cleanupFailed(id, message) {
      const { error } = await supabase.rpc("cleanup_failed", { cleanup_id: id, error: message });
      if (error) throw rpcError("cleanup_failed", error);
    },

    /** The next Yapin' announcements (018_yapin.sql). Holds the webhook URL: never log it. */
    async claimYapin(worker, lim) {
      const { data, error } = await supabase.rpc("claim_yapin_posts", { worker, lim });
      if (error) throw rpcError("claim_yapin_posts", error);
      return (Array.isArray(data) ? data : []).map((r) => ({
        id: r.id,
        url: r.url,
        videoId: r.video_id,
        title: r.title ?? "",
        description: r.description ?? "",
        thumbnailUrl: r.thumbnail_url,
        channelName: r.channel_name ?? "",
        channelHandle: r.channel_handle ?? "",
        attempts: Number(r.attempts) || 0,
      }));
    },

    async yapinResult(id, result) {
      const { error } = await supabase.rpc("yapin_post_result", { post_id: id, ok: result.ok, tries: result.tries, error: result.error });
      if (error) throw rpcError("yapin_post_result", error);
    },
  };
}
