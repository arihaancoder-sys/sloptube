#!/usr/bin/env node
// Checks and screenshots of the Yapin' integration (feature 16) on the
// production build against the made up site in scripts/launch-mock.mjs, with
// a local stand in for Yapin' (its OAuth endpoints and an incoming webhook):
// - the yapin flag off: no button, /auth/yapin/start answers 503 yapin_off
// - Continue with Yapin' on /login and /signup; sign in through the stand in
//   with PKCE and scope identify (Yapin's real shapes: /oauth/authorize,
//   /api/oauth/token, /api/oauth/me answering { id, username, display_name,
//   avatar_url } and never an email): a new account with a placeholder
//   address (to /welcome, Settings offers to add an email, Unlink refused),
//   the same Yapin' account signs in to it again, a wrong state and a cancel
//   refused, never a match by email
// - Settings > Connections: Link (then Continue with Yapin' signs in to that
//   account), Unlink, Link again, a Yapin' account linked elsewhere refused
// - the share box with the Yapin' button (yapin.gg itself is never opened:
//   the browser's requests to it are answered locally)
// - /embed/<id> with frame-ancestors, og:video and twitter:player for a bot
// - /studio/settings: the webhook (a bad URL refused, the URL never sent
//   back, webhooks on yapin.gg and yapper.website), posts sent by the
//   encoder's drain with a retry and a failure
// Screenshots at 1280 and 390, light and dark, in shots/yapin.
//
//   npm run build && node scripts/yapin-shots.mjs [out-dir]
//
// Needs ffmpeg and Playwright with Chromium.

import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { drainYapin, YAPIN_WEBHOOK_HOSTS } from "../worker/lib/yapin.mjs";
import { ADMIN, VIDEOS, adminCookie, root, sessionFor, startSite } from "./launch-mock.mjs";

const outDir = resolve(process.argv[2] ?? join(root, "shots/yapin"));
const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

// The stand in for Yapin' --------------------------------------------------------------------------

const CLIENT_ID = "made-up-client-id";
const CLIENT_SECRET = "made-up-client-secret-for-the-checks";
const yapin = {
  /** Who /me answers for the next sign in. */
  user: null,
  deny: false,
  codes: new Map(),
  tokens: new Map(),
  pkceOk: [],
  /** The incoming webhook: what was posted, and the statuses to answer in turn per path. */
  posted: [],
  answers: new Map(),
};
// Made by Sign in with Yapin' on http://localhost:<port>: placeholderEmail("770003", "localhost").
const ROBIN = { id: "a1600000-0000-4000-8000-000000000002", email: "yapin_770003@users.noreply.localhost", username: "robinyaps", name: "Robin" };
/** /me as Yapin' sends it. */
const ROBIN_YAPIN = { id: "770003", username: ROBIN.username, display_name: "Robin", avatar_url: null };
const SAM_YAPIN = { id: "770001", username: "siteadmin_yaps", display_name: "Site Admin", avatar_url: "https://cdn.yapin.gg/avatars/770001.png" };

const yapinServer = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  let raw = "";
  for await (const chunk of req) raw += chunk;
  const json = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  // Yapin's consent page. (POST /api/oauth/authorize is only for Yapin's own page.)
  if (url.pathname === "/oauth/authorize" && req.method === "GET") {
    const q = url.searchParams;
    const back = new URL(q.get("redirect_uri"));
    back.searchParams.set("state", q.get("state") ?? "");
    const fine = q.get("client_id") === CLIENT_ID && q.get("code_challenge_method") === "S256" && q.get("scope") === "identify" && Boolean(q.get("code_challenge"));
    if (yapin.deny || !fine) back.searchParams.set("error", yapin.deny ? "access_denied" : "invalid_request");
    else {
      const code = `code-${yapin.codes.size + 1}`;
      yapin.codes.set(code, { challenge: q.get("code_challenge"), redirect: q.get("redirect_uri"), user: yapin.user });
      back.searchParams.set("code", code);
    }
    res.writeHead(302, { location: back.href });
    return res.end();
  }
  if (url.pathname === "/api/oauth/token" && req.method === "POST") {
    const f = new URLSearchParams(raw);
    const grant = yapin.codes.get(f.get("code"));
    // The client secret one way only: in the form or as HTTP Basic, never both.
    if (req.headers.authorization && f.get("client_secret")) return json(400, { error: "invalid_request" });
    if (f.get("grant_type") !== "authorization_code" || f.get("client_id") !== CLIENT_ID) return json(400, { error: "invalid_request" });
    if (!grant || f.get("client_secret") !== CLIENT_SECRET || f.get("redirect_uri") !== grant.redirect) return json(400, { error: "invalid_grant" });
    const ok = createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === grant.challenge;
    yapin.pkceOk.push(ok);
    if (!ok) return json(400, { error: "invalid_grant" });
    yapin.codes.delete(f.get("code"));
    const token = `token-${yapin.tokens.size + 1}`;
    yapin.tokens.set(token, grant.user);
    return json(200, { access_token: token, token_type: "Bearer", scope: "identify" });
  }
  if (url.pathname === "/api/oauth/me") {
    const user = yapin.tokens.get((req.headers.authorization ?? "").replace(/^Bearer /, ""));
    return user ? json(200, user) : json(401, { error: "invalid_token" });
  }
  if (url.pathname.startsWith("/api/webhooks/") && req.method === "POST") {
    const queue = yapin.answers.get(url.pathname) ?? [204];
    const status = queue.length > 1 ? queue.shift() : queue[0];
    yapin.posted.push({ path: url.pathname, status, body: JSON.parse(raw) });
    res.writeHead(status, { "content-type": "application/json" });
    return res.end(status === 204 ? "" : JSON.stringify({ message: status === 404 ? "Unknown Webhook" : "try again" }));
  }
  json(404, { error: "not_found" });
});
await new Promise((r) => yapinServer.listen(0, "127.0.0.1", r));
const yapinBase = `http://127.0.0.1:${yapinServer.address().port}`;

// The Supabase stand in's Yapin' routes ----------------------------------------------------------

const db = { links: new Map(), webhook: null, posts: [], users: new Map([[ADMIN.email, ADMIN]]), created: [], magic: new Map(), placeholder: new Set(), findArgs: [], robinOnboarded: false };
db.users.set(ROBIN.email, null); // not made yet
const userById = (id) => [...db.users.values()].find((u) => u?.id === id) ?? null;
const ROBIN_SESSION = sessionFor(ROBIN);
const ADMIN_SESSION = sessionFor(ADMIN);
const sessions = { [ADMIN.id]: ADMIN_SESSION, [ROBIN.id]: ROBIN_SESSION };

async function handle({ req, url, args, send, fail, me, state }) {
  const auth = req.headers.authorization ?? "";
  const robin = auth === `Bearer ${ROBIN_SESSION.token}`;
  const caller = me ?? (robin ? ROBIN : null);
  const flagOn = state.flags.yapin === "everyone";
  const p = url.pathname;

  // Auth admin (service role) and verify.
  if (p === "/auth/v1/user" && robin) return send(200, ROBIN_SESSION.authUser), true;
  if (p === "/auth/v1/admin/users" && req.method === "POST") {
    if (args.email !== ROBIN.email || !args.email_confirm || db.users.get(ROBIN.email)) return send(422, { msg: "unexpected user" }), true;
    db.users.set(ROBIN.email, ROBIN);
    db.created.push(args);
    return send(200, ROBIN_SESSION.authUser), true;
  }
  if (p === "/auth/v1/admin/generate_link") {
    const user = db.users.get(args.email);
    if (!user || args.type !== "magiclink") return send(404, { msg: "User not found" }), true;
    const hashed = `hashed-${db.magic.size + 1}`;
    db.magic.set(hashed, user);
    return send(200, { ...sessions[user.id].authUser, action_link: "http://unused", email_otp: "000000", hashed_token: hashed, redirect_to: "", verification_type: "magiclink" }), true;
  }
  if (p === "/auth/v1/verify" && req.method === "POST") {
    const user = db.magic.get(args.token_hash);
    if (!user) return send(403, { msg: "Token has expired or is invalid" }), true;
    db.magic.delete(args.token_hash);
    return send(200, sessions[user.id].session), true;
  }
  if (p === "/rest/v1/profiles" && robin) {
    return send(200, [{ id: ROBIN.id, username: ROBIN.username, display_name: ROBIN.name, avatar_url: null, bio: "", onboarded: db.robinOnboarded }]), true;
  }

  const rpc = p.replace("/rest/v1/rpc/", "");
  switch (rpc) {
    case "yapin_find_user": {
      // 019: yapin_find_user(yapin_id) only. Anything else is the old email path.
      db.findArgs.push(Object.keys(args).sort().join(","));
      if (Object.keys(args).join(",") !== "yapin_id") return send(404, { code: "PGRST202", message: "no such function" }), true;
      const byYapin = [...db.links].find(([, l]) => l.id === args.yapin_id);
      const user = byYapin ? userById(byYapin[0]) : null;
      return send(200, user ? [{ user_id: user.id, email: user.email }] : []), true;
    }
    case "yapin_mark_placeholder": {
      const user = userById(args.user_id);
      if (!user || !/^yapin_[a-z0-9_-]+@users\.noreply\./.test(user.email)) return fail("not_found"), true;
      db.placeholder.add(user.id);
      return send(200, "null"), true;
    }
    case "link_yapin": {
      const taken = [...db.links].find(([uid, l]) => l.id === args.yapin_id && uid !== args.user_id);
      if (taken) return fail("yapin_taken"), true;
      db.links.set(args.user_id, { id: args.yapin_id, username: args.yapin_username });
      return send(200, "null"), true;
    }
    case "yapin_status":
    case "unlink_yapin":
    case "set_yapin_webhook":
    case "list_yapin_posts": {
      if (!caller) return fail("not_signed_in"), true;
      if (!flagOn) return fail("yapin_off"), true;
      if (rpc === "yapin_status") {
        const l = db.links.get(caller.id);
        return send(200, [{ linked: Boolean(l), yapin_username: l?.username ?? null, needs_email: db.placeholder.has(caller.id) }]), true;
      }
      if (rpc === "unlink_yapin") {
        if (db.placeholder.has(caller.id)) return fail("needs_email"), true;
        db.links.delete(caller.id);
        return send(200, "null"), true;
      }
      if (rpc === "set_yapin_webhook") {
        const u = String(args.url ?? "").trim();
        if (!u) {
          db.webhook = null;
          return send(200, "null"), true;
        }
        if (!/^https:\/\/(www\.)?(yapin\.gg|yapper\.website)\/api\/webhooks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(u)) return fail("bad_webhook"), true;
        db.webhook = { url: u, hint: u.slice(-4) };
        return send(200, JSON.stringify(db.webhook.hint)), true;
      }
      const hint = db.webhook?.hint ?? null;
      const rows = db.posts.map((x) => ({ id: x.id, video_id: x.videoId, title: x.title, status: x.status, attempts: x.attempts, error: x.error, queued_at: x.queuedAt, finished_at: x.finishedAt, connected: hint !== null, url_hint: hint }));
      return send(200, rows.length ? rows : [{ id: null, video_id: null, title: null, status: null, attempts: 0, error: null, queued_at: null, finished_at: null, connected: hint !== null, url_hint: hint }]), true;
    }
  }
  return false;
}

// The site ------------------------------------------------------------------------------------------

const site = await startSite({
  port: Number(process.env.APP_PORT ?? 3476),
  flags: { yapin: "off", studio: "everyone", engagement: "off", comments: "off" },
  env: { YAPIN_CLIENT_ID: CLIENT_ID, YAPIN_CLIENT_SECRET: CLIENT_SECRET, SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-role-for-the-mock", YAPIN_BASE_URL: yapinBase },
  handle,
});
const browser = await chromium.launch();
mkdirSync(outDir, { recursive: true });

/** Requests to the real Yapin' never leave the machine: a blank page stands in. */
async function fenceYapin(context) {
  await context.route(/^https:\/\/([a-z0-9-]+\.)*(yapin\.gg|yapper\.website)\//, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>Yapin' (stand in)</title><p>Yapin' stand in</p>" }),
  );
}

async function open(path, { width = 1280, height = 900, theme = "light", admin = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  await fenceYapin(context);
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
    } catch {}
  }, theme);
  if (admin) await context.addCookies([adminCookie()]);
  const page = await context.newPage();
  const res = await page.goto(site.base + path, { waitUntil: "networkidle" });
  return { context, page, status: res?.status() };
}

async function shots(name, path, ready, opts = {}, before = null) {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      const { context, page } = await open(path, { width, height: width === 390 ? 844 : 900, theme, ...opts });
      if (before) await before(page);
      if (ready) await page.waitForSelector(ready, { timeout: 15000 });
      await page.screenshot({ path: join(outDir, `${name}-${width}-${theme}.png`), fullPage: width === 390 && !opts.viewportOnly });
      await context.close();
    }
  }
}

const text = async (path, headers = {}) => {
  const res = await fetch(site.base + path, { headers, redirect: "manual" });
  return { status: res.status, body: await res.text(), headers: res.headers };
};
const head = (html) => html.slice(0, html.indexOf("</head>"));
const signedIn = async (context) => (await context.cookies()).some((c) => c.name === "sb-127-auth-token" && c.value.length > 20);

try {
  // The flag off.
  {
    const login = await text("/login");
    check(!login.body.includes("data-yapin-signin"), "flag off: no Continue with Yapin' on /login");
    const start = await text("/auth/yapin/start");
    check(start.status === 503 && JSON.parse(start.body).error === "yapin_off", "flag off: /auth/yapin/start answers 503 yapin_off");
    const embed = await text(`/embed/${VIDEOS[0].id}`);
    check(embed.body.includes('data-embed-state="off"'), "flag off: /embed says it is off");
    const bot = await text(site.watchPath, { "user-agent": "Twitterbot/1.0" });
    check(!head(bot.body).includes("og:video") && head(bot.body).includes('content="summary_large_image"'), "flag off: no og:video, the large image card");
  }
  site.state.flags.yapin = "everyone";

  // Sign in and sign up pages.
  await shots("login", "/login", "[data-yapin-signin]");
  await shots("signup", "/signup", "[data-yapin-signin]");

  // A wrong state is refused.
  {
    const { context, page } = await open("/login");
    const start = await context.request.get(site.base + "/auth/yapin/start", { maxRedirects: 0 });
    const to = new URL(start.headers().location);
    check(start.status() === 307 && to.pathname === "/oauth/authorize", "start redirects to Yapin's consent page, /oauth/authorize");
    check(to.searchParams.get("scope") === "identify" && to.searchParams.get("code_challenge_method") === "S256", "it asks for scope identify only, with PKCE S256");
    await page.goto(site.base + "/auth/yapin?code=code-999&state=not-the-state");
    check(new URL(page.url()).searchParams.get("yapin") === "error", "a wrong state goes back to /login?yapin=error");
    await page.waitForSelector("[role=alert]");
    check((await page.textContent("[role=alert]"))?.includes("did not finish"), "the login page says sign in did not finish");
    check(!(await signedIn(context)), "a wrong state signs nobody in");
    await context.close();
  }
  // Cancelled on Yapin'.
  {
    yapin.deny = true;
    yapin.user = ROBIN_YAPIN;
    const { context, page } = await open("/login");
    await page.click("[data-yapin-signin]");
    await page.waitForURL((u) => u.searchParams.get("yapin") === "denied", { timeout: 15000 });
    check(db.created.length === 0, "cancelled on Yapin' goes back to /login?yapin=denied and makes no account");
    yapin.deny = false;
    await context.close();
  }
  // A Yapin' account nobody has linked: a new account with a placeholder address.
  {
    yapin.user = ROBIN_YAPIN;
    const { context, page } = await open("/signup");
    await page.click("[data-yapin-signin]");
    await page.waitForURL((u) => u.pathname === "/welcome", { timeout: 15000 });
    check(yapin.pkceOk.at(-1) === true, "the token swap sends the verifier that matches the challenge");
    check(db.findArgs.every((k) => k === "yapin_id"), "the callback looks the account up by the Yapin' id only, never by email");
    check(db.created.length === 1 && db.created[0].email === ROBIN.email, "the new account gets the placeholder yapin_<id>@users.noreply.<host>");
    check(db.created[0].user_metadata.username === ROBIN.username && db.created[0].user_metadata.full_name === "Robin", "with the Yapin' username and display name");
    check(db.placeholder.has(ROBIN.id), "the profile is marked email_placeholder");
    check(db.links.get(ROBIN.id)?.id === ROBIN_YAPIN.id, "the new account is linked");
    check(await signedIn(context), "the new account is signed in and goes to /welcome to finish sign up");
    check(!(await context.cookies()).some((c) => c.name === "yapin_oauth" && c.value), "the state cookie is gone after the callback");
    // Settings (after /welcome): the placeholder is never shown, an email can be added, Unlink is refused.
    db.robinOnboarded = true;
    await page.goto(site.base + "/settings", { waitUntil: "networkidle" });
    await page.waitForSelector("[data-add-email]");
    check(!(await page.content()).includes("users.noreply"), "Settings never shows the placeholder address");
    await page.waitForSelector('[data-yapin-connection="linked"]');
    check((await page.locator("[data-yapin-unlink]").count()) === 0, "no Unlink while Yapin' is the only way in");
    check((await page.textContent("[data-yapin-connection-help]"))?.includes("only way into this account"), "Connections says why");
    await page.screenshot({ path: join(outDir, "settings-add-email-1280-light.png"), fullPage: true });
    const unlink = await page.evaluate(() => fetch("/api/yapin/unlink", { method: "POST" }).then(async (r) => ({ status: r.status, body: await r.json() })));
    check(unlink.status === 409 && unlink.body.error === "needs_email" && db.links.has(ROBIN.id), "the unlink API refuses with needs_email");
    await context.close();
  }
  // The same Yapin' account signs in to that account again, no second account.
  {
    yapin.user = ROBIN_YAPIN;
    const { context, page } = await open("/login");
    await page.click("[data-yapin-signin]");
    await page.waitForURL((u) => u.pathname === "/", { timeout: 15000 });
    check(db.created.length === 1 && (await signedIn(context)), "a linked Yapin' account signs in again, nothing new made");
    await context.close();
  }

  // Settings > Connections: link the admin's own account, then sign in with it.
  {
    yapin.user = SAM_YAPIN;
    const { context, page } = await open("/settings", { admin: true });
    await page.waitForSelector('[data-yapin-connection="unlinked"]');
    check((await page.locator("[data-add-email]").count()) === 0, "an account with a real address is not asked to add one");
    await page.click("[data-yapin-link]");
    await page.waitForURL((u) => u.pathname === "/settings" && u.searchParams.get("yapin") === "linked", { timeout: 15000 });
    await page.waitForSelector('[data-yapin-connection="linked"]');
    check(db.links.get(ADMIN.id)?.id === SAM_YAPIN.id, "Link goes through Yapin' and links the signed in account");
    await context.close();
  }
  {
    yapin.user = SAM_YAPIN;
    const { context, page } = await open("/login?next=%2Ftrending");
    await page.click("[data-yapin-signin]");
    await page.waitForURL((u) => u.pathname === "/trending", { timeout: 15000 });
    check(await signedIn(context), "Continue with Yapin' then signs in to the linked account");
    check(db.created.length === 1, "and makes no new account");
    await context.close();
  }
  await shots("connections-linked", "/settings", '[data-yapin-connection="linked"]', { admin: true });
  {
    const { context, page } = await open("/settings", { admin: true });
    await page.waitForSelector('[data-yapin-connection="linked"]');
    check((await page.textContent("[data-yapin-connection]"))?.includes(`Linked as ${SAM_YAPIN.username}`), "Connections shows the linked Yapin' name");
    await page.click("[data-yapin-unlink]");
    await page.waitForSelector('[data-yapin-connection="unlinked"]', { timeout: 15000 });
    check(!db.links.has(ADMIN.id), "Unlink removes the link");
    check((await page.textContent("[data-yapin-note]"))?.includes("unlinked"), "Connections says it is unlinked");
    await page.screenshot({ path: join(outDir, "connections-unlinked-1280-light.png") });
    yapin.user = SAM_YAPIN;
    await page.click("[data-yapin-link]");
    await page.waitForURL((u) => u.pathname === "/settings" && u.searchParams.get("yapin") === "linked", { timeout: 15000 });
    await page.waitForSelector('[data-yapin-connection="linked"]');
    check(db.links.get(ADMIN.id)?.id === SAM_YAPIN.id, "Link again links the signed in account");
    // A Yapin' account linked to another sloptube account cannot be linked here too.
    yapin.user = ROBIN_YAPIN;
    await page.click("[data-yapin-unlink]");
    await page.waitForSelector("[data-yapin-link]");
    await page.click("[data-yapin-link]");
    await page.waitForURL((u) => u.searchParams.get("yapin") === "taken", { timeout: 15000 });
    check(db.links.get(ADMIN.id) === undefined && db.links.get(ROBIN.id)?.id === ROBIN_YAPIN.id, "a Yapin' account linked elsewhere is refused");
    await context.close();
    db.links.set(ADMIN.id, { id: SAM_YAPIN.id, username: SAM_YAPIN.username });
  }
  {
    const res = await fetch(site.base + "/api/yapin/unlink", { method: "POST" });
    check(res.status === 401, "unlink signed out answers 401");
  }

  // The share box.
  await shots("share", site.watchPath, "[data-share-yapin]", {}, async (page) => {
    await page.waitForSelector("[data-share]");
    await page.click("[data-share]");
  });
  {
    const { context, page } = await open(site.watchPath);
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: site.base });
    await page.click("[data-share]");
    await page.waitForSelector("[data-share-yapin]");
    const [popup] = await Promise.all([context.waitForEvent("page"), page.click("[data-share-yapin]")]);
    await popup.waitForLoadState();
    check(popup.url() === "https://www.yapin.gg/", "Share to Yapin' opens yapin.gg in a new tab (answered locally)");
    await page.bringToFront();
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    check(clip === `${VIDEOS[0].title}\n${site.base}${site.watchPath}`, "Share to Yapin' copies the title and the link");
    await page.waitForSelector("[data-share-toast]");
    check((await page.textContent("[data-share-toast]"))?.includes("Paste it in Yapin'"), "the toast says to paste it in Yapin'");
    await context.close();
  }

  // The embed page and the share cards.
  {
    const embed = await text(`/embed/${VIDEOS[0].id}`);
    check(embed.status === 200 && embed.body.includes('data-embed-state="ready"'), "/embed/<id> shows the player");
    check(embed.headers.get("content-security-policy") === "frame-ancestors 'self' https://yapin.gg https://*.yapin.gg https://yapper.website https://*.yapper.website", "/embed may be framed by Yapin' and yapper.website only");
    const embedForBot = head((await text(`/embed/${VIDEOS[0].id}`, { "user-agent": "Discordbot/2.0" })).body);
    check(embedForBot.includes('name="robots" content="noindex, follow"') && embedForBot.includes(`rel="canonical" href="${site.base}${site.watchPath}"`), "/embed is kept out of search engines, the watch page is canonical");
    const watch = await text(site.watchPath);
    check(!watch.headers.get("content-security-policy"), "the watch page keeps the default headers");
    const missing = await text("/embed/f1500000-0000-4000-8000-999999999999");
    check(missing.body.includes('data-embed-state="missing"'), "/embed of a missing video says unavailable");
    const bot = head((await text(site.watchPath, { "user-agent": "Discordbot/2.0" })).body);
    const embedUrl = `${site.base}/embed/${VIDEOS[0].id}`;
    check(bot.includes(`<meta property="og:video" content="${embedUrl}"/>`), "og:video points at /embed/<id>");
    check(bot.includes('<meta property="og:video:type" content="text/html"/>'), "og:video:type is text/html");
    check(bot.includes('<meta name="twitter:card" content="player"/>') && bot.includes(`<meta name="twitter:player" content="${embedUrl}"/>`), "twitter:player points at /embed/<id>");
    check(bot.includes('<meta name="twitter:player:width" content="640"/>') && bot.includes('<meta name="twitter:player:height" content="360"/>'), "the player size is the video's own");
  }
  await shots("embed", `/embed/${VIDEOS[0].id}`, '[data-embed-state="ready"] [data-player]', { viewportOnly: true });
  {
    // Inside a frame on another site the page still plays its part.
    const { context, page } = await open("/");
    await page.setContent(`<!doctype html><body style="margin:0;background:#36393f;padding:24px"><iframe src="${site.base}/embed/${VIDEOS[0].id}" width="640" height="360" style="border:0"></iframe>`);
    const frame = page.frames().find((f) => f.url().includes("/embed/"));
    await frame?.waitForSelector("[data-player]", { timeout: 15000 });
    check(Boolean(frame), "/embed loads inside a frame from an allowed page");
    await page.screenshot({ path: join(outDir, "embed-framed-1280-dark.png") });
    await context.close();
  }

  // Studio announcements.
  {
    const { context, page } = await open("/studio/settings", { admin: true });
    await page.waitForSelector('[data-yapin-announcements="off"]');
    check((await page.locator('[data-yapin-posts="empty"]').count()) === 1, "no posts yet");
    await page.fill("[data-yapin-webhook-input]", "https://example.com/hook");
    await page.click("[data-yapin-webhook-save]");
    check((await page.textContent("[data-yapin-webhook-note]"))?.includes("yapin.gg/api/webhooks"), "a webhook off yapin.gg is refused");
    await page.fill("[data-yapin-webhook-input]", "https://cdn.yapin.gg/hooks/1");
    await page.click("[data-yapin-webhook-save]");
    check(db.webhook === null, "a yapin.gg URL that is not /api/webhooks/<id>/<token> is refused");
    await page.fill("[data-yapin-webhook-input]", "https://www.yapper.website/api/webhooks/77/made-up-token-abcd");
    await page.click("[data-yapin-webhook-save]");
    await page.waitForSelector('[data-yapin-announcements="connected"]');
    check(db.webhook?.hint === "abcd", "a webhook on yapper.website (the same service) is taken");
    const hook = "https://www.yapin.gg/api/webhooks/4242/made-up-webhook-secret-wxyz";
    await page.fill("[data-yapin-webhook-input]", hook);
    await page.click("[data-yapin-webhook-save]");
    // Already connected (yapper.website above): wait for the new URL to land.
    for (let i = 0; i < 50 && db.webhook?.url !== hook; i++) await new Promise((r) => setTimeout(r, 100));
    await page.waitForSelector('[data-yapin-announcements="connected"]');
    check(db.webhook?.url === hook, "the webhook URL is saved");
    const api = await page.evaluate(() => fetch("/api/yapin/webhook").then((r) => r.text()));
    check(!api.includes("made-up-webhook-secret") && JSON.parse(api).hint === "wxyz", "the API sends back only the last 4 characters");
    check(!(await page.content()).includes("made-up-webhook-secret"), "the page never shows the URL again");
    await context.close();
  }
  {
    // The encoder's drain against the stand in's webhook: one retried and posted, one posted, one gone (404).
    const now = Date.now();
    db.posts = VIDEOS.slice(0, 3).map((v, i) => ({ id: `p${i + 1}`, videoId: v.id, title: v.title, channel: v.channel, status: "queued", attempts: 0, error: null, queuedAt: new Date(now - i * 3_600_000).toISOString(), finishedAt: null }));
    db.webhook = { url: "https://www.yapin.gg/api/webhooks/4242/made-up-webhook-secret-wxyz", hint: "wxyz" };
    const urlFor = (i) => (i === 2 ? "https://www.yapin.gg/api/webhooks/9999/deleted" : db.webhook.url);
    yapin.answers.set("/api/webhooks/4242/made-up-webhook-secret-wxyz", [500, 204]);
    yapin.answers.set("/api/webhooks/9999/deleted", [404]);
    const fakeDb = {
      async claimYapin() {
        return db.posts.filter((x) => x.status === "queued").map((x, i) => ({ id: x.id, url: urlFor(i), videoId: x.videoId, title: x.title, description: "", thumbnailUrl: null, channelName: x.channel.name, channelHandle: x.channel.handle, attempts: 0 }));
      },
      async yapinResult(id, r) {
        const x = db.posts.find((y) => y.id === id);
        Object.assign(x, { status: r.ok ? "sent" : "failed", attempts: r.tries, error: r.error, finishedAt: new Date().toISOString() });
      },
    };
    // The worker's own fetch, sent to the stand in instead of yapin.gg.
    const fetchFn = (u, init) => fetch(String(u).replace("https://www.yapin.gg", yapinBase), init);
    const lines = [];
    const out = await drainYapin({ db: fakeDb, log: (...a) => lines.push(JSON.stringify(a)), config: { workerName: "checks", siteUrl: "https://tube.example.com", yapinHosts: YAPIN_WEBHOOK_HOSTS } }, { fetchFn, wait: async () => {} });
    check(out.sent === 2 && out.failed === 1, "the drain posts two cards and gives up on the deleted webhook");
    check(db.posts[0].status === "sent" && db.posts[0].attempts === 2, "a 500 is retried and then posted");
    check(db.posts[2].status === "failed" && db.posts[2].attempts === 1 && db.posts[2].error === "Yapin' answered 404", "a 404 is not retried");
    const card = yapin.posted.find((x) => x.status === 204)?.body;
    check(card?.embeds?.[0]?.url === `https://tube.example.com/watch?v=${VIDEOS[0].id}` && card.embeds[0].image.url.endsWith("/thumb-1.webp"), "the card has the watch link and the thumbnail");
    check(card?.content?.endsWith(`\nhttps://tube.example.com/watch?v=${VIDEOS[0].id}`), "the watch link is also in content (Yapin' may not show the embed image)");
    check(JSON.stringify(card?.allowed_mentions) === '{"parse":[]}', "the card pings nobody");
    check(lines.every((l) => !l.includes("made-up-webhook-secret")), "the worker never logs the webhook URL");
  }
  await shots("studio-posts", "/studio/settings", '[data-yapin-posts="list"]', { admin: true });
  {
    const { context, page } = await open("/studio/settings", { admin: true });
    await page.waitForSelector('[data-yapin-posts="list"]');
    check((await page.locator('[data-yapin-post="sent"]').count()) === 2 && (await page.locator('[data-yapin-post="failed"]').count()) === 1, "the studio lists two posted and one failed");
    check((await page.textContent('[data-yapin-post="failed"]'))?.includes("Yapin' answered 404"), "the failed post shows why");
    await page.click("[data-yapin-webhook-remove]");
    await page.waitForSelector('[data-yapin-announcements="off"]');
    check(db.webhook === null, "Disconnect removes the webhook");
    await context.close();
  }
} finally {
  await browser.close();
  site.stop();
  yapinServer.closeAllConnections();
  yapinServer.close();
}

if (failures.length) {
  console.log(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed, screenshots in ${outDir}`);
