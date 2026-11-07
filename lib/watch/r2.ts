// The media route's view of R2: read a small text file, presign a GET.
// Relative imports only, so the tests load it directly with a mocked client.

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { MediaStorage } from "./media.ts";

/** Playlists and the sprite .vtt are a few KB. Anything bigger is not one of ours. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.$metadata?.httpStatusCode === 404 || e?.name === "NoSuchKey" || e?.name === "NotFound";
}

export function createMediaStorage(client: S3Client, bucket: string): MediaStorage {
  return {
    async getText(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (typeof out.ContentLength === "number" && out.ContentLength > MAX_TEXT_BYTES) {
          throw new Error("file too big to proxy");
        }
        return out.Body ? await out.Body.transformToString("utf-8") : "";
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    presign(key, expiresIn) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn });
    },
  };
}
