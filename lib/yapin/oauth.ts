// The Yapin' OAuth2 client: the authorize address, the code for token swap and
// /me. People are sent to <base>/oauth/authorize (Yapin's consent page); the
// server calls <base>/api/oauth/token and <base>/api/oauth/me. The only scope
// is identify: Yapin' never shares an email address. Authorization code with
// PKCE (S256). fetch is passed in so the tests can stand in for yapin.gg.
// Only type imports.

export const DEFAULT_YAPIN_BASE = "https://www.yapin.gg";
/** Yapin' has one scope. There is no email scope. */
export const YAPIN_SCOPES = ["identify"] as const;
/** The callback path. Register https://<your domain>/auth/yapin at yapin.gg/developers. */
export const CALLBACK_PATH = "/auth/yapin";

export type YapinClient = {
  clientId: string;
  clientSecret: string;
  /** https://www.yapin.gg, or a stand in for the tests. No trailing slash. */
  base: string;
};

/** What /me answers: { id, username, display_name, avatar_url }. Never an email. */
export type YapinUser = {
  id: string;
  username: string;
  /** display_name, or null. */
  name: string | null;
  avatarUrl: string | null;
};

type Fetch = typeof fetch;

export function authorizeUrl(c: YapinClient, p: { redirectUri: string; state: string; challenge: string }): string {
  const q = new URLSearchParams({
    response_type: "code",
    client_id: c.clientId,
    redirect_uri: p.redirectUri,
    scope: YAPIN_SCOPES.join(" "),
    state: p.state,
    code_challenge: p.challenge,
    code_challenge_method: "S256",
  });
  return `${c.base}/oauth/authorize?${q}`;
}

export class YapinError extends Error {
  code: "token_failed" | "me_failed" | "bad_profile";
  constructor(code: YapinError["code"], message: string) {
    super(message);
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

/** Swaps the code for an access token. */
export async function exchangeCode(
  c: YapinClient,
  p: { code: string; verifier: string; redirectUri: string },
  fetchFn: Fetch = fetch,
): Promise<string> {
  const res = await fetchFn(`${c.base}/api/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: p.code,
      redirect_uri: p.redirectUri,
      client_id: c.clientId,
      client_secret: c.clientSecret,
      code_verifier: p.verifier,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { access_token?: unknown } | null;
  if (!res.ok || !json || typeof json.access_token !== "string" || !json.access_token) {
    throw new YapinError("token_failed", `token endpoint answered ${res.status}`);
  }
  return json.access_token;
}

/** /me with the access token, read with parseMe. */
export async function fetchMe(c: YapinClient, accessToken: string, fetchFn: Fetch = fetch): Promise<YapinUser> {
  const res = await fetchFn(`${c.base}/api/oauth/me`, {
    headers: { authorization: `Bearer ${accessToken}`, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new YapinError("me_failed", `me endpoint answered ${res.status}`);
  const user = parseMe(await res.json().catch(() => null));
  if (!user) throw new YapinError("bad_profile", "me endpoint answered something we cannot read");
  return user;
}

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * The Yapin' user from /me: { id, username, display_name, avatar_url } at the
 * top level. avatar_url is absolute or null; only an https one is kept (the
 * profile only takes https). Null without a usable id.
 */
export function parseMe(json: unknown): YapinUser | null {
  if (!json || typeof json !== "object") return null;
  const u = json as Record<string, unknown>;
  const rawId = typeof u.id === "number" ? String(u.id) : str(u.id);
  if (!rawId || !/^[A-Za-z0-9_-]{1,64}$/.test(rawId)) return null;
  const avatar = str(u.avatar_url);
  return {
    id: rawId,
    username: (str(u.username) ?? rawId).slice(0, 64),
    name: str(u.display_name)?.slice(0, 50) ?? null,
    avatarUrl: avatar && /^https:\/\/[^\s]+$/.test(avatar) ? avatar : null,
  };
}
