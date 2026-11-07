import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { decodeCursor, encodeCursor } from "@/lib/feed/cursor";
import { rowToCard, type FeedPage, type FeedRow } from "@/lib/feed/types";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { subErrorCode, type SubAction } from "./rules";
import { rowToGuideChannel, type GuideChannel, type MySubscriptionRow, type SubResult } from "./types";
import { NOTIFICATION_COUNT } from "./unread";

/** Cards per page on /feed/subscriptions. */
export const SUBS_PAGE_SIZE = 24;

type Gate = "no-db" | "off" | "signed-out" | { userId: string };

/** Database codes for "the function or table is not there": migration 009 not applied. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01";
}

/**
 * Is the subscriptions flag on, and who is asking? Reads the request, so call
 * it inside <Suspense> or a route. The flag is checked before the session, so
 * signed out people see the flag off page while it is off.
 */
export async function subscriptionsGate(): Promise<Gate> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  if (!(await flagOn("subscriptions", user?.id ?? null))) return "off";
  if (!user) return "signed-out";
  return { userId: user.id };
}

export type SubsFeedState =
  | { kind: "off" }
  | { kind: "no-db" }
  | { kind: "signed-out" }
  | { kind: "not-set-up" }
  | { kind: "ready"; page: FeedPage; now: number };

/**
 * One page of uploads from the person's subscriptions, newest first.
 * `onlyNotify` keeps the channels with the bell on (the notifications menu).
 */
export async function subscriptionsFeed(
  opts: { cursor?: string | null; onlyNotify?: boolean; limit?: number } = {},
): Promise<SubsFeedState> {
  const gate = await subscriptionsGate();
  if (typeof gate === "string") return { kind: gate };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  const empty = { kind: "ready" as const, page: { cards: [], next: null }, now: Date.now() };
  const limit = Math.min(Math.max(opts.limit ?? SUBS_PAGE_SIZE, 1), 50);
  const cursor = decodeCursor(opts.cursor);
  if (opts.cursor && !cursor) return empty;

  const { data, error } = await supabase.rpc("subscriptions_feed", {
    cursor: cursor?.publishedAt ?? null,
    cursor_id: cursor?.id ?? null,
    lim: limit,
    only_notify: opts.onlyNotify === true,
  });
  if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : empty;

  const rows = (Array.isArray(data) ? data : []) as FeedRow[];
  const publicBase = readPublicBase(process.env.MEDIA_PUBLIC_URL);
  const last = rows[rows.length - 1];
  return {
    kind: "ready",
    page: {
      cards: rows.map((r) => rowToCard(r, publicBase)),
      next: last && rows.length === limit ? encodeCursor({ publishedAt: last.published_at, id: last.id }) : null,
    },
    now: Date.now(),
  };
}

/** The notifications menu: the last uploads from channels with the bell on. */
export function notificationsFeed() {
  return subscriptionsFeed({ onlyNotify: true, limit: NOTIFICATION_COUNT });
}

export type MySubsState =
  | { kind: "off" | "no-db" | "signed-out" | "not-set-up" }
  | { kind: "ready"; channels: GuideChannel[] };

/** The guide's list, which also tells every Subscribe button on the page its state. */
export async function mySubscriptions(): Promise<MySubsState> {
  const gate = await subscriptionsGate();
  if (typeof gate === "string") return { kind: gate };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.rpc("my_subscriptions");
  if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : { kind: "ready", channels: [] };
  return { kind: "ready", channels: ((Array.isArray(data) ? data : []) as MySubscriptionRow[]).map(rowToGuideChannel) };
}

/** Subscribe, unsubscribe or the bell. Answers the new state or an error code. */
export async function changeSubscription(
  action: SubAction,
  channelId: string,
  on: boolean,
): Promise<SubResult | { error: string }> {
  const gate = await subscriptionsGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "subscriptions_off" };
  if (gate === "signed-out") return { error: "not_signed_in" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };

  const call =
    action === "subscribe"
      ? supabase.rpc("subscribe", { channel_id: channelId })
      : action === "unsubscribe"
        ? supabase.rpc("unsubscribe", { channel_id: channelId })
        : supabase.rpc("set_notify", { channel_id: channelId, on });
  const { data, error } = await call;
  if (error) return { error: notSetUp(error.code) ? "not_set_up" : subErrorCode(error.message) };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { subscribed: boolean; notify: boolean; subscriber_count: number | null }
    | undefined;
  if (!row) return { error: action === "unsubscribe" ? "not_found" : "failed" };
  return { subscribed: row.subscribed === true, notify: row.notify === true, count: Number(row.subscriber_count) || 0 };
}
