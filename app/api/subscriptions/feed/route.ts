import type { FeedPage } from "@/lib/feed/types";
import { notificationsFeed, subscriptionsFeed } from "@/lib/subscriptions/server";

// The next page of /feed/subscriptions: GET /api/subscriptions/feed?cursor=<next>.
// With ?notify=1 it answers the notifications menu instead: the last 20
// uploads from channels with the bell on. Answers { cards, next }.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const headers = { "Cache-Control": "no-store" };
  const state =
    url.searchParams.get("notify") === "1" ? await notificationsFeed() : await subscriptionsFeed({ cursor: url.searchParams.get("cursor") });
  switch (state.kind) {
    case "off":
      return Response.json({ error: "subscriptions_off" }, { status: 403, headers });
    case "signed-out":
      return Response.json({ error: "not_signed_in" }, { status: 401, headers });
    case "no-db":
      return Response.json({ error: "no_db" }, { status: 503, headers });
    case "not-set-up":
      return Response.json({ error: "not_set_up" }, { status: 503, headers });
    case "ready":
      return Response.json(state.page satisfies FeedPage, { headers });
  }
}
