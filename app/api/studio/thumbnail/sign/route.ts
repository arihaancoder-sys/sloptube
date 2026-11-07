import { answer, badRequest, isUuid, readJson } from "@/lib/studio/http";
import { signThumbnail } from "@/lib/studio/server";

// POST /api/studio/thumbnail/sign { videoId, mime, bytes } answers { name, url }:
// a 10 minute PUT link to hls/<video>/<name> in R2. The browser PUTs the
// file with that content type, then calls /api/studio/thumbnail { uploaded: name }.
export async function POST(request: Request) {
  const b = await readJson(request);
  if (!b || !isUuid(b.videoId) || typeof b.mime !== "string" || typeof b.bytes !== "number") return badRequest();
  return answer(await signThumbnail(b.videoId.toLowerCase(), b.mime, b.bytes));
}
