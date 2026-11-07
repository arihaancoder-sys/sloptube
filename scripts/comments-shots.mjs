#!/usr/bin/env node
// Checks and screenshots of the comments section and /studio/comments,
// without a real database.
//
//   node scripts/comments-shots.mjs [out-dir]   (default: shots/comments)
//
// 1. Makes a 3 second test clip with ffmpeg, so the player has something to
//    show above the comments.
// 2. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    viewer, a made up channel owner and a few made up commenters, and keeps
//    the comments, likes, the pin and the hearts in memory. Pages are cut
//    with the same order as 012_comments.sql (compareComments and isAfter
//    from lib/comments/cursor.ts).
// 3. Starts `next dev` pointed at it.
// 4. With Playwright: the flag off (the routes say 403, no section); signed
//    out (the sign in prompt, a like goes to sign in); the header and the
//    sort switch; Read more; View replies with the connecting line and Show
//    more replies; infinite scroll; posting with "Posting..." then the real
//    row; a reply to a reply with the @name; like; the "new comments" pill
//    after a comment from somebody else (the 20 second poll); as the owner
//    pin, heart and delete; /studio/comments with heart and delete. Then
//    screenshots at 1280 and 390, light and dark.
//
// Needs ffmpeg and Playwright with Chromium. Made up names and text, no real
// data. Nothing here touches the network.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildEncodeArgs, buildThumbnailArgs, thumbnailName } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";
import { compareComments, isAfter } from "../lib/comments/cursor.ts";
import { cleanBody } from "../lib/comments/rules.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/comments"));
const APP_PORT = Number(process.env.APP_PORT ?? 3462);
const CLIP_S = 3;

const require = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch {
  console.error("Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  process.exit(2);
}

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr?.toString().slice(-500)}`);
}

// 1. Made up people, a channel, a video ---------------------------------------------------

const NOW = Date.now();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const VIEWER = { id: "a0000000-0000-4000-8000-000000000001", email: "viewer@example.com", username: "viewer", name: "Viewer", handle: "viewer" };
const OWNER = { id: "a0000000-0000-4000-8000-000000000002", email: "owner@example.com", username: "owner", name: "Sample Kitchen", handle: "samplekitchen" };
const PEOPLE = [
  ["Pixel Fern", "pixelfern"],
  ["Moss Garden", "mossgarden"],
  ["Night Owl Tapes", "nightowltapes"],
  ["Paper Crane", "papercrane"],
  ["Ridge Runner", "ridgerunner"],
  ["Synth Patch", "synthpatch"],
  ["Coin Robot", "coinrobot"],
  ["Bread Lab", "breadlab"],
].map(([name, handle], i) => ({ id: `a0000000-0000-4000-8000-0000000001${String(i).padStart(2, "0")}`, name, handle }));
const CHANNEL = { id: "c0000000-0000-4000-8000-000000000001", handle: OWNER.handle, name: OWNER.name, owner: OWNER.id, subs: 1234 };
const VIDEO_ID = "f0000000-0000-4000-8000-000000000001";
const AUTHORS = new Map([VIEWER, OWNER, ...PEOPLE].map((p) => [p.id, p]));

const LINES = [
  "This is exactly the recipe I was looking for, thank you!",
  "The bit at the end with the timer saved my breakfast.",
  "Tried it this morning and the whole family asked for seconds.",
  "Could you do a version without eggs next time?",
  "The sound of the pan at the start is so calming.",
  "Watching this at 2am and now I am hungry.",
  "Ten minutes is a lie, it took me twenty, but worth it.",
  "Love how calm these videos are. Subscribed.",
];
const LONG =
  "Okay, long comment incoming.\nFirst, the batter: I let it rest for five minutes like you said and it really does make a difference.\n" +
  "Second, I used a little less sugar and added lemon zest, which I would recommend to anybody who likes things a bit brighter.\n" +
  "Third, the pan heat. Medium low is the secret, I used to burn every single one.\nFourth, butter, not oil.\n" +
  "Fifth, flip once and only once. Thanks for the great video!";

const uuid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = (t) => new Date(t).toISOString().replace("Z", "456+00:00");

// 2. The fixture clip -------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-comments-"));
const hlsDir = join(work, "hls", VIDEO_ID);
mkdirSync(hlsDir, { recursive: true });
const source = join(work, "source.mp4");
console.log(`fixture: making a ${CLIP_S} second clip in`, work);
run("ffmpeg", [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${CLIP_S}`,
  "-f", "lavfi", "-i", `sine=frequency=440:sample_rate=48000:duration=${CLIP_S}`,
  "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
]);
run("ffmpeg", buildEncodeArgs({ input: source, renditions: pickRenditions({ width: 640, height: 360, fps: 30 }), hasAudio: true, segmentSeconds: 2 }), { cwd: hlsDir });
run("ffmpeg", buildThumbnailArgs({ input: source, atSeconds: 1, output: join(hlsDir, thumbnailName(0)) }));
const TYPES = { ".m3u8": "application/vnd.apple.mpegurl", ".m4s": "video/iso.segment", ".mp4": "video/mp4", ".webp": "image/webp" };

// 3. Sessions ------------------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s).toString("base64url");
const exp = Math.floor(NOW / 1000) + 24 * 3600;
function sessionFor(user) {
  const token = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
    b64url("not-a-real-signature"),
  ].join(".");
  const authUser = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
  return { token, authUser, session: { access_token: token, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: authUser } };
}
const SESSIONS = { [VIEWER.id]: sessionFor(VIEWER), [OWNER.id]: sessionFor(OWNER) };
const USERS = [VIEWER, OWNER];

// 4. In memory comments -------------------------------------------------------------------------

const state = { flag: "everyone", delay: 0, mode: "on", comments: [], likes: new Set(), posts: [] };

function seed() {
  state.flag = "everyone";
  state.delay = 0;
  state.mode = "on";
  state.likes.clear();
  state.posts.length = 0;
  const list = [];
  let n = 0;
  const add = (author, body, ago, extra = {}) => {
    const row = { id: uuid(++n), video_id: VIDEO_ID, author_id: author.id, parent_id: null, body, like_count: 0, pinned: false, hearted: false, created_at: stamp(NOW - ago), edited_at: null, deleted_at: null, ...extra };
    list.push(row);
    return row;
  };
  // 28 top level comments over the last few days, likes from 0 to 240.
  for (let i = 0; i < 28; i++) {
    const who = PEOPLE[i % PEOPLE.length];
    add(who, i === 1 ? LONG : LINES[i % LINES.length], (i + 1) * 3.7 * HOUR, { like_count: [240, 96, 51, 33, 18, 12, 7, 5, 3, 2, 1, 0][i % 12] });
  }
  // Replies: 3 under the top comment, 12 under the second one.
  for (let i = 0; i < 3; i++) add(PEOPLE[(i + 3) % 8], ["Same here!", "Agreed, the timer part is great.", "Thanks for the tip."][i], 2 * HOUR - i * 10 * MIN, { parent_id: uuid(1), like_count: 3 - i });
  for (let i = 0; i < 12; i++) add(PEOPLE[i % 8], `Reply number ${i + 1}, the lemon zest idea is a good one.`, 5 * HOUR - i * 5 * MIN, { parent_id: uuid(2) });
  // One from the owner, edited.
  add(OWNER, "Thanks for watching everybody! The next video is about bread.", 26 * HOUR, { like_count: 64, edited_at: stamp(NOW - 25 * HOUR) });
  state.comments = list;
}

const alive = (c) => !c.deleted_at;
const replyCount = (id) => state.comments.filter((c) => c.parent_id === id && alive(c)).length;
const keyOf = (c) => ({ likes: c.like_count, createdAt: c.created_at, id: c.id });

function card(c, me) {
  const a = AUTHORS.get(c.author_id);
  const deleted = !alive(c);
  return {
    id: c.id,
    video_id: c.video_id,
    parent_id: c.parent_id,
    body: deleted ? null : c.body,
    like_count: c.like_count,
    reply_count: replyCount(c.id),
    pinned: c.pinned,
    hearted: c.hearted && !deleted,
    created_at: c.created_at,
    edited_at: c.edited_at,
    deleted,
    author_handle: deleted ? null : a.handle,
    author_name: deleted ? null : a.name,
    author_avatar_url: null,
    by_owner: !deleted && c.author_id === OWNER.id,
    mine: me?.id === c.author_id,
    liked: Boolean(me && state.likes.has(`${me.id}|${c.id}`)),
  };
}

function cursorOf(json) {
  return json && json.at ? { likes: json.likes ?? null, at: json.at, id: json.id } : null;
}

function listComments(me, { sort, cursor, lim }) {
  if (state.mode === "off") return [];
  const after = cursorOf(cursor);
  const top = state.comments.filter((c) => !c.parent_id);
  const pinned = !after ? top.filter((c) => c.pinned && alive(c)) : [];
  const rest = top
    .filter((c) => !c.pinned && (alive(c) || replyCount(c.id) > 0))
    .sort((a, b) => compareComments(sort, keyOf(a), keyOf(b)))
    .filter((c) => !after || isAfter(sort, keyOf(c), after))
    .slice(0, lim);
  return [...pinned, ...rest].map((c) => card(c, me));
}

function listReplies(me, { parent_id, cursor, lim }) {
  const after = cursorOf(cursor);
  return state.comments
    .filter((c) => c.parent_id === parent_id && alive(c))
    .sort((a, b) => compareComments("replies", keyOf(a), keyOf(b)))
    .filter((c) => !after || isAfter("replies", keyOf(c), after))
    .slice(0, lim)
    .map((c) => card(c, me));
}

function since(me, { cursor, lim }) {
  const after = cursorOf(cursor);
  return state.comments
    .filter((c) => !c.parent_id && alive(c))
    .sort((a, b) => compareComments("newest", keyOf(a), keyOf(b)))
    .filter((c) => !after || isAfter("since", keyOf(c), after))
    .slice(0, lim)
    .map((c) => card(c, me));
}

let nextId = 1000;
function insert(author, body, parentId = null) {
  const parent = parentId ? state.comments.find((c) => c.id === parentId) : null;
  const row = { id: uuid(++nextId), video_id: VIDEO_ID, author_id: author.id, parent_id: parent ? (parent.parent_id ?? parent.id) : null, body: cleanBody(body), like_count: 0, pinned: false, hearted: false, created_at: stamp(Date.now()), edited_at: null, deleted_at: null };
  state.comments.push(row);
  return row;
}

const channelRow = () => ({
  id: CHANNEL.id, owner_id: CHANNEL.owner, handle: CHANNEL.handle, name: CHANNEL.name, description: "A made up channel for the comments checks.",
  links: [], avatar_url: null, banner_url: null, handle_changed_at: null, subscriber_count: CHANNEL.subs, video_count: 1,
  created_at: new Date(NOW - 400 * DAY).toISOString(), comments_default: state.mode,
});

// 5. The stand in server -----------------------------------------------------------------------

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message) => send(400, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");

  if (url.pathname.startsWith(`/hls/${VIDEO_ID}/`)) {
    const path = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, "");
    const file = join(work, path);
    if (!file.startsWith(work) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const auth = req.headers.authorization ?? "";
  const me = USERS.find((u) => auth === `Bearer ${SESSIONS[u.id].token}`) ?? null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");
  const on = () => state.flag === "everyone";

  if (url.pathname === "/auth/v1/user") return me ? send(200, SESSIONS[me.id].authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["comments", "watch", "channels", "feed", "accounts", "engagement"].map((key) => ({
      key, label: key, description: "", mode: key === "comments" ? state.flag : key === "engagement" ? "off" : "everyone", users: [], updated_at: null,
    }));
    return send(200, flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    const u = USERS.find((x) => x.id === eq("id"));
    return one(u ? [{ username: u.username, display_name: u.name, avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    if (eq("owner_id") === VIEWER.id) return one([{ handle: VIEWER.handle, comments_default: "on" }]);
    const hit = eq("owner_id") === CHANNEL.owner || eq("handle") === CHANNEL.handle || eq("id") === CHANNEL.id;
    return one(hit ? [channelRow()] : []);
  }

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  const find = () => state.comments.find((c) => c.id === args.comment_id && alive(c));
  const ownerOnly = () => (me?.id === OWNER.id ? null : fail("not_allowed"));
  switch (rpc) {
    case "watch_video":
      if (args.video_id !== VIDEO_ID) return send(200, []);
      return send(200, [{
        id: VIDEO_ID, title: "Fluffy pancakes in ten minutes", description: "A made up video for the comments checks.", visibility: "public", status: "ready",
        is_owner: me?.id === OWNER.id, created_at: stamp(NOW - 3 * DAY), published_at: stamp(NOW - 3 * DAY), duration_s: CLIP_S, width: 640, height: 360,
        views: 48213, renditions: [{ name: "360p", width: 640, height: 360 }], thumbnail_url: null, hls_key: `hls/${VIDEO_ID}/master.m3u8`, preview_sprite_key: null,
        channel_id: CHANNEL.id, channel_handle: CHANNEL.handle, channel_name: CHANNEL.name, channel_avatar_url: null, channel_subscriber_count: CHANNEL.subs,
      }]);
    case "comments_info":
      if (!on() || args.video_id !== VIDEO_ID) return send(200, []);
      return send(200, [{ comment_count: state.comments.filter(alive).length, mode: state.mode, is_owner: me?.id === OWNER.id }]);
    case "list_comments":
      return send(200, on() ? listComments(me, args) : []);
    case "list_replies":
      return send(200, on() ? listReplies(me, args) : []);
    case "comments_since":
      return send(200, on() ? since(me, args) : []);
    case "post_comment": {
      if (!me) return send(401, { code: "42501", message: "permission denied for function post_comment" });
      if (!on()) return fail("comments_off");
      if (state.delay) await new Promise((r) => setTimeout(r, state.delay));
      const row = insert(me, args.body, args.parent_id);
      state.posts.push(row);
      return send(200, [card(row, me)]);
    }
    case "edit_comment": {
      const c = find();
      if (!c) return fail("not_found");
      if (c.author_id !== me?.id) return fail("not_allowed");
      c.body = cleanBody(args.body);
      c.edited_at = stamp(Date.now());
      return send(200, [card(c, me)]);
    }
    case "delete_comment": {
      const c = find();
      if (!c) return fail("not_found");
      if (c.author_id !== me?.id && me?.id !== OWNER.id) return fail("not_allowed");
      Object.assign(c, { deleted_at: stamp(Date.now()), body: "", pinned: false, hearted: false });
      return send(200, true);
    }
    case "like_comment": {
      const c = find();
      if (!me || !c) return fail(me ? "not_found" : "not_signed_in");
      const k = `${me.id}|${c.id}`;
      const want = args.on ?? !state.likes.has(k);
      if (want && !state.likes.has(k)) {
        state.likes.add(k);
        c.like_count++;
      }
      if (!want && state.likes.has(k)) {
        state.likes.delete(k);
        c.like_count--;
      }
      return send(200, [{ liked: state.likes.has(k), like_count: c.like_count }]);
    }
    case "pin_comment": {
      const c = find();
      if (!c) return fail("not_found");
      if (ownerOnly()) return;
      if (args.on) for (const x of state.comments) x.pinned = false;
      c.pinned = Boolean(args.on);
      return send(200, c.pinned);
    }
    case "heart_comment": {
      const c = find();
      if (!c) return fail("not_found");
      if (ownerOnly()) return;
      c.hearted = Boolean(args.on);
      return send(200, c.hearted);
    }
    case "set_channel_comments_default":
      if (ownerOnly()) return;
      state.mode = args.mode;
      return send(200, state.mode);
    case "studio_comments": {
      if (me?.id !== OWNER.id) return send(200, []);
      const rows = state.comments
        .filter(alive)
        .sort((a, b) => compareComments("newest", keyOf(a), keyOf(b)))
        .slice(0, args.lim ?? 50)
        .map((c) => {
          const rest = card(c, me);
          delete rest.deleted;
          delete rest.mine;
          delete rest.liked;
          return { ...rest, video_title: "Fluffy pancakes in ten minutes", channel_default: state.mode };
        });
      return send(200, rows);
    }
    case "video_engagement":
    case "related_videos":
    case "feed_videos":
    case "my_subscriptions":
    case "subscriptions_feed":
      return send(200, []);
  }
  if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
  send(404, { error: "not_found" });
});
await new Promise((r) => mock.listen(0, "127.0.0.1", r));
const mockUrl = `http://127.0.0.1:${mock.address().port}`;
console.log("mock: Supabase and media at", mockUrl);

// 6. next dev ------------------------------------------------------------------------------------

const env = {
  ...process.env,
  NEXT_PUBLIC_SUPABASE_URL: mockUrl,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder-for-the-mock",
  MEDIA_PUBLIC_URL: mockUrl,
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  PORT: String(APP_PORT),
};
const dev = spawn("npx", ["next", "dev", "-p", String(APP_PORT)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
const app = `http://localhost:${APP_PORT}`;

function cleanup() {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {
    dev.kill("SIGTERM");
  }
  mock.closeAllConnections();
  mock.close();
  rmSync(work, { recursive: true, force: true });
}

async function waitForApp() {
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${app}/api/health`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next dev did not start:\n" + devLog.slice(-2000));
}

// 7. Playwright -------------------------------------------------------------------------------

const failures = [];
function check(ok, what) {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  if (!ok) failures.push(what);
}

const cookieFor = (user) => ({ name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSIONS[user.id].session)), domain: "localhost", path: "/" });

async function open(browser, path, { width = 1280, height = 900, theme = "light", scale = 1, user = VIEWER } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
  if (user) await context.addCookies([cookieFor(user)]);
  await context.addInitScript((t) => {
    try {
      localStorage.setItem("sloptube-theme", t);
      localStorage.setItem("sloptube.player.volume", JSON.stringify({ volume: 1, muted: true }));
    } catch {}
  }, theme);
  const page = await context.newPage();
  await page.goto(app + path, { waitUntil: "load" });
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  return { context, page };
}

const WATCH = `/watch?v=${VIDEO_ID}`;
const until = async (fn, ms = 5000) => {
  for (let t = 0; t < ms && !(await fn()); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
const topIds = (page) => page.$$eval('[data-comment-list] > [data-comment-kind="top"]', (els) => els.map((e) => e.getAttribute("data-comment")));
const commentEl = (page, id) => page.locator(`[data-comment="${id}"]`).first();
/** The three dot menu of one comment, then the item with this text. */
async function menu(page, id, item) {
  const row = commentEl(page, id);
  await row.hover();
  await row.locator(":scope > div > div [data-comment-menu] button[aria-label='Comment actions']").first().click();
  await row.locator(`[role="menu"] [role="menuitem"]:has-text("${item}")`).first().click();
}

try {
  await waitForApp();
  for (const p of [WATCH, "/studio/comments"]) await fetch(app + p);
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  // The flag off -----------------------------------------------------------------------------------
  {
    seed();
    state.flag = "off";
    const { context, page } = await open(browser, WATCH);
    await page.waitForSelector('[data-watch-state="ready"]', { timeout: 60000 });
    check((await page.locator("[data-comments]").count()) === 0, "flag off: no comments section on the watch page");
    const res = await page.evaluate(async (v) => {
      const list = await fetch(`/api/comments?v=${v}&sort=top`);
      const post = await fetch("/api/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ videoId: v, body: "hi" }) });
      return { list: [list.status, (await list.json()).error], post: [post.status, (await post.json()).error] };
    }, VIDEO_ID);
    check(res.list[0] === 403 && res.list[1] === "comments_off", `flag off: GET /api/comments answers ${res.list.join(" ")}`);
    check(res.post[0] === 403 && res.post[1] === "comments_off", `flag off: POST /api/comments answers ${res.post.join(" ")}`);
    await page.goto(app + "/studio/comments");
    check((await page.locator('[data-studio-comments-state="off"]').count()) === 1, "flag off: /studio/comments shows the off page");
    await context.close();
  }

  // Signed out ----------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, WATCH, { user: null });
    await page.waitForSelector("[data-comments-signed-out]", { timeout: 60000 });
    check(true, "signed out: the sign in prompt shows instead of the box");
    const header = await page.locator("[data-comments-count]").innerText();
    check(header === `${state.comments.length} Comments`, `signed out: the header reads "${header}"`);
    await page.locator("[data-comment-like]").first().click();
    await page.waitForURL(/\/login\?next=/, { timeout: 15000 });
    check(new URL(page.url()).searchParams.get("next") === WATCH, "signed out: a like goes to /login?next=");
    await context.close();
  }

  // The viewer: sort, read more, replies, infinite scroll, posting, like ------------------------------------
  {
    seed();
    const { context, page } = await open(browser, WATCH);
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    await page.evaluate(() => document.querySelector("video")?.pause());
    let ids = await topIds(page);
    check(ids.length === 20 && ids[0] === uuid(1), `top: 20 comments, the most liked first (${ids.length})`);
    await page.mouse.move(1270, 890);
    const hidden = await commentEl(page, uuid(5)).locator("[data-comment-menu]").first().evaluate((el) => getComputedStyle(el).opacity);
    check(hidden === "0", `menu: the three dots hide until the row is hovered (opacity ${hidden})`);
    await commentEl(page, uuid(5)).hover();
    await page.waitForTimeout(250);
    const shown = await commentEl(page, uuid(5)).locator("[data-comment-menu]").first().evaluate((el) => getComputedStyle(el).opacity);
    check(shown === "1", `menu: and show on hover (opacity ${shown})`);

    // Read more on the long one.
    const long = commentEl(page, uuid(2));
    check((await long.locator("[data-read-more]").first().innerText()) === "Read more", "read more: the long comment folds");
    const folded = await long.locator("[data-comment-body]").first().boundingBox();
    await long.locator("[data-read-more]").first().click();
    const unfolded = await long.locator("[data-comment-body]").first().boundingBox();
    check(unfolded.height > folded.height + 20, `read more: it opens (${Math.round(folded.height)} to ${Math.round(unfolded.height)} px)`);
    check((await long.locator("[data-read-more]").first().innerText()) === "Show less", "read more: then says Show less");
    check((await commentEl(page, uuid(3)).locator("[data-read-more]").count()) === 0, "read more: short comments have no button");

    // View replies.
    const first = commentEl(page, uuid(1));
    check((await first.locator("[data-view-replies]").innerText()).includes("View 3 replies"), "replies: View 3 replies");
    await first.locator("[data-view-replies]").click();
    await page.waitForSelector(`[data-replies="${uuid(1)}"] [data-comment-kind="reply"]`);
    check((await first.locator('[data-comment-kind="reply"]').count()) === 3, "replies: three load, oldest first");
    check((await first.locator("[data-reply-line]").count()) === 1, "replies: with the connecting line");
    const second = commentEl(page, uuid(2));
    await second.locator("[data-view-replies]").click();
    await page.waitForSelector(`[data-replies="${uuid(2)}"] [data-more-replies]`);
    check((await second.locator('[data-comment-kind="reply"]').count()) === 10, "replies: ten of twelve, then Show more replies");
    await second.locator("[data-more-replies]").click();
    await until(async () => (await second.locator('[data-comment-kind="reply"]').count()) === 12);
    check((await second.locator('[data-comment-kind="reply"]').count()) === 12, "replies: all twelve after Show more replies");
    await second.locator("[data-view-replies]").click();
    check((await second.locator('[data-comment-kind="reply"]').count()) === 0, "replies: Hide replies folds them");

    // Infinite scroll.
    await page.locator("[data-comments-sentinel]").scrollIntoViewIfNeeded();
    await until(async () => (await topIds(page)).length > 20);
    ids = await topIds(page);
    check(ids.length === 29 && new Set(ids).size === 29, `scroll: the rest load, no repeats (${ids.length})`);
    check((await page.locator('[data-comments-sentinel="end"]').count()) === 1, "scroll: the end of the list");

    // Sort switch.
    await page.locator("[data-comments-count]").scrollIntoViewIfNeeded();
    await page.locator("[data-sort-button]").click();
    await page.locator('[data-sort="newest"]').click();
    await until(async () => (await topIds(page))[0] === uuid(1));
    ids = await topIds(page);
    check(ids[0] === uuid(1) && ids[1] === uuid(2) && ids.length === 20, "sort: Newest first puts the newest on top");
    await page.locator("[data-sort-button]").click();
    await page.locator('[data-sort="top"]').click();
    await until(async () => (await topIds(page))[1] === uuid(2));

    // Posting.
    state.delay = 1500;
    const box = page.locator("[data-comments] > [data-comment-box] textarea, [data-comments] [data-comment-box] textarea").first();
    await box.click();
    check((await page.locator("[data-comment-cancel]").count()) === 1 && (await page.locator("[data-comment-submit]").isDisabled()), "post: focus shows CANCEL and a disabled COMMENT");
    await box.fill("Made these with blueberries, ten out of ten.");
    await page.locator("[data-comment-submit]").first().click();
    await page.waitForSelector('[data-comment-list] [data-pending="1"]', { timeout: 500 });
    const pendingText = await page.locator('[data-comment-list] [data-pending="1"] [data-comment-time]').innerText();
    check(pendingText === "Posting...", `post: the row shows "${pendingText}" at once`);
    check(state.posts.length === 0, "post: before the server answered");
    await until(async () => (await page.locator('[data-comment-list] [data-pending="1"]').count()) === 0, 5000);
    const posted = state.posts[0];
    check(Boolean(posted) && (await topIds(page))[0] === posted.id, "post: the real row takes its place at the top");
    check((await commentEl(page, posted.id).locator("[data-comment-time]").innerText()) === "Just now", "post: Just now");
    check((await page.locator("[data-comments-count]").innerText()) === `${state.comments.length} Comments`, "post: the header counts it");
    state.delay = 0;

    // A reply to a reply carries the @name.
    if ((await page.locator(`[data-replies="${uuid(1)}"]`).getAttribute("data-replies-open")) !== "1") await first.locator("[data-view-replies]").click();
    await page.waitForSelector(`[data-replies="${uuid(1)}"] [data-comment-kind="reply"]`);
    const reply = first.locator('[data-comment-kind="reply"]').first();
    const oldestReply = state.comments.filter((x) => x.parent_id === uuid(1)).sort((a, b) => compareComments("replies", keyOf(a), keyOf(b)))[0];
    const replyAuthor = AUTHORS.get(oldestReply.author_id);
    await reply.locator("[data-comment-reply]").click();
    const replyBox = reply.locator("[data-reply-box] textarea");
    check((await replyBox.inputValue()) === `@${replyAuthor.handle} `, `reply: starts with @${replyAuthor.handle}`);
    await replyBox.pressSequentially("good call");
    await reply.locator("[data-reply-box] [data-comment-submit]").click();
    await until(() => state.posts.length === 2);
    const r = state.posts[1];
    check(r?.parent_id === uuid(1) && r.body === `@${replyAuthor.handle} good call`, "reply: goes under the top level comment");
    await page.waitForSelector(`[data-comment="${r.id}"] [data-comment-body] a`);
    check((await commentEl(page, r.id).locator("[data-comment-body] a").innerText()) === `@${replyAuthor.handle}`, "reply: the @name is a link");
    check((await first.locator("[data-view-replies]").innerText()).includes("4"), "reply: the count goes to 4");

    // Like.
    const third = commentEl(page, uuid(3));
    const likesBefore = state.comments.find((c) => c.id === uuid(3)).like_count;
    await third.locator("[data-comment-like]").first().click();
    await until(() => state.likes.has(`${VIEWER.id}|${uuid(3)}`));
    check((await third.locator("[data-comment-likes]").first().innerText()) === String(likesBefore + 1), "like: the count goes up");
    check((await third.locator("[data-comment-like][data-on]").count()) >= 1, "like: the thumb turns blue");
    await third.locator("[data-comment-dislike]").first().click();
    check((await third.locator("[data-comment-dislike]").first().innerText()) === "", "dislike: a button only, no count");
    await third.locator("[data-comment-like]").first().click();
    await until(() => !state.likes.has(`${VIEWER.id}|${uuid(3)}`));
    check(!state.likes.has(`${VIEWER.id}|${uuid(3)}`), "like: a second click takes it back");

    // The menu: no pin for a viewer, report placeholder.
    await menu(page, uuid(3), "Report");
    await page.waitForSelector("[data-sub-toast]");
    check((await page.locator("[data-sub-toast]").innerText()).includes("Reporting"), "menu: Report is a placeholder");

    // The new comments pill: somebody else comments; the poll finds it within 20 seconds.
    insert(PEOPLE[4], "Just found this channel, these are great.");
    insert(PEOPLE[5], "Making these tonight.");
    await page.locator("[data-comments-count]").scrollIntoViewIfNeeded();
    await page.waitForSelector("[data-new-comments]", { timeout: 25000 });
    check((await page.locator("[data-new-comments]").innerText()) === "2 new comments", "pill: 2 new comments after the poll");
    check(!(await topIds(page)).includes(state.comments.at(-1).id), "pill: not in the list before the click");
    await page.screenshot({ path: join(outDir, "pill-1280-light.png") });
    await page.locator("[data-new-comments]").click();
    ids = await topIds(page);
    check(ids[0] === state.comments.at(-1).id && ids[1] === state.comments.at(-2).id, "pill: a click puts them at the top, newest first");
    check((await page.locator("[data-new-comments]").count()) === 0, "pill: then it goes");
    await context.close();
  }

  // The owner: pin, heart, delete ---------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, WATCH, { user: OWNER });
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    await page.evaluate(() => document.querySelector("video")?.pause());
    const target = uuid(4);
    await commentEl(page, target).scrollIntoViewIfNeeded();
    await menu(page, target, "Pin");
    await until(() => state.comments.find((c) => c.id === target).pinned);
    check((await topIds(page))[0] === target, "owner: Pin moves it to the top");
    check((await commentEl(page, target).locator("[data-pinned-badge]").innerText()).includes(`Pinned by ${OWNER.name}`), "owner: Pinned by Sample Kitchen");
    await menu(page, target, "Heart");
    await until(() => state.comments.find((c) => c.id === target).hearted);
    check((await commentEl(page, target).locator("[data-creator-heart]").count()) === 1, "owner: the creator heart shows");
    await menu(page, uuid(1), "Pin");
    await until(() => state.comments.find((c) => c.id === uuid(1)).pinned);
    check(!state.comments.find((c) => c.id === target).pinned && (await topIds(page))[0] === uuid(1), "owner: one pin per video, the new one wins");
    // Owner badge on their own comment.
    const ownRow = state.comments.find((c) => c.author_id === OWNER.id);
    check((await commentEl(page, ownRow.id).locator("[data-comment-time]").innerText()).includes("(edited)"), "owner: edited comments say so");
    // Delete somebody's comment (no replies: it goes).
    const doomed = uuid(6);
    await menu(page, doomed, "Delete");
    await page.locator("[data-confirm-delete]").click();
    await until(async () => (await page.locator(`[data-comment="${doomed}"]`).count()) === 0);
    check(Boolean(state.comments.find((c) => c.id === doomed).deleted_at), "owner: Delete removes a viewer's comment");
    // Delete one with replies: it stays as deleted.
    await menu(page, uuid(2), "Delete");
    await page.locator("[data-confirm-delete]").click();
    await page.waitForSelector(`[data-comment="${uuid(2)}"] [data-comment-deleted]`);
    check(true, "owner: a deleted comment with replies keeps its place");
    await page.reload();
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    check((await topIds(page))[0] === uuid(1) && (await commentEl(page, uuid(4)).locator("[data-creator-heart]").count()) === 1, "owner: pin and heart are still there after a reload");
    await context.close();
  }

  // /studio/comments -----------------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/studio/comments", { user: OWNER });
    await page.waitForSelector('[data-studio-comments-state="ready"]', { timeout: 60000 });
    const rows = await page.locator("[data-studio-comment]").count();
    check(rows === Math.min(50, state.comments.length), `studio: the latest ${rows} comments`);
    const firstId = await page.locator("[data-studio-comment]").first().getAttribute("data-studio-comment");
    await page.locator("[data-studio-comment]").first().locator("[data-studio-heart]").click();
    await until(() => state.comments.find((c) => c.id === firstId).hearted);
    check(state.comments.find((c) => c.id === firstId).hearted, "studio: heart");
    await page.screenshot({ path: join(outDir, "studio-1280-light.png") });
    await page.locator("[data-studio-comment]").first().locator("[data-studio-delete]").click();
    await until(async () => (await page.locator(`[data-studio-comment="${firstId}"]`).count()) === 0);
    check(Boolean(state.comments.find((c) => c.id === firstId).deleted_at), "studio: delete");
    await page.locator("[data-channel-comments-mode]").selectOption("off");
    await until(() => state.mode === "off");
    check(state.mode === "off", "studio: the channel default changes");
    await context.close();
    // With comments off the watch page says so.
    const v = await open(browser, WATCH, { user: VIEWER });
    await v.page.waitForSelector("[data-comments-off]", { timeout: 60000 });
    check(true, "comments off: the watch page says Comments are turned off");
    await v.context.close();
  }

  // Screenshots ----------------------------------------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      seed();
      const c = state.comments.find((x) => x.id === uuid(1));
      c.pinned = true;
      c.hearted = true;
      const { context, page } = await open(browser, WATCH, { width, height: width === 390 ? 844 : 900, theme, scale: 2 });
      await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
      await page.evaluate(() => document.querySelector("video")?.pause());
      await commentEl(page, uuid(1)).locator("[data-view-replies]").click();
      await page.waitForSelector(`[data-replies="${uuid(1)}"] [data-comment-kind="reply"]`);
      await page.locator("[data-comments] [data-comment-box] textarea").first().click();
      await page.locator("[data-comments-count]").evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 72));
      await page.mouse.move(width - 2, 2);
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(outDir, `watch-${width}-${theme}.png`) });
      await context.close();

      const s = await open(browser, "/studio/comments", { width, height: width === 390 ? 844 : 900, theme, scale: 2, user: OWNER });
      await s.page.waitForSelector('[data-studio-comments-state="ready"]', { timeout: 60000 });
      await s.page.screenshot({ path: join(outDir, `studio-${width}-${theme}.png`) });
      await s.context.close();
    }
  }
  // Read more and a long thread, owner view.
  {
    seed();
    const { context, page } = await open(browser, WATCH, { width: 390, height: 844, scale: 2, user: OWNER });
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    await page.evaluate(() => document.querySelector("video")?.pause());
    await commentEl(page, uuid(2)).scrollIntoViewIfNeeded();
    await page.locator(`[data-comment="${uuid(2)}"] [data-comment-body]`).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 120));
    await page.screenshot({ path: join(outDir, "read-more-390-light.png") });
    await context.close();
  }
  await browser.close();
} catch (err) {
  console.error(err);
  failures.push(String(err?.message ?? err));
} finally {
  cleanup();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed`);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${outDir}`);
process.exit(0);
