import { commentsFor } from "@/lib/comments/server";
import { answer, shortsGate } from "@/lib/shorts/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET /api/shorts/comments?v=<video> answers what the comments sheet on
// /shorts starts with: the same first page the watch page renders (feature
// 10), as { comments }. comments is null while the comments flag is off.
export async function GET(request: Request) {
  const v = new URL(request.url).searchParams.get("v");
  if (!v || !UUID.test(v)) return answer({ error: "bad_request" });
  const gate = await shortsGate();
  if (gate === "no-db") return answer({ error: "no_db" });
  if (gate === "off") return answer({ error: "shorts_off" });
  return answer({ comments: await commentsFor(v.toLowerCase()) });
}
