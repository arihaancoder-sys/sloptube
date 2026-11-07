// Feature 16: Yapin'. PKCE, the signed state cookie, the OAuth client with
// fetch faked, what the callback does with each kind of answer, the placeholder email, the webhook
// and share helpers, and og:video / twitter:player on watch pages.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { readYapinConfig } from "../lib/yapin/env.ts";
import { decideLink } from "../lib/yapin/link.ts";
import { authorizeUrl, exchangeCode, fetchMe, parseMe, YapinError } from "../lib/yapin/oauth.ts";
import { base64url, challengeFor, createVerifier, fromBase64url, isVerifier, randomToken } from "../lib/yapin/pkce.ts";
import { embedCsp, isPlaceholderEmail, isYapinWebhook, placeholderEmail, shareMessage, shareTarget, webhookProblem, YAPIN_SHARE_TEMPLATE, yapinErrorText, yapinNote, yapinStatus } from "../lib/yapin/rules.ts";
import { openState, sameState, sealState } from "../lib/yapin/state.ts";
import { embedMetadata, embedPath, playerSize, shortMetadata, watchMetadata } from "../lib/seo/meta.ts";

const SECRET = "made-up-client-secret";
const client = { clientId: "made-up-client-id", clientSecret: SECRET, base: "https://yapin.test" };

// PKCE --------------------------------------------------------------------------------------

test("the verifier is 43 base64url characters and new every time", () => {
  const a = createVerifier();
  const b = createVerifier();
  assert.equal(a.length, 43);
  assert.ok(isVerifier(a));
  assert.notEqual(a, b);
  assert.equal(isVerifier("short"), false);
  assert.equal(isVerifier("a".repeat(129)), false);
  assert.equal(isVerifier("a".repeat(42) + "+"), false);
});

test("the S256 challenge matches the RFC 7636 example and node's own sha256", async () => {
  // RFC 7636 appendix B.
  assert.equal(await challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  const v = createVerifier();
  assert.equal(await challengeFor(v), createHash("sha256").update(v).digest("base64url"));
});

test("base64url goes both ways and refuses anything else", () => {
  const bytes = new Uint8Array([0, 251, 255, 62, 63, 1]);
  assert.deepEqual(fromBase64url(base64url(bytes)), bytes);
  assert.equal(fromBase64url("not base64!"), null);
  assert.match(randomToken(24), /^[A-Za-z0-9_-]{32}$/);
});

// State cookie ---------------------------------------------------------------------------------

const NOW = 1_800_000_000;
const sample = { state: "abcdefghijklmnopqrstuvwx", verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk", next: "/watch?v=1", mode: "signin", uid: null, exp: NOW + 600 };

test("a sealed state opens with the same secret before it expires", async () => {
  const cookie = await sealState(sample, SECRET);
  assert.match(cookie, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(await openState(cookie, SECRET, NOW), sample);
  assert.equal(await openState(cookie, SECRET, NOW + 601), null, "expired");
  assert.equal(await openState(cookie, "another-secret", NOW), null, "wrong secret");
});

test("a changed state cookie is refused", async () => {
  const cookie = await sealState(sample, SECRET);
  const [body, sig] = cookie.split(".");
  const forged = base64url(new TextEncoder().encode(JSON.stringify({ ...sample, next: "/evil" })));
  assert.equal(await openState(`${forged}.${sig}`, SECRET, NOW), null);
  assert.equal(await openState(`${body}.${sig}x`, SECRET, NOW), null);
  assert.equal(await openState(`${body}.${sig}.more`, SECRET, NOW), null);
  assert.equal(await openState("", SECRET, NOW), null);
  assert.equal(await openState(undefined, SECRET, NOW), null);
  // Signed, but not the shape we write.
  assert.equal(await openState(await sealState({ ...sample, next: "https://evil.example" }, SECRET), SECRET, NOW), null);
  assert.equal(await openState(await sealState({ ...sample, mode: "admin" }, SECRET), SECRET, NOW), null);
});

test("the state Yapin' sends back must match exactly", () => {
  assert.equal(sameState(sample.state, sample.state), true);
  assert.equal(sameState(sample.state, sample.state.slice(0, -1) + "y"), false);
  assert.equal(sameState(sample.state, sample.state + "x"), false);
  assert.equal(sameState(sample.state, null), false);
});

// OAuth client ---------------------------------------------------------------------------------

test("people are sent to Yapin's consent page, /oauth/authorize, asking for identify only, with PKCE", () => {
  const url = new URL(authorizeUrl(client, { redirectUri: "https://tube.example.com/auth/yapin", state: "s".repeat(32), challenge: "c".repeat(43) }));
  assert.equal(url.origin + url.pathname, "https://yapin.test/oauth/authorize", "not /api/oauth/authorize, which only Yapin's own page posts to");
  assert.equal(url.searchParams.get("client_id"), "made-up-client-id");
  assert.equal(url.searchParams.get("redirect_uri"), "https://tube.example.com/auth/yapin");
  assert.equal(url.searchParams.get("scope"), "identify", "Yapin' has no email scope");
  assert.equal(url.searchParams.get("state"), "s".repeat(32));
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("code_challenge"), "c".repeat(43));
  assert.equal(url.searchParams.has("client_secret"), false);
});

function fakeFetch(answers) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const a = answers[calls.length - 1];
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200, headers: { "content-type": "application/json" } });
  };
  fn.calls = calls;
  return fn;
}

test("the code is swapped with the verifier and the secret, then /me is read with the token", async () => {
  const f = fakeFetch([{ body: { access_token: "made-up-token", token_type: "Bearer" } }, { body: { id: "98765", username: "SamYaps", display_name: "Sam", avatar_url: null } }]);
  const token = await exchangeCode(client, { code: "the-code", verifier: sample.verifier, redirectUri: "https://tube.example.com/auth/yapin" }, f);
  assert.equal(token, "made-up-token");
  assert.equal(f.calls[0].url, "https://yapin.test/api/oauth/token");
  assert.equal(f.calls[0].init.method, "POST");
  const form = new URLSearchParams(f.calls[0].init.body);
  assert.equal(form.get("grant_type"), "authorization_code");
  assert.equal(form.get("code"), "the-code");
  assert.equal(form.get("code_verifier"), sample.verifier);
  assert.equal(form.get("client_secret"), SECRET);
  assert.equal(form.get("redirect_uri"), "https://tube.example.com/auth/yapin");
  assert.equal(form.get("client_id"), "made-up-client-id");
  assert.equal(f.calls[0].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal("authorization" in f.calls[0].init.headers, false, "the secret goes one way only: in the form, not also as HTTP Basic");

  const me = await fetchMe(client, token, f);
  assert.equal(f.calls[1].url, "https://yapin.test/api/oauth/me");
  assert.equal(f.calls[1].init.headers.authorization, "Bearer made-up-token");
  assert.deepEqual(me, { id: "98765", username: "SamYaps", name: "Sam", avatarUrl: null });
});

test("a failed swap or /me throws a YapinError", async () => {
  await assert.rejects(exchangeCode(client, { code: "x", verifier: sample.verifier, redirectUri: "r" }, fakeFetch([{ status: 400, body: { error: "invalid_grant" } }])), YapinError);
  await assert.rejects(exchangeCode(client, { code: "x", verifier: sample.verifier, redirectUri: "r" }, fakeFetch([{ body: {} }])), YapinError);
  await assert.rejects(fetchMe(client, "t", fakeFetch([{ status: 401, body: {} }])), YapinError);
  await assert.rejects(fetchMe(client, "t", fakeFetch([{ body: { username: "no id" } }])), YapinError);
});

test("/me is read as Yapin' sends it: id, username, display_name, avatar_url", () => {
  assert.deepEqual(parseMe({ id: "42", username: "al", display_name: "Al", avatar_url: "https://cdn.yapin.gg/a.png" }), {
    id: "42", username: "al", name: "Al", avatarUrl: "https://cdn.yapin.gg/a.png",
  });
  assert.deepEqual(parseMe({ id: 42, username: "al", display_name: null, avatar_url: null }), { id: "42", username: "al", name: null, avatarUrl: null });
  // Even if an email showed up, it is not read: Yapin' never shares one and nothing may trust it.
  assert.equal("email" in parseMe({ id: "x", username: "x", email: "b@example.com" }), false);
  assert.equal(parseMe({ id: "x", avatar_url: "http://plain.example.com/a.png" }).avatarUrl, null);
  assert.equal(parseMe({ user: { id: "42" } }), null, "no user wrapper");
  assert.equal(parseMe({ sub: "abc_1" }), null, "no sub");
  assert.equal(parseMe({ id: "has spaces" }), null);
  assert.equal(parseMe(null), null);
});

// What the callback does -------------------------------------------------------------------------

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";

test("sign in: the account linked to the Yapin' id, else a new account, never by email", () => {
  assert.deepEqual(decideLink("signin", [{ user_id: U1, email: "sam@example.com" }], null), { do: "signin", userId: U1, email: "sam@example.com" });
  assert.deepEqual(decideLink("signin", [], null), { do: "create" });
  assert.deepEqual(decideLink("signin", [{ user_id: U1, email: null }], null), { do: "refuse", note: "error" });
});

test("link from Settings: only the signed in account, never one linked elsewhere", () => {
  assert.deepEqual(decideLink("link", [], U1), { do: "link", userId: U1 });
  assert.deepEqual(decideLink("link", [{ user_id: U1, email: "x" }], U1), { do: "already", userId: U1 });
  assert.deepEqual(decideLink("link", [{ user_id: U2, email: "x" }], U1), { do: "refuse", note: "taken" });
  assert.deepEqual(decideLink("link", [], null), { do: "refuse", note: "error" });
});

test("new accounts get a placeholder address on this site's host, and it is recognised", () => {
  assert.equal(placeholderEmail("770003", "Tube.Example.com"), "yapin_770003@users.noreply.tube.example.com");
  assert.equal(isPlaceholderEmail("yapin_770003@users.noreply.tube.example.com"), true);
  assert.equal(isPlaceholderEmail("sam@example.com"), false);
  assert.equal(isPlaceholderEmail("yapin_1@example.com"), false);
  assert.equal(isPlaceholderEmail("yapin_1@users.noreply.x.example extra"), false);
  assert.equal(isPlaceholderEmail(null), false);
  assert.equal(yapinStatus("needs_email"), 409);
  assert.match(yapinErrorText("needs_email"), /Add an email address/);
});

// Settings, rules -------------------------------------------------------------------------------

test("the Yapin' settings need the id, the secret and the service role key", () => {
  const all = { YAPIN_CLIENT_ID: "id", YAPIN_CLIENT_SECRET: "secret", SUPABASE_SERVICE_ROLE_KEY: "service" };
  assert.deepEqual(readYapinConfig(all), { clientId: "id", clientSecret: "secret", serviceRoleKey: "service", base: "https://www.yapin.gg" });
  assert.equal(readYapinConfig({ ...all, YAPIN_CLIENT_SECRET: " " }), null);
  assert.equal(readYapinConfig({ ...all, YAPIN_CLIENT_ID: undefined }), null);
  assert.equal(readYapinConfig({ ...all, SUPABASE_SERVICE_ROLE_KEY: "" }), null);
  assert.equal(readYapinConfig({ ...all, YAPIN_BASE_URL: "http://127.0.0.1:4000/" }).base, "http://127.0.0.1:4000");
  assert.equal(readYapinConfig({ ...all, YAPIN_BASE_URL: "javascript:alert(1)" }), null);
});

test("webhook URLs: https://<yapin.gg or yapper.website>/api/webhooks/<id>/<token> only, '' disconnects", () => {
  for (const good of ["https://www.yapin.gg/api/webhooks/1/abc", "https://yapin.gg/api/webhooks/1/abc", "https://yapper.website/api/webhooks/1/abc", "https://www.yapper.website/api/webhooks/12/a-b_c.d"]) {
    assert.equal(isYapinWebhook(good), true, good);
  }
  assert.equal(webhookProblem(""), null);
  assert.equal(webhookProblem("  https://yapin.gg/api/webhooks/1/abc "), null);
  for (const bad of ["http://yapin.gg/api/webhooks/1/abc", "https://yapin.gg.evil.example/api/webhooks/1/abc", "https://notyapin.gg/api/webhooks/1/abc", "https://cdn.yapin.gg/api/webhooks/1/abc", "https://yapin.gg/", "https://yapin.gg/x/y", "https://yapin.gg/api/webhooks/1", "https://yapin.gg/api/webhooks/1/abc/more", "https://yapin.gg/api/webhooks/1/abc?wait=true", "https://yapin.gg/api/webhooks/1/a b", `https://yapin.gg/api/webhooks/1/${"a".repeat(500)}`]) {
    assert.equal(webhookProblem(bad), "bad_webhook", bad);
  }
});

test("Share to Yapin' copies the title and the link and opens Yapin' (it has no share page)", () => {
  assert.equal(YAPIN_SHARE_TEMPLATE, null);
  assert.equal(shareMessage("  My   video ", "https://tube.example.com/watch?v=1"), "My video\nhttps://tube.example.com/watch?v=1");
  assert.equal(shareMessage("", "https://x.example/watch?v=1"), "https://x.example/watch?v=1");
  assert.equal(shareTarget("t", "https://x.example/watch?v=1"), "https://www.yapin.gg/");
  assert.equal(shareTarget("A & B", "https://x.example/watch?v=1", "https://www.yapin.gg/share?url={url}&text={text}"), "https://www.yapin.gg/share?url=https%3A%2F%2Fx.example%2Fwatch%3Fv%3D1&text=A%20%26%20B");
});

test("error codes, notes and the embed CSP", () => {
  assert.equal(yapinStatus("yapin_off"), 503);
  assert.equal(yapinStatus("not_signed_in"), 401);
  assert.equal(yapinStatus("rate_limited"), 429);
  assert.equal(yapinStatus("bad_webhook"), 400);
  assert.equal(yapinNote("linked"), "Your Yapin' account is linked. You can sign in with it now.");
  assert.equal(yapinNote("made-up"), null);
  assert.equal(embedCsp(), "frame-ancestors 'self' https://yapin.gg https://*.yapin.gg https://yapper.website https://*.yapper.website");
});

// og:video and twitter:player ---------------------------------------------------------------------

const ORIGIN = "https://tube.example.com";
const video = {
  id: "f0000000-0000-4000-8000-000000000001",
  title: "Fluffy pancakes in ten minutes, no mixer needed",
  description: "A made up video.",
  thumbnail: "/api/media/f0000000-0000-4000-8000-000000000001/thumb-1.webp",
  durationS: 612,
  date: "2026-10-01T12:00:00.000Z",
  views: 1234,
  visibility: "public",
  width: 1920,
  height: 1080,
  channel: { handle: "samplekitchen", name: "Sample Kitchen" },
};

test("with the yapin flag on, watch pages point og:video and twitter:player at /embed/<id>", () => {
  const m = watchMetadata(video, ORIGIN, "sloptube", { embed: true });
  const embed = `${ORIGIN}${embedPath(video.id)}`;
  assert.equal(embed, "https://tube.example.com/embed/f0000000-0000-4000-8000-000000000001");
  assert.deepEqual(m.openGraph.videos, [{ url: embed, secureUrl: embed, type: "text/html", width: 1280, height: 720 }]);
  assert.equal(m.openGraph.type, "video.other");
  assert.equal(m.openGraph.images[0].url, `${ORIGIN}${video.thumbnail}`);
  assert.equal(m.twitter.card, "player");
  assert.deepEqual(m.twitter.players, [{ playerUrl: embed, streamUrl: embed, width: 1280, height: 720 }]);
  assert.deepEqual(m.twitter.images, [`${ORIGIN}${video.thumbnail}`]);
});

test("without it, or for a private video, the cards stay as they were", () => {
  const off = watchMetadata(video, ORIGIN);
  assert.equal(off.openGraph.videos, undefined);
  assert.equal(off.twitter.card, "summary_large_image");
  assert.equal(watchMetadata({ ...video, visibility: "private" }, ORIGIN, "sloptube", { embed: true }).openGraph.videos, undefined);
  // http origins get no secure_url.
  assert.equal(watchMetadata(video, "http://localhost:3000", "sloptube", { embed: true }).openGraph.videos[0].secureUrl, undefined);
});

test("Snips keep their own canonical link and get a portrait player", () => {
  const m = shortMetadata({ ...video, width: 1080, height: 1920 }, ORIGIN, "sloptube", { embed: true });
  assert.equal(m.alternates.canonical, `${ORIGIN}/shorts/${video.id}`);
  assert.deepEqual(m.twitter.players[0], { playerUrl: `${ORIGIN}/embed/${video.id}`, streamUrl: `${ORIGIN}/embed/${video.id}`, width: 1080, height: 1920 });
  assert.deepEqual(playerSize({ width: null, height: null }), { width: 1280, height: 720 });
  assert.deepEqual(playerSize({ width: 3840, height: 2160 }), { width: 1280, height: 720 });
});

test("the embed page is kept out of search engines and points at the watch page", () => {
  const m = embedMetadata(video, ORIGIN);
  assert.equal(m.title, `${video.title} | sloptube`);
  assert.equal(m.alternates.canonical, `${ORIGIN}/watch?v=${video.id}`);
  assert.deepEqual(m.robots, { index: false, follow: true });
});
