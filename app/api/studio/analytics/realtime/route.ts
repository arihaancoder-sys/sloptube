import { answer, badRequest, idParam } from "@/lib/stats/http";
import { realtimeJson } from "@/lib/stats/server";

// GET /api/studio/analytics/realtime[?video=<id>]: counted views per hour for
// the last 48 hours, for one video or the whole channel. Answers { hours }.
// The realtime card asks again every minute.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("video");
  const video = idParam(url, "video");
  if (raw && !video) return badRequest();
  return answer(await realtimeJson(video));
}
