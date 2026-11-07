import { videoStatus } from "@/lib/processing/handler";
import { statusContext } from "@/lib/processing/server";

// Where a video is on its way to ready, for the studio and the /watch stub to
// poll. Owner only, never cached. See videoStatus in lib/processing/handler.ts.
export async function GET(_request: Request, ctx: RouteContext<"/api/videos/[id]/status">) {
  const { id } = await ctx.params;
  const result = await videoStatus(id, await statusContext());
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
