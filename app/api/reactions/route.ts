import { engagementStatus, isReaction } from "@/lib/engagement/rules";
import { react } from "@/lib/engagement/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

// POST /api/reactions { videoId, kind: "like" | "dislike" | null } sets the
// person's reaction (null clears it) and answers { reaction, likes, dislikes }.
// dislikes is null unless the person owns the video.
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const body = (await request.json().catch(() => null)) as { videoId?: unknown; kind?: unknown } | null;
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!UUID.test(videoId) || !(body?.kind === null || isReaction(body?.kind))) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await react(videoId.toLowerCase(), body.kind);
  if ("error" in result) return Response.json(result, { status: engagementStatus(result.error), headers });
  return Response.json(result, { headers });
}
