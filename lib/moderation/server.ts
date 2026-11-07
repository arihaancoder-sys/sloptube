import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { previewLog, previewQueue, previewSuspended, previewWords } from "./preview";
import { groupReports, rowToReport, type QueueGroup } from "./queue";
import { moderationErrorCode, type ModAction, type ReportKind, type ReportReason, type TargetKind } from "./rules";
import { rowToLog, rowToSuspended, rowToWord, type LogEntry, type SuspendedChannel, type Word } from "./types";

type Fail = { error: string };
type Db = NonNullable<Awaited<ReturnType<typeof createClient>>>;

/** "The function is not there": migration 016 not applied yet. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01" || code === "42703";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : moderationErrorCode(error.message);
}

/** No database: the admin pages show made up rows in `next dev`. */
const devPreview = () => process.env.NODE_ENV === "development";

/** Is moderation on for the person asking? Reads the request. */
export async function moderationOn(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return false;
  const user = await getCurrentUser();
  return flagOn("moderation", user?.id ?? null);
}

async function writer(): Promise<{ user: CurrentUser; supabase: Db } | Fail> {
  await connection();
  if (!readSupabaseConfig()) return { error: "no_db" };
  const user = await getCurrentUser();
  if (!(await flagOn("moderation", user?.id ?? null))) return { error: "moderation_off" };
  if (!user) return { error: "not_signed_in" };
  const supabase = await createClient();
  if (!supabase) return { error: "no_db" };
  return { user, supabase };
}

// Everyone signed in ----------------------------------------------------------------------

export async function reportTarget(kind: TargetKind, id: string, reason: ReportReason, details: string): Promise<{ id: string } | Fail> {
  const w = await writer();
  if ("error" in w) return w;
  const { data, error } = await w.supabase.rpc("report_target", { target_kind: kind, target_id: id, reason, details });
  return error ? { error: codeOf(error) } : { id: String(data) };
}

export async function appealRemoval(videoId: string, details: string): Promise<{ id: string } | Fail> {
  const w = await writer();
  if ("error" in w) return w;
  const { data, error } = await w.supabase.rpc("appeal_removal", { video_id: videoId, details });
  return error ? { error: codeOf(error) } : { id: String(data) };
}

export type ModerationStatus = { admin: boolean; suspended: boolean; strikes: number; nextStrikeExpiry: string | null };

/** The caller's standing, for the studio notice. Null when it cannot be read. */
export async function moderationStatus(): Promise<ModerationStatus | null> {
  const w = await writer();
  if ("error" in w) return null;
  const { data, error } = await w.supabase.rpc("moderation_status");
  if (error || !data) return null;
  const r = data as Record<string, unknown>;
  return {
    admin: r.admin === true,
    suspended: r.suspended === true,
    strikes: Number(r.strikes ?? 0) || 0,
    nextStrikeExpiry: (r.next_strike_expiry as string | null) ?? null,
  };
}

// Admins ------------------------------------------------------------------------------------

export type AdminGate = { kind: "admin"; user: CurrentUser; supabase: Db } | { kind: "preview" } | { kind: "hidden" };

/**
 * Admins only: the flag on and is_admin(). Everyone else gets "hidden" and
 * the page answers 404. Without a database, `next dev` shows a preview.
 */
export async function adminGate(): Promise<AdminGate> {
  await connection();
  if (!readSupabaseConfig()) return devPreview() ? { kind: "preview" } : { kind: "hidden" };
  const user = await getCurrentUser();
  if (!user || !(await flagOn("moderation", user.id))) return { kind: "hidden" };
  const supabase = await createClient();
  if (!supabase) return { kind: "hidden" };
  const { data, error } = await supabase.rpc("is_admin");
  if (error || data !== true) return { kind: "hidden" };
  return { kind: "admin", user, supabase };
}

/** The server's clock, so "2 hours ago" reads the same before and after hydration. */
export const serverNow = () => Date.now();

export async function adminQueue(gate: AdminGate): Promise<QueueGroup[] | Fail> {
  if (gate.kind === "preview") return groupReports(previewQueue());
  if (gate.kind !== "admin") return { error: "not_admin" };
  const { data, error } = await gate.supabase.rpc("admin_reports", { lim: 1000 });
  if (error) return { error: codeOf(error) };
  return groupReports(((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(rowToReport));
}

export async function adminSuspended(gate: AdminGate): Promise<SuspendedChannel[]> {
  if (gate.kind === "preview") return previewSuspended();
  if (gate.kind !== "admin") return [];
  const { data } = await gate.supabase.rpc("admin_suspended");
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(rowToSuspended);
}

export type FoundChannel = { id: string; handle: string; name: string; suspended: boolean };

/** A channel by handle, for the suspend box. */
export async function findChannel(gate: AdminGate, handle: string): Promise<FoundChannel | null> {
  const h = handle.trim().replace(/^@/, "");
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(h)) return null;
  if (gate.kind === "preview") return { id: "00000000-0000-4000-8000-0000000000c9", handle: h, name: h, suspended: false };
  if (gate.kind !== "admin") return null;
  const { data } = await gate.supabase.from("channels").select("id, handle, name, suspended_at").ilike("handle", h).maybeSingle();
  if (!data) return null;
  const r = data as { id: string; handle: string; name: string; suspended_at: string | null };
  return { id: r.id, handle: r.handle, name: r.name || r.handle, suspended: r.suspended_at !== null };
}

export async function adminLog(gate: AdminGate, before: string | null): Promise<LogEntry[] | Fail> {
  if (gate.kind === "preview") return previewLog();
  if (gate.kind !== "admin") return { error: "not_admin" };
  const { data, error } = await gate.supabase.rpc("admin_log", { before, lim: 50 });
  if (error) return { error: codeOf(error) };
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(rowToLog);
}

export async function adminWords(gate: AdminGate): Promise<Word[] | Fail> {
  if (gate.kind === "preview") return previewWords();
  if (gate.kind !== "admin") return { error: "not_admin" };
  const { data, error } = await gate.supabase.rpc("admin_words");
  if (error) return { error: codeOf(error) };
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(rowToWord);
}

/** For the routes: an admin, or the error the route answers with (404 for everyone else). */
async function adminWriter(): Promise<{ supabase: Db } | Fail> {
  const gate = await adminGate();
  if (gate.kind === "preview") return { error: "no_db" };
  if (gate.kind !== "admin") return { error: "not_admin" };
  return gate;
}

export type ActionResult = { closed: number; suspended: boolean };

export async function modAction(action: ModAction, targetKind: TargetKind, targetId: string, reason: string, kind: ReportKind): Promise<ActionResult | Fail> {
  const w = await adminWriter();
  if ("error" in w) return w;
  const { data, error } = await w.supabase.rpc("mod_action", { action, target_kind: targetKind, target_id: targetId, reason, kind });
  if (error) return { error: codeOf(error) };
  const r = (data ?? {}) as Record<string, unknown>;
  return { closed: Number(r.closed ?? 0) || 0, suspended: r.suspended === true };
}

export async function setWord(word: string, on: boolean): Promise<{ ok: true } | Fail> {
  const w = await adminWriter();
  if ("error" in w) return w;
  const { error } = await w.supabase.rpc("admin_set_word", { word, on });
  return error ? { error: codeOf(error) } : { ok: true };
}
