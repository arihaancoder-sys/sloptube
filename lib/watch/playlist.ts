// Rewrites HLS playlists so every file they point at goes through the media
// route, /api/media/<video>/<path>. No imports, so Node can load it directly.
//
// Why: the bucket is private. The route checks who may watch, then sends a
// 302 to a short lived presigned R2 URL. If the playlists were redirected too,
// the player would resolve the relative names inside them ("720p/index.m3u8",
// "seg_00001.m4s") against the presigned R2 URL and ask R2 directly, without a
// signature, and get 403. So playlists are small text files the route reads
// from R2 and hands over itself, with every URI rewritten to the route.

/** The URL prefix of the media route for one video. */
export function mediaBase(videoId: string): string {
  return `/api/media/${videoId.toLowerCase()}`;
}

/**
 * Resolves a playlist entry against the folder of the playlist it is in,
 * like a browser would, and returns the path inside the video's folder
 * ("720p/seg_00001.m4s"), or null when it leaves the folder or is absolute.
 */
export function resolveEntry(uri: string, playlistPath: string): string | null {
  const u = uri.trim();
  if (!u || /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("/") || u.startsWith("\\")) return null;
  const root = "https://media.invalid/v/";
  let resolved: URL;
  try {
    resolved = new URL(u, new URL(playlistPath, root));
  } catch {
    return null;
  }
  if (resolved.origin !== "https://media.invalid" || !resolved.pathname.startsWith("/v/")) return null;
  const path = decodeURIComponent(resolved.pathname.slice(3));
  return path && !path.split("/").includes("..") ? path : null;
}

/**
 * Every URI in the playlist, both the lines that name a file and the URI="..."
 * attributes (EXT-X-MAP, EXT-X-MEDIA, EXT-X-I-FRAME-STREAM-INF), pointed at
 * `${base}/<path>`. Absolute URLs and entries that leave the video's folder
 * are kept as they are; the encoder never writes them.
 */
export function rewritePlaylist(text: string, playlistPath: string, base: string): string {
  const to = (uri: string) => {
    const path = resolveEntry(uri, playlistPath);
    return path === null ? uri : `${base}/${path.split("/").map(encodeURIComponent).join("/")}`;
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) return line.replace(/URI="([^"]*)"/g, (_, uri: string) => `URI="${to(uri)}"`);
      return to(trimmed);
    })
    .join("\n");
}
