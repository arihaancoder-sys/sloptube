import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { decideLink, type FoundUser } from "@/lib/yapin/link";
import { exchangeCode, fetchMe, type YapinUser } from "@/lib/yapin/oauth";
import { placeholderEmail } from "@/lib/yapin/rules";
import { redirectUriFor, rpcCode, serviceClient, yapinOrigin, yapinSignIn } from "@/lib/yapin/server";
import { openState, sameState, STATE_COOKIE, STATE_COOKIE_PATH } from "@/lib/yapin/state";

/**
 * GET /auth/yapin?code=...&state=...
 * Where Yapin' sends people back (register https://<your domain>/auth/yapin
 * at https://www.yapin.gg/developers). Checks the signed state cookie, swaps
 * the code with the PKCE verifier, reads /me, then signs in the account
 * linked to that Yapin' id, makes a new account, or links the signed in
 * account (mode link). Yapin' shares no email address, so nothing is ever
 * matched by email; a new account gets a placeholder address (placeholderEmail
 * in lib/yapin/rules.ts) and goes to /welcome. Sessions are made with the
 * service role: a one time magic link token the server redeems at once,
 * never sent anywhere.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const origin = yapinOrigin(request);
  const config = await yapinSignIn((await getCurrentUser())?.id ?? null);
  if (!config) return Response.json({ error: "yapin_off" }, { status: 503, headers: { "Cache-Control": "no-store" } });

  const saved = await openState(request.cookies.get(STATE_COOKIE)?.value, config.clientSecret);
  const back = (note: string) => {
    const page = saved?.mode === "link" ? "/settings" : "/login";
    return finish(new URL(`${page}?yapin=${note}`, origin));
  };
  if (!saved || !sameState(saved.state, params.get("state"))) return back("error");
  if (params.get("error")) return back(params.get("error") === "access_denied" ? "denied" : "error");
  const code = params.get("code");
  if (!code) return back("error");

  let me: YapinUser;
  try {
    const token = await exchangeCode(config, { code, verifier: saved.verifier, redirectUri: redirectUriFor(request) });
    me = await fetchMe(config, token);
  } catch {
    return back("error");
  }

  const admin = serviceClient(config);
  const session = await createClient();
  if (!admin || !session) return back("error");

  const current = saved.mode === "link" ? await getCurrentUser() : null;
  if (saved.mode === "link" && current?.id !== saved.uid) return back("error");

  const { data: found, error: findError } = await admin.rpc("yapin_find_user", { yapin_id: me.id });
  if (findError) return back("error");
  const decision = decideLink(saved.mode, (found ?? []) as FoundUser[], current?.id ?? null);

  const link = async (userId: string) => {
    const { error } = await admin.rpc("link_yapin", { user_id: userId, yapin_id: me.id, yapin_username: me.username });
    return error ? rpcCode(error) : null;
  };

  switch (decision.do) {
    case "refuse":
      return back(decision.note);
    case "already":
      return back("linked");
    case "link": {
      const problem = await link(decision.userId);
      return back(problem === "yapin_taken" ? "taken" : problem ? "error" : "linked");
    }
    case "signin":
    case "create": {
      let email: string;
      if (decision.do === "create") {
        // No mailbox behind it: marked with email_placeholder below so nothing mails it.
        email = placeholderEmail(me.id, new URL(origin).hostname);
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          user_metadata: { username: me.username.toLowerCase(), full_name: me.name ?? me.username, avatar_url: me.avatarUrl },
        });
        if (error || !data.user) return back("error");
        const newId = data.user.id;
        const problem = await link(newId);
        const { error: markError } = problem ? { error: null } : await admin.rpc("yapin_mark_placeholder", { user_id: newId });
        if (problem || markError) {
          // Not left behind half made: without the link nobody could ever sign in to it.
          await admin.auth.admin.deleteUser(newId).catch(() => null);
          return back(problem === "yapin_taken" ? "taken" : "error");
        }
      } else {
        email = decision.email;
      }
      // A one time token for this account, redeemed right here into the session cookie.
      const { data: magic, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
      const tokenHash = magic?.properties?.hashed_token;
      if (linkError || !tokenHash) return back("error");
      const { data: signedIn, error: otpError } = await session.auth.verifyOtp({ token_hash: tokenHash, type: "magiclink" });
      if (otpError || !signedIn.user) return back("error");

      const { data: profile } = await session.from("profiles").select("onboarded").eq("id", signedIn.user.id).maybeSingle();
      const target = profile?.onboarded ? saved.next : `/welcome?next=${encodeURIComponent(saved.next)}`;
      return finish(new URL(target, origin));
    }
  }
}

/** Redirects and drops the state cookie: it is good for one try only. */
function finish(url: URL) {
  const out = NextResponse.redirect(url);
  out.cookies.set(STATE_COOKIE, "", { path: STATE_COOKIE_PATH, maxAge: 0 });
  out.headers.set("Cache-Control", "private, no-store");
  return out;
}
