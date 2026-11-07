import { answer, badRequest, isUuid, readJson } from "@/lib/comments/http";
import { likeComment } from "@/lib/comments/server";

// POST /api/comments/like { id, on: true | false } likes or unlikes a comment
// and answers { liked, likes }.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.id) || typeof body.on !== "boolean") return badRequest();
  return answer(await likeComment(body.id.toLowerCase(), body.on));
}
