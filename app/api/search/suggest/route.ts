import { normalizeQuery } from "@/lib/search/query";
import { searchSuggest } from "@/lib/search/server";

const headers = { "Cache-Control": "no-store" };

// Suggestions for the search box: GET /api/search/suggest?q=<typed so far>
// answers { suggestions: string[] } (up to ten, lower case). 503 without the
// database, 403 with the search flag off, 429 when typing very fast.
export async function GET(request: Request) {
  const q = normalizeQuery(new URL(request.url).searchParams.get("q"));
  const state = await searchSuggest(q);
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
      return Response.json({ suggestions: state.suggestions }, { headers });
  }
}
