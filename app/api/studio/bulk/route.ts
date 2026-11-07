import { answer, badRequest, isUuid, readJson } from "@/lib/studio/http";
import { bulkChange, type BulkName } from "@/lib/studio/server";

const ACTIONS = new Set(["visibility", "trash", "restore"]);
const VISIBILITIES = new Set(["private", "unlisted", "public"]);

// POST /api/studio/bulk { ids, action: visibility | trash | restore, visibility? }
// answers { changed }. Only the caller's own videos; one id that is not
// refuses the whole call (not_allowed). See studio_bulk in 014_studio.sql.
export async function POST(request: Request) {
  const body = await readJson(request);
  if (!body || !Array.isArray(body.ids) || !body.ids.every(isUuid) || !ACTIONS.has(String(body.action))) return badRequest();
  const visibility = body.action === "visibility" ? body.visibility : null;
  if (body.action === "visibility" && !VISIBILITIES.has(String(visibility))) return badRequest();
  const ids = [...new Set((body.ids as string[]).map((id) => id.toLowerCase()))];
  return answer(await bulkChange(ids, body.action as BulkName, visibility as never));
}
