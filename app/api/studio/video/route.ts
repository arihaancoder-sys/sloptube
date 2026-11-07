import { answer, badRequest, isUuid, readJson } from "@/lib/studio/http";
import { saveDetails } from "@/lib/studio/server";

const VISIBILITIES = new Set(["private", "unlisted", "public"]);

// POST /api/studio/video { videoId, title, description, visibility, tags }
// saves the edit page. Comments and the Snip choice have their own routes
// (/api/comments/settings and /api/shorts/choice).
export async function POST(request: Request) {
  const b = await readJson(request);
  if (
    !b ||
    !isUuid(b.videoId) ||
    typeof b.title !== "string" ||
    typeof b.description !== "string" ||
    !VISIBILITIES.has(String(b.visibility)) ||
    !Array.isArray(b.tags) ||
    !b.tags.every((t) => typeof t === "string")
  ) {
    return badRequest();
  }
  return answer(
    await saveDetails(b.videoId.toLowerCase(), {
      title: b.title,
      description: b.description,
      visibility: b.visibility as never,
      tags: b.tags as string[],
    }),
  );
}
