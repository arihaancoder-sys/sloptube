import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/lib/accounts/redirect";
import { getCurrentUser } from "@/lib/auth";
import { authorizeUrl } from "@/lib/yapin/oauth";
import { challengeFor, createVerifier, randomToken } from "@/lib/yapin/pkce";
import { redirectUriFor, yapinSignIn } from "@/lib/yapin/server";
import { sealState, STATE_COOKIE, STATE_COOKIE_PATH, STATE_TTL_S, type YapinMode } from "@/lib/yapin/state";

/**
 * GET /auth/yapin/start?next=/somewhere[&mode=link]
 * Starts Sign in with Yapin' (feature 16): a fresh state and PKCE verifier in
 * a signed cookie, then off to yapin.gg. mode=link links the signed in
 * account from Settings > Connections. 503 { error: yapin_off } while the
 * flag is off or the Yapin' app is not set on the server.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const mode: YapinMode = params.get("mode") === "link" ? "link" : "signin";
  const next = safeNext(params.get("next"), mode === "link" ? "/settings" : "/");
  const user = await getCurrentUser();
  const config = await yapinSignIn(user?.id ?? null);
  if (!config) return Response.json({ error: "yapin_off" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (mode === "link" && !user) {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent("/settings")}`, request.url));
  }

  const state = randomToken(24);
  const verifier = createVerifier();
  const cookie = await sealState(
    { state, verifier, next, mode, uid: mode === "link" ? user!.id : null, exp: Math.floor(Date.now() / 1000) + STATE_TTL_S },
    config.clientSecret,
  );
  const out = NextResponse.redirect(
    authorizeUrl(config, { redirectUri: redirectUriFor(request), state, challenge: await challengeFor(verifier) }),
  );
  out.cookies.set(STATE_COOKIE, cookie, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:" || request.headers.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    path: STATE_COOKIE_PATH,
    maxAge: STATE_TTL_S,
  });
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}
