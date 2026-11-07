import "server-only";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { decodeCursor, encodeCursor, nextCursor, type CursorValue } from "./cursor";
import { commentsErrorCode, PAGE_SIZE, REPLIES_PAGE_SIZE, STUDIO_LIMIT, type CommentSort, type CommentsMode } from "./rules";
import {
  rowToComment,
  rowToStudioComment,
  toMode,
  type Comment,
  type CommentRow,
  type CommentsInitial,
  type CommentsPage,
  type StudioComment,
  type StudioRow,
} from "./types";

type Gate = "no-db" | "off" | { userId: string | null };
type Fail = { error: string };

/** Database codes for "the function or table is not there": migration 012 not applied. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : commentsErrorCode(error.message);
}

const rows = (data: unknown) => (Array.isArray(data) ? (data as CommentRow[]) : []);
const asJson = (c: CursorValue | null) => (c ? { likes: c.likes, at: c.at, id: c.id } : null);

/** Is the comments flag on, and who is asking? Reads the request: call it inside <Suspense> or a route. */
export async function commentsGate(): Promise<Gate> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  if (!(await flagOn("comments", user?.id ?? null))) return "off";
  return { userId: user?.id ?? null };
}

async function client(needUser: boolean): Promise<{ supabase: NonNullable<Awaited<ReturnType<typeof createClient>>>; userId: string | null } | Fail> {
  const gate = await commentsGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "comments_off" };
  if (needUser && !gate.userId) return { error: "not_signed_in" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  return { supabase, userId: gate.userId };
}

type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

async function topPage(supabase: Db, videoId: string, sort: CommentSort, cursor: string | null): Promise<CommentsPage | Fail> {
  const after = decodeCursor(sort, cursor);
  if (cursor && !after) return { comments: [], next: null };
  const { data, error } = await supabase.rpc("list_comments", { video_id: videoId, sort, cursor: asJson(after), lim: PAGE_SIZE });
  if (error) return { error: codeOf(error) };
  const list = rows(data).map(rowToComment);
  // The pinned comment rides along on the first page and is not part of the keyset.
  const paged = list.filter((c) => !c.pinned || cursor);
  return { comments: list, next: nextCursor(sort, paged, PAGE_SIZE) };
}

/** The newest top level comment, so the poll only asks for what comes after. */
async function sinceNow(supabase: Db, videoId: string): Promise<string | null> {
  const { data } = await supabase.rpc("comments_since", { video_id: videoId, cursor: null, lim: 1 });
  const row = rows(data)[0];
  return row ? encodeCursor("since", { likes: 0, createdAt: row.created_at, id: row.id }) : null;
}

/**
 * What the watch page's comments section starts with, or null when the flag
 * is off, there is no database, or migration 012 is not there yet (the
 * section then stays hidden).
 */
export async function commentsFor(videoId: string): Promise<CommentsInitial | null> {
  const c = await client(false);
  if ("error" in c) return null;
  const { supabase, userId } = c;
  const { data, error } = await supabase.rpc("comments_info", { video_id: videoId });
  if (error) return null;
  const info = (Array.isArray(data) ? data[0] : null) as { comment_count: number | string; mode: string; is_owner: boolean } | null;
  if (!info) return null;
  const mode = toMode(info.mode);
  const [page, since] =
    mode === "off" ? [{ comments: [], next: null }, null] : await Promise.all([topPage(supabase, videoId, "top", null), sinceNow(supabase, videoId)]);
  return {
    count: Number(info.comment_count) || 0,
    mode,
    isOwner: info.is_owner === true,
    signedIn: userId !== null,
    sort: "top",
    page: "error" in page ? { comments: [], next: null } : page,
    since,
    now: Date.now(),
  };
}

export async function listComments(videoId: string, sort: CommentSort, cursor: string | null): Promise<CommentsPage | Fail> {
  const c = await client(false);
  if ("error" in c) return c;
  return topPage(c.supabase, videoId, sort, cursor);
}

/** Top level comments newer than `since`, newest first, for the pill. */
export async function commentsSince(videoId: string, since: string | null): Promise<{ comments: Comment[] } | Fail> {
  const c = await client(false);
  if ("error" in c) return c;
  const after = decodeCursor("since", since);
  if (since && !after) return { comments: [] };
  const { data, error } = await c.supabase.rpc("comments_since", { video_id: videoId, cursor: asJson(after), lim: 50 });
  if (error) return { error: codeOf(error) };
  return { comments: rows(data).map(rowToComment) };
}

export async function listReplies(parentId: string, cursor: string | null): Promise<CommentsPage | Fail> {
  const c = await client(false);
  if ("error" in c) return c;
  const after = decodeCursor("replies", cursor);
  if (cursor && !after) return { comments: [], next: null };
  const { data, error } = await c.supabase.rpc("list_replies", { parent_id: parentId, cursor: asJson(after), lim: REPLIES_PAGE_SIZE });
  if (error) return { error: codeOf(error) };
  const list = rows(data).map(rowToComment);
  return { comments: list, next: nextCursor("replies", list, REPLIES_PAGE_SIZE) };
}

async function one(call: PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>): Promise<{ comment: Comment } | Fail> {
  const { data, error } = await call;
  if (error) return { error: codeOf(error) };
  const row = rows(data)[0];
  return row ? { comment: rowToComment(row) } : { error: "not_found" };
}

export async function postComment(videoId: string, body: string, parentId: string | null): Promise<{ comment: Comment } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  return one(c.supabase.rpc("post_comment", { video_id: videoId, body, parent_id: parentId }));
}

export async function editComment(id: string, body: string): Promise<{ comment: Comment } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  return one(c.supabase.rpc("edit_comment", { comment_id: id, body }));
}

export async function deleteComment(id: string): Promise<{ ok: true } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  const { error } = await c.supabase.rpc("delete_comment", { comment_id: id });
  return error ? { error: codeOf(error) } : { ok: true };
}

export async function likeComment(id: string, on: boolean): Promise<{ liked: boolean; likes: number } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  const { data, error } = await c.supabase.rpc("like_comment", { comment_id: id, on });
  if (error) return { error: codeOf(error) };
  const row = (Array.isArray(data) ? data[0] : null) as { liked: boolean; like_count: number | string } | null;
  return row ? { liked: row.liked === true, likes: Number(row.like_count) || 0 } : { error: "not_found" };
}

export type ModerateAction = "pin" | "unpin" | "heart" | "unheart";

export async function moderateComment(id: string, action: ModerateAction): Promise<{ ok: true } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  const fn = action === "pin" || action === "unpin" ? "pin_comment" : "heart_comment";
  const { error } = await c.supabase.rpc(fn, { comment_id: id, on: action === "pin" || action === "heart" });
  return error ? { error: codeOf(error) } : { ok: true };
}

/** The channel's default mode for its videos, or one video's own mode (null follows the channel). */
export async function setCommentsMode(mode: CommentsMode | null, videoId: string | null): Promise<{ mode: CommentsMode } | Fail> {
  const c = await client(true);
  if ("error" in c) return c;
  const { data, error } = videoId
    ? await c.supabase.rpc("set_comments_mode", { video_id: videoId, mode })
    : await c.supabase.rpc("set_channel_comments_default", { mode });
  return error ? { error: codeOf(error) } : { mode: toMode(data) };
}

export type StudioCommentsState =
  | { kind: "off" | "no-db" | "signed-out" | "not-set-up" }
  | { kind: "ready"; comments: StudioComment[]; channelDefault: CommentsMode; now: number };

/** /studio/comments: the latest comments on the signed in person's videos. */
export async function studioComments(): Promise<StudioCommentsState> {
  const gate = await commentsGate();
  if (typeof gate === "string") return { kind: gate };
  if (!gate.userId) return { kind: "signed-out" };
  const supabase = await createClient();
  if (!supabase) return { kind: "no-db" };
  const { data, error } = await supabase.rpc("studio_comments", { lim: STUDIO_LIMIT });
  if (error) return notSetUp(error.code) ? { kind: "not-set-up" } : { kind: "ready", comments: [], channelDefault: "on", now: Date.now() };
  const list = (Array.isArray(data) ? data : []) as StudioRow[];
  let channelDefault = list[0]?.channel_default ?? null;
  if (channelDefault === null) {
    const { data: ch } = await supabase.from("channels").select("comments_default").eq("owner_id", gate.userId).maybeSingle();
    channelDefault = (ch as { comments_default?: string } | null)?.comments_default ?? "on";
  }
  return { kind: "ready", comments: list.map(rowToStudioComment), channelDefault: toMode(channelDefault), now: Date.now() };
}
