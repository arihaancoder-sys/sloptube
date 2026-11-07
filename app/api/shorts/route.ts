import { shortsPage, answer } from "@/lib/shorts/server";

// GET /api/shorts?cursor=<next> answers the next page of the shorts feed:
// { shorts, next }. The first page is rendered with /shorts itself.
export async function GET(request: Request) {
  const cursor = new URL(request.url).searchParams.get("cursor");
  if (cursor !== null && cursor.length > 300) return answer({ error: "bad_request" });
  return answer(await shortsPage(cursor || null));
}
