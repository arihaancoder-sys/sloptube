import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { evaluateFlag, isFlagMode } from "@/lib/flags-core";
import { FLAG_TTL_MS, maintenanceHtml, maintenanceOpen, RETRY_AFTER_S } from "@/lib/launch/maintenance";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { siteConfig } from "@/site.config";

const isAdminPath = (path: string) => path === "/admin" || path.startsWith("/admin/");

/**
 * /admin for anyone but an admin (feature 14): the plain 404 page, with a
 * real 404 status. A rewrite to a path no route answers gives exactly that.
 * The pages check again themselves.
 */
function hidden(request: NextRequest, keep?: NextResponse) {
  const url = request.nextUrl.clone();
  url.pathname = "/_not-an-admin-page";
  url.search = "";
  const out = NextResponse.rewrite(url, { status: 404 });
  // Keep refreshed session cookies.
  for (const c of keep?.cookies.getAll() ?? []) out.cookies.set(c);
  return out;
}

type FlagRow = { mode: string; users: string[] | null } | null;
type Db = ReturnType<typeof createServerClient>;

/**
 * The maintenance flag (feature 15), kept for a few seconds so a busy site
 * does not read it on every request. Flipping it takes effect within
 * FLAG_TTL_MS on every app server.
 */
let maintenanceFlag: { at: number; row: FlagRow } = { at: 0, row: null };
async function readMaintenance(supabase: Db): Promise<FlagRow> {
  if (Date.now() - maintenanceFlag.at < FLAG_TTL_MS) return maintenanceFlag.row;
  const { data, error } = await supabase.from("feature_flags").select("mode, users").eq("key", "maintenance").maybeSingle();
  // On an error keep the last answer, so a database hiccup does not flip the site.
  if (!error) maintenanceFlag = { at: Date.now(), row: (data as FlagRow) ?? null };
  return maintenanceFlag.row;
}

/** The static maintenance page, or a JSON 503 for the API. Keeps refreshed session cookies. */
function maintenance(request: NextRequest, keep: NextResponse) {
  const api = request.nextUrl.pathname.startsWith("/api/");
  const out = api
    ? NextResponse.json({ error: "maintenance" }, { status: 503 })
    : new NextResponse(maintenanceHtml(siteConfig.siteName), { status: 503, headers: { "content-type": "text/html; charset=utf-8" } });
  out.headers.set("Retry-After", String(RETRY_AFTER_S));
  out.headers.set("Cache-Control", "no-store");
  for (const c of keep.cookies.getAll()) out.cookies.set(c);
  return out;
}

/**
 * Runs before every page request and keeps the Supabase session fresh.
 * Server Components can read cookies but not write them, so an expired
 * access token is refreshed here and the new cookies go on the response.
 * This is the @supabase/ssr pattern, in Next 16's proxy.ts (formerly middleware).
 */
export async function proxy(request: NextRequest) {
  const config = readSupabaseConfig();
  const adminPath = isAdminPath(request.nextUrl.pathname);
  // Without a database, `next dev` shows a preview of /admin; production hides it.
  if (!config) return adminPath && process.env.NODE_ENV !== "development" ? hidden(request) : NextResponse.next();

  let response = NextResponse.next({ request });

  const supabase = createServerClient(config.url, config.key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Update the request so Server Components in this render see the new
        // tokens, and the response so the browser stores them.
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        // Responses that set auth cookies must never be cached.
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Validates the token and refreshes it when it is about to expire.
  // Do not put code between createServerClient and this call.
  const { data } = await supabase.auth.getClaims();

  // A banned account (feature 14) is signed out on its next page. Every API
  // request of a banned person answers "banned" (moderation_pre_request in
  // 016_moderation.sql), so one small read is enough to tell.
  if (data?.claims?.sub) {
    const { error } = await supabase.from("profiles").select("id").eq("id", data.claims.sub).maybeSingle();
    if (error?.message === "banned") {
      await supabase.auth.signOut({ scope: "local" });
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?banned=1";
      const out = NextResponse.redirect(url);
      for (const c of response.cookies.getAll()) out.cookies.set(c);
      out.headers.set("Cache-Control", "private, no-store");
      return out;
    }
  }

  // Maintenance mode (feature 15): everyone but admins gets the static page.
  // "test" puts only the listed people in maintenance, to try the page.
  if (!maintenanceOpen(request.nextUrl.pathname)) {
    const flag = await readMaintenance(supabase);
    const sub = (data?.claims?.sub as string | undefined) ?? null;
    if (flag && isFlagMode(flag.mode) && evaluateFlag({ mode: flag.mode, users: flag.users ?? [] }, sub)) {
      const admin = sub ? (await supabase.rpc("is_admin")).data === true : false;
      if (!admin) return maintenance(request, response);
    }
  }

  if (adminPath) {
    const sub = data?.claims?.sub;
    if (!sub) return hidden(request, response);
    const [{ data: flag }, { data: admin }] = await Promise.all([
      supabase.from("feature_flags").select("mode, users").eq("key", "moderation").maybeSingle(),
      supabase.rpc("is_admin"),
    ]);
    const on = flag && isFlagMode(flag.mode) && evaluateFlag({ mode: flag.mode, users: flag.users ?? [] }, sub);
    if (!on || admin !== true) return hidden(request, response);
  }

  return response;
}

export const config = {
  // Every page, but not static files, images or the health and version checks.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|api/version|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
