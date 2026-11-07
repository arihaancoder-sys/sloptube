import { answer, badRequest, isUuid } from "@/lib/comments/http";
import { listReplies } from "@/lib/comments/server";

// GET /api/comments/replies?parent=<comment>&cursor=<next> answers the replies
// under a comment, oldest first: { comments, next }.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const parent = q.get("parent");
  if (!isUuid(parent)) return badRequest();
  return answer(await listReplies(parent.toLowerCase(), q.get("cursor")));
}
