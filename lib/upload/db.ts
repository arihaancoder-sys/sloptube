import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UploadDb, VideoRow } from "./handlers";

/** The error code an RPC raised (the message is the code, see 005_videos.sql). */
function code(error: { message?: string } | null): string | null {
  if (!error) return null;
  const m = error.message ?? "";
  return /^[a-z_]{3,40}$/.test(m) ? m : "db_error";
}

/** UploadDb on top of a Supabase client that carries the signed in session. */
export function createUploadDb(supabase: SupabaseClient): UploadDb {
  return {
    async createUpload(title, bytes, mime) {
      const { data, error } = await supabase.rpc("create_upload", { title, bytes, mime }).single<{
        video_id: string;
        source_key: string;
      }>();
      if (error || !data) return { error: code(error) ?? "db_error" };
      return { videoId: data.video_id, key: data.source_key };
    },

    async getVideo(id) {
      const { data, error } = await supabase
        .from("videos")
        .select("id, owner_id, status, source_key, source_bytes, source_mime")
        .eq("id", id)
        .maybeSingle();
      if (error || !data) return null;
      return {
        id: data.id,
        ownerId: data.owner_id,
        status: data.status,
        sourceKey: data.source_key,
        sourceBytes: data.source_bytes === null ? null : Number(data.source_bytes),
        sourceMime: data.source_mime,
      } satisfies VideoRow;
    },

    async saveDetails(id, d) {
      const { error } = await supabase.rpc("update_upload_details", {
        video_id: id,
        title: d.title,
        description: d.description,
        visibility: d.visibility,
      });
      return code(error);
    },

    async finishUpload(id) {
      const { error } = await supabase.rpc("finish_upload", { video_id: id });
      return code(error);
    },

    async abandonUpload(id, reason) {
      const { error } = await supabase.rpc("abandon_upload", { video_id: id, reason });
      return code(error);
    },
  };
}
