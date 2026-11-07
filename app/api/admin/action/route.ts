import { answer, badRequest, isUuid, readJson } from "@/lib/moderation/http";
import { actionNeedsReason, DETAILS_MAX, isAction, isTargetKind } from "@/lib/moderation/rules";
import { modAction } from "@/lib/moderation/server";

// POST /api/admin/action { action, targetKind, targetId, reason, kind: report | appeal }
// answers { closed, suspended }. Admins only: everyone else gets a 404.
// See mod_action in 016_moderation.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isAction(body.action) || !isTargetKind(body.targetKind) || !isUuid(body.targetId)) return badRequest();
  const kind = body.kind === "appeal" ? "appeal" : "report";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length > DETAILS_MAX) return answer({ error: "reason_too_long" });
  if (actionNeedsReason(body.action) && !reason) return answer({ error: "reason_required" });
  return answer(await modAction(body.action, body.targetKind, body.targetId.toLowerCase(), reason, kind));
}
