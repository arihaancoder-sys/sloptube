import { answer, badRequest, isUuid, readJson } from "@/lib/comments/http";
import { isMode } from "@/lib/comments/rules";
import { setCommentsMode } from "@/lib/comments/server";

// POST /api/comments/settings { mode: on | off | held } sets the channel's
// default for its videos. With { videoId, mode } it sets one video's mode
// (mode null makes the video follow the channel again). Answers { mode }.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body) return badRequest();
  const videoId = body.videoId ?? null;
  if (videoId !== null && !isUuid(videoId)) return badRequest();
  if (!(isMode(body.mode) || (videoId !== null && body.mode === null))) return badRequest();
  return answer(await setCommentsMode(body.mode as never, videoId ? videoId.toLowerCase() : null));
}
