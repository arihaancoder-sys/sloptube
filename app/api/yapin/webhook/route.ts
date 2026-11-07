import { badRequest, readJson } from "@/lib/studio/http";
import { webhookProblem, yapinStatus } from "@/lib/yapin/rules";
import { announcements, setWebhook } from "@/lib/yapin/server";

const noStore = { "Cache-Control": "no-store" };

function answer<T extends object>(result: T | { error: string }) {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: yapinStatus(result.error), headers: noStore });
  }
  return Response.json(result, { headers: noStore });
}

// GET /api/yapin/webhook answers { connected, hint, posts }: the caller's
// channel webhook (only its last 4 characters) and its announcements.
export async function GET() {
  return answer(await announcements());
}

// POST /api/yapin/webhook { url } answers { connected, hint }. An empty url
// disconnects. The URL is never sent back. See set_yapin_webhook in 018.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || (typeof body.url !== "string" && body.url !== null)) return badRequest();
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const problem = webhookProblem(url);
  if (problem) return answer({ error: problem });
  return answer(await setWebhook(url));
}
