import { engagementStatus } from "@/lib/engagement/rules";
import { ping } from "@/lib/engagement/server";
import { isSource } from "@/lib/stats/rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

// The player's view ping, every 10 seconds while playing and on pause, end
// and leave: POST /api/watch/ping { videoId, position, played } answers
// { counted, views }. The start ping also carries source (where the viewer
// came from, lib/stats/source.ts); anything unknown is left out. Signed out
// viewers get the 'sv' cookie here.
// The body is read as text, so navigator.sendBeacon works too.
export async function POST(request: Request) {
  const body = (await request
    .text()
    .then((t) => JSON.parse(t))
    .catch(() => null)) as { videoId?: unknown; position?: unknown; played?: unknown; source?: unknown } | null;
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  const position = Number(body?.position);
  const played = Number(body?.played);
  if (!UUID.test(videoId) || !Number.isFinite(position) || !Number.isFinite(played) || position < 0 || played < 0) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const source = isSource(body?.source) ? body.source : null;
  const result = await ping(videoId.toLowerCase(), Math.min(position, 1e6), Math.min(played, 1e6), source);
  if ("error" in result) {
    const status = engagementStatus(result.error);
    return Response.json(result, { status, headers: status === 429 ? { ...headers, "Retry-After": "60" } : headers });
  }
  return Response.json(result, { headers });
}
