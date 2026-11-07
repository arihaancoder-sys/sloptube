import { answer, badRequest, isUuid, readJson } from "@/lib/moderation/http";
import { isTargetKind, reportProblem, type ReportReason } from "@/lib/moderation/rules";
import { reportTarget } from "@/lib/moderation/server";

// POST /api/moderation/report { targetKind: video | comment | channel, targetId, reason, details }
// answers { id }. One report per person per target, 10 a day. See report_target in 016_moderation.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isTargetKind(body.targetKind) || !isUuid(body.targetId)) return badRequest();
  const details = typeof body.details === "string" ? body.details : "";
  const problem = reportProblem(typeof body.reason === "string" ? body.reason : null, details);
  if (problem) return answer({ error: problem });
  return answer(await reportTarget(body.targetKind, body.targetId.toLowerCase(), body.reason as ReportReason, details.trim()));
}
