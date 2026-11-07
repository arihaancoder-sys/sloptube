"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { AVATAR_SIZE_PX, avatarFileProblem } from "./validation";

export const AVATAR_BUCKET = "avatars";

/** Center crops the image to a square and scales it to 256 px, as WebP (PNG if WebP is not available). */
export async function resizeAvatar(file: File): Promise<Blob> {
  const problem = avatarFileProblem(file);
  if (problem) throw new Error(problem);

  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;

  const canvas = document.createElement("canvas");
  canvas.width = AVATAR_SIZE_PX;
  canvas.height = AVATAR_SIZE_PX;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIZE_PX, AVATAR_SIZE_PX);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (blob && blob.type === "image/webp") return blob;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not read the image.");
  return png;
}

/**
 * Uploads a resized avatar to avatars/<user id>/<time>.<ext>, removes the
 * older files in that folder and returns the new public URL.
 */
export async function uploadAvatar(supabase: SupabaseClient, userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === "image/webp" ? "webp" : "png";
  const path = `${userId}/${Date.now()}.${ext}`;
  const bucket = supabase.storage.from(AVATAR_BUCKET);

  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);

  await removeAvatars(supabase, userId, path);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Deletes every file in the person's avatar folder, except `keep`. */
export async function removeAvatars(supabase: SupabaseClient, userId: string, keep?: string) {
  const bucket = supabase.storage.from(AVATAR_BUCKET);
  const { data } = await bucket.list(userId, { limit: 100 });
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await bucket.remove(old);
}
