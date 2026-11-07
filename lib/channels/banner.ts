"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { BANNER_HEIGHT, BANNER_WIDTH, bannerCrop, bannerFileProblem, bannerSizeProblem } from "./validation";

export const BANNER_BUCKET = "banners";

/**
 * Center crops the image to the 2560 x 423 banner shape and scales it to
 * 2560 wide, as WebP (PNG if the browser cannot make WebP).
 */
export async function resizeBanner(file: File): Promise<Blob> {
  const problem = bannerFileProblem(file);
  if (problem) throw new Error(problem);

  const bitmap = await createImageBitmap(file);
  const sizeProblem = bannerSizeProblem(bitmap.width);
  if (sizeProblem) {
    bitmap.close();
    throw new Error(sizeProblem);
  }
  const { sx, sy, sw, sh } = bannerCrop(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = BANNER_WIDTH;
  canvas.height = BANNER_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not read the image.");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, BANNER_WIDTH, BANNER_HEIGHT);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.85));
  if (blob && blob.type === "image/webp") return blob;
  const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!png) throw new Error("Could not read the image.");
  return png;
}

/**
 * Uploads a resized banner to banners/<user id>/<time>.<ext>, removes the
 * older files in that folder and returns the new public URL.
 */
export async function uploadBanner(supabase: SupabaseClient, userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === "image/webp" ? "webp" : "png";
  const path = `${userId}/${Date.now()}.${ext}`;
  const bucket = supabase.storage.from(BANNER_BUCKET);

  const { error } = await bucket.upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
  if (error) throw new Error(error.message);

  await removeBanners(supabase, userId, path);
  return bucket.getPublicUrl(path).data.publicUrl;
}

/** Deletes every file in the person's banner folder, except `keep`. */
export async function removeBanners(supabase: SupabaseClient, userId: string, keep?: string) {
  const bucket = supabase.storage.from(BANNER_BUCKET);
  const { data } = await bucket.list(userId, { limit: 100 });
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await bucket.remove(old);
}
