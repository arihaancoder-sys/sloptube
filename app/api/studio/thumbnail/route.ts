import { answer, badRequest, isUuid, originOf, readJson } from "@/lib/studio/http";
import { finishThumbnail, pickThumbnail } from "@/lib/studio/server";

// POST /api/studio/thumbnail
//   { videoId, still: "thumb-2.webp" | null }  one of the encoder's stills (null: the default)
//   { videoId, uploaded: "custom-....jpg" }    a custom file /api/studio/thumbnail/sign gave a link for
// answers { url }, the picture to show now.
export async function POST(request: Request) {
  const b = await readJson(request);
  if (!b || !isUuid(b.videoId)) return badRequest();
  const id = b.videoId.toLowerCase();
  if (typeof b.uploaded === "string") return answer(await finishThumbnail(id, b.uploaded, originOf(request)));
  if (b.still === null || typeof b.still === "string") return answer(await pickThumbnail(id, b.still, originOf(request)));
  return badRequest();
}
