import { isSubAction } from "@/lib/subscriptions/rules";
import { changeSubscription, mySubscriptions } from "@/lib/subscriptions/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const headers = { "Cache-Control": "no-store" };

function statusFor(code: string): number {
  switch (code) {
    case "not_signed_in":
      return 401;
    case "subscriptions_off":
    case "own_channel":
      return 403;
    case "not_found":
      return 404;
    case "not_subscribed":
      return 409;
    case "rate_limited":
      return 429;
    case "bad_request":
      return 400;
    default:
      return 503;
  }
}

// The signed in person's channels, for the guide and every Subscribe button:
// GET /api/subscriptions answers { channels }.
export async function GET() {
  const state = await mySubscriptions();
  if (state.kind === "ready") return Response.json({ channels: state.channels }, { headers });
  const code = { off: "subscriptions_off", "no-db": "no_db", "signed-out": "not_signed_in", "not-set-up": "not_set_up" }[state.kind];
  return Response.json({ error: code }, { status: statusFor(code), headers });
}

// POST /api/subscriptions { channelId, action: "subscribe" | "unsubscribe" | "notify", on }
// answers { subscribed, notify, count } with the channel's new subscriber count.
export async function POST(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const body = (await request.json().catch(() => null)) as { channelId?: unknown; action?: unknown; on?: unknown } | null;
  const channelId = typeof body?.channelId === "string" ? body.channelId : "";
  if (!UUID.test(channelId) || !isSubAction(body?.action) || (body.action === "notify" && typeof body.on !== "boolean")) {
    return Response.json({ error: "bad_request" }, { status: 400, headers });
  }
  const result = await changeSubscription(body.action, channelId.toLowerCase(), body.on === true);
  if ("error" in result) return Response.json(result, { status: statusFor(result.error), headers });
  return Response.json(result, { headers });
}
