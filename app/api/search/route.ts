import { parseFilters, readQuery } from "@/lib/search/query";
import { searchVideos } from "@/lib/search/server";
import type { SearchPage } from "@/lib/search/types";

const headers = { "Cache-Control": "no-store" };

// The next page of video results for infinite scroll:
// GET /api/search?search_query=<q>&cursor=<next> plus the filters from the
// page URL (uploaded, type, duration, sort). Answers { videos, next }.
// The first page is rendered on the server with /results itself.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const q = readQuery(params);
  if (!q) return Response.json({ error: "bad_request" }, { status: 400, headers });
  const state = await searchVideos(q, parseFilters(params), params.get("cursor"));
  switch (state.kind) {
    case "off":
      return Response.json({ error: "search_off" }, { status: 403, headers });
    case "no-db":
      return Response.json({ error: "no_db" }, { status: 503, headers });
    case "not-set-up":
      return Response.json({ error: "not_set_up" }, { status: 503, headers });
    case "rate-limited":
      return Response.json({ error: "rate_limited" }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    case "failed":
      return Response.json({ error: "failed" }, { status: 503, headers });
    case "ready":
      return Response.json(state.page satisfies SearchPage, { headers });
  }
}
