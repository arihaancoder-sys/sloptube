import { engagementStatus } from "@/lib/engagement/rules";
import { changeHistory, historyPage } from "@/lib/engagement/server";
import type { HistoryPage } from "@/lib/engagement/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

const codes = { off: "engagement_off", "no-db": "no_db", "signed-out": "not_signed_in", "not-set-up": "not_set_up" } as const;

// The next page of /feed/history for infinite scroll:
// GET /api/history?cursor=<next> answers { cards, next }.
export async function GET(request: Request) {
  const state = await historyPage(new URL(request.url).searchParams.get("cursor"));
  if (state.kind === "ready") return Response.json(state.page satisfies HistoryPage, { headers });
  const code = codes[state.kind];
  return Response.json({ error: code }, { status: engagementStatus(code), headers });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const body = await request.json().catch(() => null);
  return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
}

// DELETE /api/history {} clears everything; { videoId } removes one video.
export async function DELETE(request: Request) {
  const body = (await readJson(request)) ?? {};
  const videoId = body.videoId;
  if (videoId !== undefined && (typeof videoId !== "string" || !UUID.test(videoId))) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await changeHistory(typeof videoId === "string" ? { kind: "remove", videoId: videoId.toLowerCase() } : { kind: "clear" });
  if ("error" in result) return Response.json(result, { status: engagementStatus(result.error), headers });
  return Response.json(result, { headers });
}

// POST /api/history { paused: true | false } pauses or turns history back on.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (typeof body?.paused !== "boolean") return Response.json({ error: "bad_request" }, { status: 400, headers });
  const result = await changeHistory({ kind: "pause", on: body.paused });
  if ("error" in result) return Response.json(result, { status: engagementStatus(result.error), headers });
  return Response.json(result, { headers });
}
