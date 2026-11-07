import { flagPanelStatus } from "@/lib/flag-panel";
import { setFlag } from "@/lib/flag-panel-server";
import { readJson } from "@/lib/studio/http";

const noStore = { "Cache-Control": "no-store" };

// POST /api/admin/flags { key, mode } flips one feature flag through
// set_feature_flag (migration 020). Admins only: everyone else gets a 404.
// Answers { mode, mine } for the row as it is now.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || typeof body.key !== "string" || typeof body.mode !== "string") {
    return Response.json({ error: "bad_request" }, { status: 400, headers: noStore });
  }
  const result = await setFlag(body.key, body.mode);
  if ("error" in result) return Response.json(result, { status: flagPanelStatus(result.error), headers: noStore });
  return Response.json(result, { headers: noStore });
}
