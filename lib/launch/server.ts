import "server-only";
import { headers } from "next/headers";
import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { adminGate } from "@/lib/moderation/server";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";
import { cleanContact, launchErrorCode, type ContactInput, type ContactTopic } from "./rules";

type Fail = { error: string };

/** "The function is not there": migration 017 not applied yet. */
function notSetUp(code: string | undefined) {
  return code === "PGRST202" || code === "42883" || code === "PGRST205" || code === "42P01";
}

function codeOf(error: { code?: string; message?: string }): string {
  return notSetUp(error.code) ? "not_set_up" : launchErrorCode(error.message);
}

/** Is the launch flag on for the person asking? Reads the request. */
export async function launchGate(): Promise<"no-db" | "off" | "on"> {
  await connection();
  if (!readSupabaseConfig()) return "no-db";
  const user = await getCurrentUser();
  return (await flagOn("launch", user?.id ?? null)) ? "on" : "off";
}

/**
 * The visitor's address as the reverse proxy in front of the app saw it, for
 * the 5 a day cap. The database keeps only a hash of it.
 */
async function clientAddress(): Promise<string | null> {
  const h = await headers();
  const first = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim();
  return first && first.length <= 64 && /^[0-9a-fA-F:.]+$/.test(first) ? first : null;
}

export async function sendContact(input: ContactInput): Promise<{ id: string } | Fail> {
  const gate = await launchGate();
  if (gate === "no-db") return { error: "no_db" };
  if (gate === "off") return { error: "launch_off" };
  const address = await clientAddress();
  const supabase = await createClient(address ? { headers: { "x-contact-client": address } } : {});
  if (!supabase) return { error: "no_db" };
  const m = cleanContact(input);
  const { data, error } = await supabase.rpc("contact_send", { name: m.name, email: m.email, topic: m.topic, body: m.body });
  return error ? { error: codeOf(error) } : { id: String(data) };
}

export type ContactMessage = {
  id: string;
  name: string;
  email: string;
  topic: ContactTopic;
  body: string;
  createdAt: string;
  handledAt: string | null;
  senderHandle: string | null;
};

function rowToMessage(r: Record<string, unknown>): ContactMessage {
  return {
    id: String(r.id),
    name: String(r.name ?? ""),
    email: String(r.email ?? ""),
    topic: (r.topic as ContactTopic) ?? "general",
    body: String(r.body ?? ""),
    createdAt: String(r.created_at),
    handledAt: r.handled_at ? String(r.handled_at) : null,
    senderHandle: r.sender_handle ? String(r.sender_handle) : null,
  };
}

/** Made up messages for /admin/messages in `next dev` without a database. */
function previewMessages(includeHandled: boolean): ContactMessage[] {
  const now = Date.now();
  const all: ContactMessage[] = [
    { id: "m1", name: "Sample Reporter", email: "press@example.com", topic: "press", body: "Hi, I write about open source video tools and would love a few screenshots and a short quote for a piece next week.", createdAt: new Date(now - 2 * 3600_000).toISOString(), handledAt: null, senderHandle: null },
    { id: "m2", name: "Pat Viewer", email: "pat@example.com", topic: "bug", body: "The player keeps my volume at zero after I mute and reload. Is that on purpose?", createdAt: new Date(now - 26 * 3600_000).toISOString(), handledAt: null, senderHandle: "patviews" },
    { id: "m3", name: "Alex", email: "alex@example.com", topic: "general", body: "Thanks for building this in the open, the videos are great.", createdAt: new Date(now - 5 * 86400_000).toISOString(), handledAt: new Date(now - 4 * 86400_000).toISOString(), senderHandle: null },
  ];
  return includeHandled ? all : all.filter((m) => !m.handledAt);
}

export type MessagesGate =
  | { kind: "hidden" }
  | { kind: "off"; preview: boolean }
  | { kind: "ready"; preview: boolean; messages: ContactMessage[] }
  | { kind: "error"; preview: boolean; code: string };

/** /admin/messages: admins only (404 for everyone else), the launch flag on. */
export async function adminMessages(includeHandled: boolean): Promise<MessagesGate> {
  const gate = await adminGate();
  if (gate.kind === "hidden") return { kind: "hidden" };
  if (gate.kind === "preview") return { kind: "ready", preview: true, messages: previewMessages(includeHandled) };
  if (!(await flagOn("launch", gate.user.id))) return { kind: "off", preview: false };
  const { data, error } = await gate.supabase.rpc("admin_contact_messages", { include_handled: includeHandled, lim: 200 });
  if (error) return { kind: "error", preview: false, code: codeOf(error) };
  return { kind: "ready", preview: false, messages: ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map(rowToMessage) };
}

export async function markMessage(id: string, handled: boolean): Promise<{ ok: true } | Fail> {
  const gate = await adminGate();
  if (gate.kind !== "admin") return { error: "not_admin" };
  if (!(await flagOn("launch", gate.user.id))) return { error: "launch_off" };
  const { error } = await gate.supabase.rpc("admin_contact_mark", { id, handled });
  return error ? { error: codeOf(error) } : { ok: true };
}
