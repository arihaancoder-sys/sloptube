import { feedState } from "@/lib/feed/server";
import { isFeedKind, type FeedPage } from "@/lib/feed/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The next page for infinite scroll: GET /api/feed?kind=newest&cursor=<next>
// (and &channel=<id> for kind=channel and kind=channel_shorts). Answers { cards, next }.
// The first page is rendered on the server with the page itself.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const kind = url.searchParams.get("kind") ?? "newest";
  const channel = url.searchParams.get("channel");
  const headers = { "Cache-Control": "no-store" };
  if (!isFeedKind(kind) || ((kind === "channel" || kind === "channel_shorts") && !(channel && UUID.test(channel)))) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const state = await feedState(kind, { cursor: url.searchParams.get("cursor"), channelId: channel?.toLowerCase() ?? null });
  switch (state.kind) {
    case "off":
      return Response.json({ error: "feed_off" }, { status: 403, headers });
    case "no-db":
      return Response.json({ error: "no_db" }, { status: 503, headers });
    case "not-set-up":
      return Response.json({ error: "not_set_up" }, { status: 503, headers });
    case "ready":
      return Response.json(state.page satisfies FeedPage, { headers });
  }
}
