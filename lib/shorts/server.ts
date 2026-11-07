import "server-only";
import { cache } from "react";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { readPublicBase } from "@/lib/watch/media";
import { decodeShortsCursor, nextShortsCursor } from "./cursor";
import { SHELF_SIZE, SHORTS_PAGE_SIZE, shortsErrorCode, shortsStatus } from "./rules";
import { rowKey, rowToShort, type Short, type ShortRow, type ShortsPage } from "./types";

type Fail = { error: string };

const publicBase = () => readPublicBase(process.env.MEDIA_PUBLIC_URL);

/** Database codes for "the function is not there": migration 013 not applied. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : shortsErrorCode(error.message);
}

/** Is the shorts flag on for the person making this request? Reads the request. */
export async function shortsGate(): Promise<"no-db" | "off" | "on"> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  return (await flagOn("shorts", user?.id ?? null)) ? "on" : "off";
}

/** One page of list_shorts(). `cursor` is the previous page's `next`. */
export async function shortsPage(cursor: string | null, limit = SHORTS_PAGE_SIZE): Promise<ShortsPage | Fail> {
  const gate = await shortsGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "shorts_off" };
  const after = decodeShortsCursor(cursor);
  if (cursor && !after) return { shorts: [], next: null };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("list_shorts", {
    cursor: after ? { at: after.at, tier: after.tier, score: after.score, id: after.id } : null,
    lim: limit,
  });
  if (error) return { error: codeOf(error) };
  const rows = (Array.isArray(data) ? data : []) as ShortRow[];
  const base = publicBase();
  return { shorts: rows.map((r) => rowToShort(r, base)), next: nextShortsCursor(rows.map(rowKey), limit) };
}

export type ShortsState =
  | { kind: "off" }
  | { kind: "no-db" }
  | { kind: "not-set-up" }
  /** `start` is the short from /shorts/<id>, shown first. `now` is the server's clock. */
  | { kind: "ready"; start: Short | null; page: ShortsPage; now: number }
  /** /shorts/<id> for a video that is not a short: the page sends it to /watch. */
  | { kind: "not-a-short"; id: string }
  | { kind: "missing" };

/** What /shorts and /shorts/<id> start with. Call inside <Suspense>: it reads the request. */
// cache: generateMetadata and the page read the same state once per request.
export const shortsState = cache(async function shortsState(startId: string | null = null): Promise<ShortsState> {
  const gate = await shortsGate();
  if (gate !== "on") return { kind: gate };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };

  let start: Short | null = null;
  if (startId) {
    const { data, error } = await supabase.rpc("get_short", { video_id: startId });
    if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : { kind: "missing" };
    const row = (Array.isArray(data) ? data[0] : null) as ShortRow | null;
    if (!row) return { kind: "missing" };
    if (!row.is_short) return { kind: "not-a-short", id: row.id };
    start = rowToShort(row, publicBase());
  }

  const page = await shortsPage(null);
  if ("error" in page) {
    if (page.error === "not_set_up") return { kind: "not-set-up" };
    return { kind: "ready", start, page: { shorts: [], next: null }, now: Date.now() };
  }
  return { kind: "ready", start, page: { ...page, shorts: page.shorts.filter((s) => s.id !== start?.id) }, now: Date.now() };
});

/** The home shelf: the first shorts of the feed, or [] when the flag is off or anything fails. */
export async function shelfShorts(): Promise<Short[]> {
  const page = await shortsPage(null, SHELF_SIZE);
  return "error" in page ? [] : page.shorts;
}

/** The "Upload as a Snip" box, after the upload. Answers is_short. */
export async function setShortChoice(videoId: string, on: boolean): Promise<{ isShort: boolean } | Fail> {
  const gate = await shortsGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "shorts_off" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  const { data, error } = await supabase.rpc("set_short_choice", { video_id: videoId, on });
  if (error) return { error: codeOf(error) };
  return { isShort: data === true };
}

const headers = { "Cache-Control": "no-store" };

/** A route's JSON answer: the error code with its status, or the result. */
export function answer(result: object): Response {
  if ("error" in result && typeof result.error === "string") {
    return Response.json(result, { status: shortsStatus(result.error), headers });
  }
  return Response.json(result, { headers });
}
