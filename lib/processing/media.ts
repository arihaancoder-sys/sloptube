import "server-only";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readR2Config } from "@/lib/upload/env";
import { createR2Client } from "@/lib/upload/r2";
import { defaultThumbnailKey } from "./status";

/** How long a signed thumbnail link works, in seconds. */
const THUMBNAIL_URL_TTL_S = 60 * 60;

/**
 * A short lived link to a video's default thumbnail in the private bucket,
 * for when the encoder had no MEDIA_PUBLIC_URL to put in thumbnail_url.
 * Signing happens locally, without a request to R2. Null without R2 settings.
 */
export async function signedThumbnailUrl(videoId: string): Promise<string | null> {
  const r2 = readR2Config();
  if (!r2) return null;
  try {
    return await getSignedUrl(
      createR2Client(r2),
      new GetObjectCommand({ Bucket: r2.bucket, Key: defaultThumbnailKey(videoId) }),
      { expiresIn: THUMBNAIL_URL_TTL_S },
    );
  } catch {
    return null;
  }
}
