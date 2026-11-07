import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { readR2Config } from "@/lib/upload/env";
import { createR2Client } from "@/lib/upload/r2";

/** How long a signed thumbnail link works in the studio, and how long an upload link does. */
const VIEW_TTL_S = 60 * 60;
const PUT_TTL_S = 10 * 60;

function r2() {
  const config = readR2Config();
  return config ? { client: createR2Client(config), bucket: config.bucket } : null;
}

export function storageConfigured(): boolean {
  return readR2Config() !== null;
}

/** A short lived GET link to one object, made locally. Null without R2 settings. */
export async function signedGet(key: string): Promise<string | null> {
  const s = r2();
  if (!s) return null;
  try {
    return await getSignedUrl(s.client, new GetObjectCommand({ Bucket: s.bucket, Key: key }), { expiresIn: VIEW_TTL_S });
  } catch {
    return null;
  }
}

/** A PUT link for a custom thumbnail. The browser must send this content type. */
export async function signedPut(key: string, mime: string): Promise<string | null> {
  const s = r2();
  if (!s) return null;
  return getSignedUrl(
    s.client,
    new PutObjectCommand({ Bucket: s.bucket, Key: key, ContentType: mime, CacheControl: "public, max-age=300" }),
    { expiresIn: PUT_TTL_S },
  );
}

/** Size and type of an object, or null when it is not there. */
export async function headObject(key: string): Promise<{ bytes: number; type: string | null } | null> {
  const s = r2();
  if (!s) return null;
  try {
    const out = await s.client.send(new HeadObjectCommand({ Bucket: s.bucket, Key: key }));
    return { bytes: Number(out.ContentLength ?? 0), type: out.ContentType ?? null };
  } catch (err) {
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
    throw err;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const s = r2();
  if (!s) return;
  await s.client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: key })).catch(() => {});
}
