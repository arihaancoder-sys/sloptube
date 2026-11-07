import { serveMedia } from "@/lib/watch/media";
import { mediaContext } from "@/lib/watch/server";

// The player's files for one video, from the private R2 bucket.
//   playlists (.m3u8) and the sprite .vtt: read from R2 and sent as they are,
//     with every URI in a playlist pointed back at this route
//   segments, init files and images: a 302 to a presigned R2 link (10 minutes)
// Only for people who may watch the video: public and unlisted once ready,
// the owner always. See serveMedia in lib/watch/media.ts and "Watch page" in
// README.md for why it works this way.
export async function GET(_request: Request, ctx: RouteContext<"/api/media/[video]/[...path]">) {
  const { video, path } = await ctx.params;
  const result = await serveMedia(video, path, await mediaContext());
  return new Response(result.body, { status: result.status, headers: result.headers });
}
