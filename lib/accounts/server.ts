import "server-only";
import { connection } from "next/server";
import { getCurrentUser, type CurrentUser } from "@/lib/auth";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";

export type AccountsState =
  | { kind: "no-db" }
  | { kind: "off" }
  | { kind: "ready"; user: CurrentUser | null };

/**
 * What the account pages should show for this request:
 * the database is not connected, the accounts flag is off, or ready.
 * Reads the request, so call it inside a <Suspense> boundary.
 */
export async function accountsState(): Promise<AccountsState> {
  await connection();
  if (!readSupabaseConfig()) return { kind: "no-db" };
  const user = await getCurrentUser();
  if (!(await flagOn("accounts", user?.id ?? null))) return { kind: "off" };
  return { kind: "ready", user };
}
