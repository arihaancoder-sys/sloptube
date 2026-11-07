import { answer, setShortChoice } from "@/lib/shorts/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// POST /api/shorts/choice { videoId, on } saves the upload page's "Upload as
// a Snip" box and answers { isShort }. Only the uploader; on = true is
// refused (not_a_short) once a processed video turns out not to qualify.
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return answer({ error: "bad_request" });
  const body = (await request.json().catch(() => null)) as { videoId?: unknown; on?: unknown } | null;
  const videoId = typeof body?.videoId === "string" ? body.videoId : "";
  if (!UUID.test(videoId) || typeof body?.on !== "boolean") return answer({ error: "bad_request" });
  return answer(await setShortChoice(videoId.toLowerCase(), body.on));
}
