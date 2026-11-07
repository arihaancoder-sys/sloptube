import { answer, badRequest, isUuid, readJson } from "@/lib/comments/http";
import { moderateComment, type ModerateAction } from "@/lib/comments/server";

const ACTIONS: ModerateAction[] = ["pin", "unpin", "heart", "unheart"];

// POST /api/comments/moderate { id, action: pin | unpin | heart | unheart }.
// Only the video's owner; the database checks.
export async function POST(request: Request) {
  const body = await readJson(request);
  const action = body?.action as ModerateAction;
  if (!body || !isUuid(body.id) || !ACTIONS.includes(action)) return badRequest();
  return answer(await moderateComment(body.id.toLowerCase(), action));
}
