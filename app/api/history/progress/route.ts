import { engagementStatus, PROGRESS_BATCH } from "@/lib/engagement/rules";
import { progressFor } from "@/lib/engagement/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

// The red bars under thumbnails: POST /api/history/progress { ids: [...] }
// (at most 100) answers { progress: { <id>: 0 to 1 } }. Signed out: {}.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? body.ids : null;
  if (!ids || ids.length > PROGRESS_BATCH || !ids.every((id) => typeof id === "string" && UUID.test(id))) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await progressFor([...new Set((ids as string[]).map((id) => id.toLowerCase()))]);
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: engagementStatus(result.error), headers });
  }
  return Response.json({ progress: result }, { headers });
}
