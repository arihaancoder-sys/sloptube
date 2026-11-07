import { answer, badRequest, isUuid, readJson } from "@/lib/comments/http";
import { BODY_MAX, isSort } from "@/lib/comments/rules";
import { commentsSince, deleteComment, editComment, listComments, postComment } from "@/lib/comments/server";

// GET /api/comments?v=<video>&sort=top|newest&cursor=<next> answers the next
//   page of top level comments: { comments, next }.
// GET /api/comments?v=<video>&since=<cursor> answers the top level comments
//   newer than the cursor, newest first, for the "new comments" pill:
//   { comments }. Without since it answers the newest ones.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const v = q.get("v");
  const sort = q.get("sort") ?? "top";
  if (!isUuid(v) || !isSort(sort)) return badRequest();
  if (q.has("since")) return answer(await commentsSince(v.toLowerCase(), q.get("since") || null));
  return answer(await listComments(v.toLowerCase(), sort, q.get("cursor")));
}

// POST /api/comments { videoId, body, parentId? } posts a comment or a reply
// and answers { comment }.
export async function POST(request: Request) {
  const body = await readJson(request);
  const parentId = body?.parentId ?? null;
  if (!body || !isUuid(body.videoId) || typeof body.body !== "string" || body.body.length > BODY_MAX * 4) return badRequest();
  if (parentId !== null && !isUuid(parentId)) return badRequest();
  return answer(await postComment(body.videoId.toLowerCase(), body.body, parentId ? parentId.toLowerCase() : null));
}

// PATCH /api/comments { id, body } edits the person's own comment: { comment }.
export async function PATCH(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.id) || typeof body.body !== "string" || body.body.length > BODY_MAX * 4) return badRequest();
  return answer(await editComment(body.id.toLowerCase(), body.body));
}

// DELETE /api/comments { id } deletes a comment (the author, or the video's owner).
export async function DELETE(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.id)) return badRequest();
  return answer(await deleteComment(body.id.toLowerCase()));
}
