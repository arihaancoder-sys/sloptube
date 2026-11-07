// The logic behind GET /api/media/[video]/[...path]. The route file only wires
// in Supabase, the flag and R2, so the tests run this with fakes.
// Only relative imports, so Node can load this file directly.

import { mediaBase, rewritePlaylist } from "./playlist.ts";

/** How long the presigned R2 links the route redirects to work, in seconds. */
export const MEDIA_URL_TTL_S = 10 * 60;

/** What watch_video() says about the video, as far as the route cares. */
export type MediaVideo = { status: string; is_owner: boolean | null; hls_key: string | null };

export type MediaStorage = {
  /** The object as text, or null when it does not exist. */
  getText(key: string): Promise<string | null>;
  /** A presigned GET link to the object. Made locally, no request to R2. */
  presign(key: string, expiresIn: number): Promise<string>;
};

export type MediaContext = {
  /** null when the Supabase settings are missing. */
  db: { watchVideo(id: string): Promise<MediaVideo | null> } | null;
  /** Is the watch flag on for the person asking? */
  flagOn: () => Promise<boolean>;
  /** null when the R2 settings are missing. */
  storage: MediaStorage | null;
};

export type MediaResult = { status: number; headers: Record<string, string>; body: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PART = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Text files the route reads and hands over itself, with their type. */
const PROXIED: Record<string, string> = {
  m3u8: "application/vnd.apple.mpegurl",
  vtt: "text/vtt; charset=utf-8",
};
/** Files the route redirects to R2 for. */
const REDIRECTED = new Set(["m4s", "mp4", "webp", "jpg"]);

function fail(status: number, error: string): MediaResult {
  return {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
    body: JSON.stringify({ error }),
  };
}

/** "720p/seg_00001.m4s" from the route's path segments, or null when it is not a file we serve. */
export function cleanMediaPath(parts: string[]): { path: string; ext: string } | null {
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((p) => PART.test(p) && !p.includes(".."))) return null;
  const ext = parts[parts.length - 1].split(".").pop()?.toLowerCase() ?? "";
  if (!(ext in PROXIED) && !REDIRECTED.has(ext)) return null;
  return { path: parts.join("/"), ext };
}

/** The video's folder in the bucket, from its hls_key: "hls/<id>/master.m3u8" -> "hls/<id>". */
export function folderOf(hlsKey: string): string | null {
  const i = hlsKey.lastIndexOf("/");
  return i > 0 ? hlsKey.slice(0, i) : null;
}

/**
 * Who may get a file: anybody watch_video() hands the playback fields to.
 * That is public and unlisted videos once they are ready, and the owner always.
 * Everything else (private, not ready, missing) is the same 404.
 */
export async function serveMedia(videoId: string, parts: string[], ctx: MediaContext): Promise<MediaResult> {
  if (!ctx.db) return fail(503, "no_db");
  if (!(await ctx.flagOn())) return fail(403, "watch_off");
  if (!UUID.test(videoId)) return fail(404, "not_found");
  const file = cleanMediaPath(parts);
  if (!file) return fail(404, "not_found");

  const id = videoId.toLowerCase();
  const video = await ctx.db.watchVideo(id);
  const folder = video?.hls_key ? folderOf(video.hls_key) : null;
  if (!video || !folder) return fail(404, "not_found");
  if (!ctx.storage) return fail(503, "media_not_configured");

  const key = `${folder}/${file.path}`;
  // Owners may watch private videos: never let a shared cache keep their answers.
  const cache = video.is_owner ? "private, no-store" : "private, max-age=60";
  try {
    if (file.ext in PROXIED) {
      const text = await ctx.storage.getText(key);
      if (text === null) return fail(404, "not_found");
      const body = file.ext === "m3u8" ? rewritePlaylist(text, file.path, mediaBase(id)) : text;
      return { status: 200, headers: { "content-type": PROXIED[file.ext], "cache-control": cache }, body };
    }
    const url = await ctx.storage.presign(key, MEDIA_URL_TTL_S);
    // The link works for 10 minutes, so the browser may reuse the redirect for 5.
    return {
      status: 302,
      headers: { location: url, "cache-control": video.is_owner ? "private, no-store" : "private, max-age=300" },
      body: null,
    };
  } catch {
    return fail(502, "storage_error");
  }
}

/**
 * The player's source for a video: straight from the public bucket domain
 * when MEDIA_PUBLIC_URL is set, else through the media route.
 */
export function playbackUrls(videoId: string, hlsKey: string, spriteKey: string | null, publicBase: string | null) {
  const id = videoId.toLowerCase();
  const folder = folderOf(hlsKey) ?? `hls/${id}`;
  const file = (key: string) => key.slice(folder.length + 1);
  if (publicBase) {
    return {
      src: `${publicBase}/${hlsKey}`,
      spriteVtt: spriteKey ? `${publicBase}/${spriteKey}` : null,
      thumbnail: (name: string) => `${publicBase}/${folder}/${name}`,
    };
  }
  const base = mediaBase(id);
  return {
    src: `${base}/${file(hlsKey)}`,
    spriteVtt: spriteKey && spriteKey.startsWith(folder + "/") ? `${base}/${file(spriteKey)}` : null,
    thumbnail: (name: string) => `${base}/${name}`,
  };
}

/**
 * MEDIA_PUBLIC_URL without the trailing slash, or null. Only http(s); plain
 * http is accepted for local testing (the Playwright fixture server).
 */
export function readPublicBase(value: string | undefined): string | null {
  const v = value?.trim().replace(/\/+$/, "");
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? v : null;
  } catch {
    return null;
  }
}
