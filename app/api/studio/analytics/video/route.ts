import { answer, badRequest, idParam, rangeParam } from "@/lib/stats/http";
import { videoJson } from "@/lib/stats/server";

// GET /api/studio/analytics/video?id=<video>&range=7d|28d|90d|lifetime: one of
// the caller's videos, as on /studio/video/<id>/analytics. 403 stats_off with
// the flag off, 403 not_allowed for somebody else's video.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = idParam(url, "id");
  const range = rangeParam(url);
  if (!id || !range) return badRequest();
  return answer(await videoJson(id, range));
}
