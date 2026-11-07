import { answer, badRequest, isUuid, readJson } from "@/lib/moderation/http";
import { DETAILS_MAX } from "@/lib/moderation/rules";
import { appealRemoval } from "@/lib/moderation/server";

// POST /api/moderation/appeal { videoId, details } answers { id }. The owner of
// a removed video, once per removal. See appeal_removal in 016_moderation.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.videoId)) return badRequest();
  const details = typeof body.details === "string" ? body.details.trim() : "";
  if (details.length > DETAILS_MAX) return answer({ error: "details_too_long" });
  return answer(await appealRemoval(body.videoId.toLowerCase(), details));
}
