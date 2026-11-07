import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/accounts/redirect";
import { createClient } from "@/lib/supabase/server";

/**
 * Where Supabase sends people back after Google sign in or after they open
 * the confirmation email. Swaps the one time code for a session cookie, then
 * goes to /welcome until sign up is complete, or to ?next= after that.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNext(params.get("next"));
  const origin = publicOrigin(request);
  const fail = NextResponse.redirect(new URL("/login?error=callback", origin));

  const code = params.get("code");
  const supabase = await createClient();
  if (!code || !supabase) return fail;

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return fail;

  const { data: profile } = await supabase
    .from("profiles")
    .select("onboarded")
    .eq("id", data.user.id)
    .maybeSingle();

  const target = profile?.onboarded ? next : `/welcome?next=${encodeURIComponent(next)}`;
  return NextResponse.redirect(new URL(target, origin));
}

/** The address people used, also behind a reverse proxy such as Caddy. */
function publicOrigin(request: NextRequest) {
  const host = request.headers.get("x-forwarded-host");
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  return `${proto.split(",")[0].trim()}://${host.split(",")[0].trim()}`;
}
