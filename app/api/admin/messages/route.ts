import { answer, badRequest, isUuid, readJson } from "@/lib/launch/http";
import { markMessage } from "@/lib/launch/server";

// POST /api/admin/messages { id, handled } marks a contact message handled
// (or open again). Admins only: everyone else gets a 404.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !isUuid(body.id)) return badRequest();
  return answer(await markMessage(body.id.toLowerCase(), body.handled !== false));
}
