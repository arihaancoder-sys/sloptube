import { answer, badRequest, rangeParam } from "@/lib/stats/http";
import { channelJson } from "@/lib/stats/server";

// GET /api/studio/analytics?range=7d|28d|90d|lifetime: the channel's numbers
// for the range, as on /studio/analytics. 403 stats_off with the flag off.
export async function GET(request: Request) {
  const range = rangeParam(new URL(request.url));
  if (!range) return badRequest();
  return answer(await channelJson(range));
}
