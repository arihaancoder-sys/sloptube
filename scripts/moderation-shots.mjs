#!/usr/bin/env node
// Checks and screenshots of moderation (feature 14), without a real database.
//
//   node scripts/moderation-shots.mjs [out-dir]   (default: shots/moderation)
//
// 1. Makes a 3 second test clip with ffmpeg, so the watch page has a player.
// 2. Starts a tiny local server that stands in for Supabase (REST, RPCs and
//    the auth user endpoint) and the public bucket domain. It knows a made up
//    viewer, a made up channel owner, a made up admin and a banned account,
//    and keeps the reports, the word list, the mod log, strikes and the
//    removals in memory, with the same rules as 016_moderation.sql (one
//    report per person per target, 10 a day, the word list and the 5 link
//    cap on comments, 3 strikes in 90 days suspend, one appeal per removal).
//    The queue is grouped by lib/moderation/queue.ts, like the app does.
// 3. Starts `next dev` pointed at it.
// 4. With Playwright: the flag off (no Report on the watch page, the comment
//    menu placeholder, no flag on the channel page, /admin a 404 even for the
//    admin); with the flag on: report a video, a comment and a channel, a
//    second report on the same video, "Something else" needs words; a
//    comment with a listed word and one with 6 links are refused; /admin is a
//    404 for the viewer; the admin's queue grouped with counts and the
//    latest reason, remove (a reason is needed), strike to suspension,
//    dismiss, find a channel, unsuspend; the removed comment placeholder;
//    the owner's "Your video was removed" and the appeal, which shows up in
//    the queue and restores the video; /admin/log and /admin/words (add and
//    remove); a banned account signed out on its next page. Then screenshots
//    at 1280 and 390, light and dark.
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
import { cleanBody } from "../lib/comments/rules.ts";
import { LINK_LIMIT, REPORTS_PER_DAY } from "../lib/moderation/rules.ts";
import { STRIKE_DAYS, STRIKE_LIMIT, activeStrikes } from "../lib/moderation/strikes.ts";
import { countLinks, findBlockedWord, isWord } from "../lib/moderation/words.ts";

const root = resolve(new URL("..", import.meta.url).pathname);
const outDir = resolve(process.argv[2] ?? join(root, "shots/moderation"));
const APP_PORT = Number(process.env.APP_PORT ?? 3482);
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

// 1. Made up people, channels, videos ------------------------------------------------------

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const person = (n, username, name, handle) => ({ id: `a0000000-0000-4000-8000-00000000000${n}`, email: `${username}@example.com`, username, name, handle, channel: `c0000000-0000-4000-8000-00000000000${n}` });
const VIEWER = person(1, "viewer", "Viewer", "viewer");
const OWNER = person(2, "owner", "Sample Kitchen", "samplekitchen");
const ADMIN = person(3, "mod", "Site Admin", "siteadmin");
const BANNED = person(4, "spammer", "Spam Place", "spamplace");
const USERS = [VIEWER, OWNER, ADMIN, BANNED];
const VIDEO_ID = "f0000000-0000-4000-8000-000000000001";
const SPAM_VIDEO = "f0000000-0000-4000-8000-000000000002";
const stamp = (t) => new Date(t).toISOString();
const cid = (n) => `d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rid = (n) => `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const state = {};
let nextId = 100;

function seed() {
  Object.assign(state, {
    flag: "everyone",
    banned: new Set([BANNED.id]),
    suspended: new Map(),
    strikes: [],
    words: [{ word: "giftcard*", created_at: stamp(NOW - 9 * DAY), added_by: ADMIN.id }],
    log: [],
    reports: [],
    videos: [
      { id: VIDEO_ID, owner: OWNER, title: "Fluffy pancakes in ten minutes", description: "One bowl, no mixer.", visibility: "public", removed_at: null, removed_reason: null, removed_visibility: null, views: 48213, created_at: stamp(NOW - 3 * DAY) },
      { id: SPAM_VIDEO, owner: BANNED, title: "Free gift cards, click the link", description: "", visibility: "public", removed_at: null, removed_reason: null, removed_visibility: null, views: 311, created_at: stamp(NOW - 2 * DAY) },
    ],
    comments: [
      { id: cid(1), author: BANNED, body: "Click my channel for free stuff www.spam.example", parent_id: null, created_at: stamp(NOW - 5 * HOUR), deleted_at: null, removed_at: null, like_count: 0 },
      { id: cid(2), author: VIEWER, body: "The timer trick at the end saved my breakfast.", parent_id: null, created_at: stamp(NOW - 4 * HOUR), deleted_at: null, removed_at: null, like_count: 12 },
      { id: cid(3), author: ADMIN, body: "Please keep it kind in here.", parent_id: cid(1), created_at: stamp(NOW - 3 * HOUR), deleted_at: null, removed_at: null, like_count: 2 },
    ],
  });
  // Reports already waiting: three on the spam video, one on the comment, an older strike.
  const add = (n, reporter, kind, targetKind, targetId, reason, details, hoursAgo) =>
    state.reports.push({ id: rid(n), kind, reporter, target_kind: targetKind, target_id: targetId, reason, details, status: "open", created_at: stamp(NOW - hoursAgo * HOUR) });
  add(1, OWNER, "report", "video", SPAM_VIDEO, "spam", "Same link in every video", 6);
  add(2, ADMIN, "report", "video", SPAM_VIDEO, "spam", "", 5);
  add(3, { id: "a0000000-0000-4000-8000-000000000009", name: "Pixel Fern" }, "report", "video", SPAM_VIDEO, "other", "The title is a trick", 1);
  add(4, OWNER, "report", "comment", cid(1), "harassment", "", 2);
  state.strikes.push({ channel: BANNED.channel, at: NOW - 40 * DAY });
}

seed();

const channelOf = (u) => ({ id: u.channel, owner_id: u.id, handle: u.handle, name: u.name, description: "A made up channel for the moderation checks.", links: [], avatar_url: null, banner_url: null, handle_changed_at: null, subscriber_count: 1234, video_count: 1, created_at: stamp(NOW - 400 * DAY), comments_default: "on", suspended_at: state.suspended.get(u.channel) ?? null });
const userByChannel = (id) => USERS.find((u) => u.channel === id);
const on = () => state.flag === "everyone";
const strikesOf = (channel) => activeStrikes(state.strikes.filter((s) => s.channel === channel).map((s) => s.at), Date.now()).length;
const isAdmin = (me) => me?.id === ADMIN.id && !state.banned.has(me.id);

function log(action, targetKind, targetId, label, reason) {
  state.log.push({ id: rid(500 + state.log.length), created_at: stamp(Date.now() + state.log.length), action, target_kind: targetKind, target_id: targetId, target_label: label ?? "", reason: reason ?? "", actor_name: ADMIN.name });
}

function ownerOf(kind, id) {
  if (kind === "video") return state.videos.find((v) => v.id === id)?.owner ?? null;
  if (kind === "comment") return state.comments.find((c) => c.id === id)?.author ?? null;
  return userByChannel(id) ?? null;
}

function labelOf(kind, id) {
  if (kind === "video") return state.videos.find((v) => v.id === id)?.title ?? null;
  if (kind === "comment") return state.comments.find((c) => c.id === id)?.body?.slice(0, 200) ?? null;
  return userByChannel(id)?.name ?? null;
}

function adminReports() {
  return state.reports
    .filter((r) => r.status === "open")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => {
      const owner = ownerOf(r.target_kind, r.target_id);
      const v = r.target_kind === "video" ? state.videos.find((x) => x.id === r.target_id) : null;
      const c = r.target_kind === "comment" ? state.comments.find((x) => x.id === r.target_id) : null;
      return {
        id: r.id, kind: r.kind, target_kind: r.target_kind, target_id: r.target_id, reason: r.reason, details: r.details, created_at: r.created_at,
        reporter_name: r.reporter.name, target_label: labelOf(r.target_kind, r.target_id), video_id: v ? v.id : c ? VIDEO_ID : null,
        channel_id: owner?.channel ?? null, channel_handle: owner?.handle ?? null, channel_name: owner?.name ?? null,
        channel_suspended: owner ? state.suspended.has(owner.channel) : false, channel_strikes: owner ? strikesOf(owner.channel) : 0,
        owner_banned: owner ? state.banned.has(owner.id) : false, owner_admin: owner?.id === ADMIN.id,
        target_removed: Boolean(v?.removed_at || c?.removed_at), target_gone: !owner,
      };
    });
}

function suspend(channel, why) {
  if (state.suspended.has(channel)) return false;
  state.suspended.set(channel, stamp(Date.now()));
  state.suspendReason = { ...(state.suspendReason ?? {}), [channel]: why };
  return true;
}

function modAction({ action, target_kind: kind, target_id: id, reason, kind: rkind = "report" }) {
  const owner = ownerOf(kind, id);
  const why = String(reason ?? "").trim();
  if (["remove", "strike", "suspend", "ban"].includes(action) && !why) return { error: "reason_required" };
  if (!owner && action !== "dismiss") return { error: "not_found" };
  if (["strike", "suspend", "ban"].includes(action) && owner.id === ADMIN.id) return { error: "not_allowed" };
  const label = labelOf(kind, id);
  if (action === "remove") {
    if (kind === "video") {
      const v = state.videos.find((x) => x.id === id);
      if (!v.removed_at) Object.assign(v, { removed_at: stamp(Date.now()), removed_reason: why, removed_visibility: v.visibility, visibility: "private" });
      log("remove_video", "video", id, label, why);
    } else if (kind === "comment") {
      const c = state.comments.find((x) => x.id === id);
      Object.assign(c, { removed_at: stamp(Date.now()), deleted_at: stamp(Date.now()), body: "" });
      log("remove_comment", "comment", id, label, why);
    } else return { error: "bad_action" };
  } else if (action === "restore") {
    const v = state.videos.find((x) => x.id === id);
    if (!v?.removed_at) return { error: "not_removed" };
    Object.assign(v, { removed_at: null, removed_reason: null, visibility: v.removed_visibility ?? "private", removed_visibility: null });
    log("restore_video", "video", id, label, why);
  } else if (action === "strike") {
    state.strikes.push({ channel: owner.channel, at: Date.now() });
    log("strike", "channel", owner.channel, owner.name, why);
    if (strikesOf(owner.channel) >= STRIKE_LIMIT && suspend(owner.channel, why)) log("suspend", "channel", owner.channel, owner.name, `${STRIKE_LIMIT} strikes in ${STRIKE_DAYS} days`);
  } else if (action === "suspend") {
    suspend(owner.channel, why);
    log("suspend", "channel", owner.channel, owner.name, why);
  } else if (action === "unsuspend") {
    state.suspended.delete(owner.channel);
    log("unsuspend", "channel", owner.channel, owner.name, why);
  } else if (action === "ban") {
    state.banned.add(owner.id);
    suspend(owner.channel, why);
    log("ban", "user", owner.id, owner.username, why);
  } else if (action === "unban") {
    state.banned.delete(owner.id);
    log("unban", "user", owner.id, owner.username, why);
  } else {
    log("dismiss", kind, id, label, why);
  }
  let closed = 0;
  if (["dismiss", "remove", "restore", "strike", "suspend", "ban"].includes(action)) {
    for (const r of state.reports) {
      if (r.status === "open" && r.kind === rkind && r.target_kind === kind && r.target_id === id) {
        r.status = action === "dismiss" ? "dismissed" : "actioned";
        closed++;
      }
    }
  }
  return { data: { closed, suspended: owner ? state.suspended.has(owner.channel) : false } };
}

function reportTarget(me, { target_kind: kind, target_id: id, reason, details }) {
  const owner = ownerOf(kind, id);
  if (!owner) return { error: "not_found" };
  if (owner.id === me.id) return { error: "not_allowed" };
  if (reason === "other" && !String(details ?? "").trim()) return { error: "details_required" };
  const mine = state.reports.filter((r) => r.reporter.id === me.id && r.kind === "report");
  if (mine.some((r) => r.target_kind === kind && r.target_id === id)) return { error: "already_reported" };
  if (mine.filter((r) => Date.parse(r.created_at) > Date.now() - DAY).length >= REPORTS_PER_DAY) return { error: "rate_limited" };
  const row = { id: rid(++nextId), kind: "report", reporter: me, target_kind: kind, target_id: id, reason, details: String(details ?? "").trim(), status: "open", created_at: stamp(Date.now()) };
  state.reports.push(row);
  return { data: row.id };
}

function appealOf(v) {
  if (!v.removed_at) return null;
  const a = state.reports.filter((r) => r.kind === "appeal" && r.target_id === v.id && r.created_at >= v.removed_at).sort((x, y) => y.created_at.localeCompare(x.created_at))[0];
  return a?.status ?? null;
}

// 2. The fixture clip -------------------------------------------------------------------------

const work = mkdtempSync(join(tmpdir(), "sloptube-moderation-"));
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
const SESSIONS = Object.fromEntries(USERS.map((u) => [u.id, sessionFor(u)]));

// 4. The stand in server -----------------------------------------------------------------------

function card(c, me) {
  const deleted = Boolean(c.deleted_at);
  return {
    id: c.id, video_id: VIDEO_ID, parent_id: c.parent_id, body: deleted ? null : c.body, like_count: c.like_count,
    reply_count: state.comments.filter((r) => r.parent_id === c.id && !r.deleted_at).length, pinned: false, hearted: false,
    created_at: c.created_at, edited_at: null, deleted, author_handle: deleted ? null : c.author.handle, author_name: deleted ? null : c.author.name,
    author_avatar_url: null, by_owner: !deleted && c.author.id === OWNER.id, mine: me?.id === c.author.id, liked: false, removed: Boolean(c.removed_at),
  };
}

const mock = createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (status, body, type = "application/json") => {
    res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const fail = (message, status = 400) => send(status, { code: "P0001", message });
  if (req.method === "OPTIONS") return send(204, "", "text/plain");

  const media = url.pathname.match(/^\/hls\/([0-9a-f-]{36})\/(.+)$/);
  if (media) {
    const file = normalize(join(hlsDir, media[2]));
    if (!file.startsWith(hlsDir) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*" });
    return createReadStream(file).pipe(res);
  }

  let raw = "";
  for await (const chunk of req) raw += chunk;
  const args = raw ? JSON.parse(raw) : {};
  const auth = req.headers.authorization ?? "";
  const me = USERS.find((u) => SESSIONS[u.id] && auth === `Bearer ${SESSIONS[u.id].token}`) ?? null;
  const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
  const eq = (name) => url.searchParams.get(name)?.replace(/^(eq|ilike)\./, "");

  if (url.pathname === "/auth/v1/user") return me ? send(200, SESSIONS[me.id].authUser) : send(401, { msg: "no session" });
  if (url.pathname === "/auth/v1/logout") return send(204, "", "text/plain");
  // Every API request of a banned account is refused (moderation_pre_request).
  if (me && state.banned.has(me.id) && url.pathname.startsWith("/rest/v1/")) return fail("banned");

  if (url.pathname === "/rest/v1/feature_flags") {
    const flags = ["moderation", "comments", "watch", "channels", "feed", "accounts", "studio", "upload"].map((key) => ({
      key, label: key, description: "", mode: key === "moderation" ? state.flag : "everyone", users: [], updated_at: null,
    }));
    return one(eq("key") ? flags.filter((f) => f.key === eq("key")) : flags);
  }
  if (url.pathname === "/rest/v1/profiles") {
    const u = USERS.find((x) => x.id === eq("id"));
    return one(u ? [{ id: u.id, username: u.username, display_name: u.name, avatar_url: null, bio: "", onboarded: true }] : []);
  }
  if (url.pathname === "/rest/v1/channels") {
    const u = USERS.find((x) => x.id === eq("owner_id") || x.channel === eq("id") || x.handle === eq("handle")?.toLowerCase());
    return one(u ? [channelOf(u)] : []);
  }
  if (url.pathname === "/rest/v1/videos") return send(200, []);

  const rpc = url.pathname.replace("/rest/v1/rpc/", "");
  const adminOnly = ["is_admin", "admin_reports", "admin_suspended", "admin_log", "admin_words", "mod_action", "admin_set_word"];
  if (adminOnly.includes(rpc) && rpc !== "is_admin") {
    if (!me) return send(401, { code: "42501", message: "permission denied for function " + rpc });
    if (!on()) return fail("moderation_off");
    if (!isAdmin(me)) return fail("not_admin");
  }
  if ((rpc === "report_target" || rpc === "appeal_removal") && !me) return send(401, { code: "42501", message: "permission denied for function " + rpc });
  if ((rpc === "report_target" || rpc === "appeal_removal") && !on()) return fail("moderation_off");

  switch (rpc) {
    case "is_admin":
      return send(200, isAdmin(me));
    case "admin_reports":
      return send(200, adminReports());
    case "admin_suspended":
      return send(200, [...state.suspended].map(([channel, at]) => {
        const u = userByChannel(channel);
        return { channel_id: channel, handle: u.handle, name: u.name, suspended_at: at, reason: state.suspendReason?.[channel] ?? "", strikes: strikesOf(channel), banned: state.banned.has(u.id) };
      }));
    case "admin_log":
      return send(200, [...state.log].sort((a, b) => b.created_at.localeCompare(a.created_at)).filter((l) => !args.before || l.created_at < args.before).slice(0, args.lim ?? 50));
    case "admin_words":
      return send(200, [...state.words].sort((a, b) => a.word.localeCompare(b.word)).map((w) => ({ ...w, added_by: USERS.find((u) => u.id === w.added_by)?.username ?? "" })));
    case "admin_set_word": {
      if (!isWord(args.word)) return fail("bad_word");
      const had = state.words.some((w) => w.word === args.word);
      if (args.on !== false && !had) {
        state.words.push({ word: args.word, created_at: stamp(Date.now()), added_by: me.id });
        log("add_word", "word", null, args.word, "");
      } else if (args.on === false && had) {
        state.words = state.words.filter((w) => w.word !== args.word);
        log("remove_word", "word", null, args.word, "");
      }
      return send(200, null);
    }
    case "mod_action": {
      const r = modAction(args);
      return r.error ? fail(r.error) : send(200, r.data);
    }
    case "report_target": {
      const r = reportTarget(me, args);
      return r.error ? fail(r.error) : send(200, JSON.stringify(r.data));
    }
    case "appeal_removal": {
      const v = state.videos.find((x) => x.id === args.video_id);
      if (!v) return fail("not_found");
      if (v.owner.id !== me.id) return fail("not_allowed");
      if (!v.removed_at) return fail("not_removed");
      if (appealOf(v)) return fail("already_appealed");
      const row = { id: rid(++nextId), kind: "appeal", reporter: me, target_kind: "video", target_id: v.id, reason: "appeal", details: String(args.details ?? ""), status: "open", created_at: stamp(Date.now()) };
      state.reports.push(row);
      return send(200, JSON.stringify(row.id));
    }
    case "moderation_status":
      return send(200, { admin: isAdmin(me), flag: on(), banned: false, suspended: me ? state.suspended.has(me.channel) : false, strikes: me ? strikesOf(me.channel) : 0 });
    case "watch_video": {
      const v = state.videos.find((x) => x.id === args.video_id);
      if (!v || (v.visibility === "private" && v.owner.id !== me?.id)) return send(200, []);
      return send(200, [{
        id: v.id, title: v.title, description: v.description, visibility: v.visibility, status: "ready",
        is_owner: me?.id === v.owner.id, created_at: v.created_at, published_at: v.created_at, duration_s: CLIP_S, width: 640, height: 360,
        views: v.views, renditions: [{ name: "360p", width: 640, height: 360 }], thumbnail_url: null, hls_key: `hls/${VIDEO_ID}/master.m3u8`, preview_sprite_key: null,
        channel_id: v.owner.channel, channel_handle: v.owner.handle, channel_name: v.owner.name, channel_avatar_url: null, channel_subscriber_count: 1234,
      }]);
    }
    case "comments_info":
      if (args.video_id !== VIDEO_ID) return send(200, []);
      return send(200, [{ comment_count: state.comments.filter((c) => !c.deleted_at).length, mode: "on", is_owner: me?.id === OWNER.id }]);
    case "list_comments":
      if (args.cursor) return send(200, []);
      return send(200, state.comments.filter((c) => !c.parent_id && (!c.deleted_at || state.comments.some((r) => r.parent_id === c.id))).sort((a, b) => b.like_count - a.like_count).map((c) => card(c, me)));
    case "list_replies":
      return send(200, args.cursor ? [] : state.comments.filter((c) => c.parent_id === args.parent_id && !c.deleted_at).map((c) => card(c, me)));
    case "comments_since":
      return send(200, []);
    case "post_comment": {
      if (!me) return send(401, { code: "42501", message: "permission denied for function post_comment" });
      const body = cleanBody(args.body);
      if (state.suspended.has(me.channel)) return fail("suspended");
      if (on() && findBlockedWord(body, state.words.map((w) => w.word))) return fail("blocked_words");
      if (on() && countLinks(body) > LINK_LIMIT) return fail("too_many_links");
      const row = { id: cid(++nextId), author: me, body, parent_id: args.parent_id ?? null, created_at: stamp(Date.now()), deleted_at: null, removed_at: null, like_count: 0 };
      state.comments.push(row);
      return send(200, [card(row, me)]);
    }
    case "studio_videos": {
      if (!me || args.trash) return send(200, []);
      return send(200, state.videos.filter((v) => v.owner.id === me.id).map((v) => ({
        id: v.id, title: v.title, description: v.description, visibility: v.visibility, status: "ready", is_short: false, short_choice: null, duration_s: CLIP_S,
        thumbnail_url: null, thumbnail_name: null, hls_key: `hls/${v.id}/master.m3u8`, tags: [], comments_mode: null, created_at: v.created_at, published_at: v.created_at,
        views: v.views, like_count: 2310, comment_count: 3, deleted_at: null, trash_visibility: null,
        purge_at: v.removed_at ? stamp(Date.parse(v.removed_at) + 30 * DAY) : null, removed_at: v.removed_at, removed_reason: v.removed_reason, appeal: appealOf(v),
      })));
    }
    case "studio_comments":
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

// 5. next dev ------------------------------------------------------------------------------------

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

// 6. Playwright -------------------------------------------------------------------------------

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
  page.on("pageerror", (e) => failures.push(`page error on ${path}: ${e.message}`));
  const response = await go(page, path);
  return { context, page, response };
}

/** page.goto, once more when `next dev` cuts a navigation short while it compiles. */
async function go(page, path) {
  let res;
  try {
    res = await page.goto(app + path, { waitUntil: "load" });
  } catch {
    res = await page.goto(app + path, { waitUntil: "load" });
  }
  // The next dev badge stays out of the screenshots.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" }).catch(() => {});
  return res;
}

const WATCH = `/watch?v=${VIDEO_ID}`;
const until = async (fn, ms = 5000) => {
  for (let t = 0; t < ms && !(await fn()); t += 100) await new Promise((r) => setTimeout(r, 100));
  return fn();
};
const pause = (page) => page.evaluate(() => document.querySelector("video")?.pause()).catch(() => {});
async function commentMenu(page, id) {
  const row = page.locator(`[data-comment="${id}"]`).first();
  await row.hover();
  await row.locator("[data-comment-menu] button[aria-label='Comment actions']").first().click();
}
async function fillReport(page, reason, details = "") {
  await page.waitForSelector("[data-report-dialog]");
  await page.locator(`[data-report-reason="${reason}"] input`).check();
  if (details) await page.locator("[data-report-details]").fill(details);
}
const openReports = (kind, id) => state.reports.filter((r) => r.status === "open" && r.target_kind === kind && r.target_id === id);
const group = (page, key) => page.locator(`[data-queue-group="${key}"]`);

try {
  await waitForApp();
  for (const p of [WATCH, "/admin", "/admin/log", "/admin/words", `/@${OWNER.handle}`, "/studio/content", "/login"]) await fetch(app + p).catch(() => {});
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });

  // The flag off --------------------------------------------------------------------------------
  {
    seed();
    state.flag = "off";
    const { context, page } = await open(browser, WATCH);
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    await pause(page);
    check((await page.locator("button[aria-label='More actions'][aria-haspopup]").count()) === 0, "flag off: the watch page keeps the More placeholder, no Report");
    await commentMenu(page, cid(1));
    check((await page.locator("[data-report-open]").count()) === 0, "flag off: the comment menu has the old Report placeholder");
    await page.keyboard.press("Escape");
    await go(page, `/@${OWNER.handle}`);
    await page.waitForSelector("h1");
    check((await page.locator('[data-report-open="channel"]').count()) === 0, "flag off: no report flag on the channel page");
    await context.close();
    const a = await open(browser, "/admin", { user: ADMIN });
    check(a.response?.status() === 404, `flag off: /admin is a 404 for the admin (${a.response?.status()})`);
    await a.context.close();
  }

  // The viewer reports ------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, WATCH);
    await page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
    await pause(page);
    await page.locator("button[aria-label='More actions'][aria-haspopup]").click();
    await page.locator('[data-report-open="video"]').click();
    await fillReport(page, "other");
    check(await page.locator("[data-report-send]").isDisabled(), "report: Something else needs a few words first");
    await page.locator("[data-report-details]").fill("The thumbnail has nothing to do with the video");
    await page.locator("[data-report-send]").click();
    await page.waitForSelector("text=Thanks for reporting");
    check(openReports("video", VIDEO_ID).length === 1 && openReports("video", VIDEO_ID)[0].reason === "other", "report: the video report is stored with its reason and text");
    // The same video again: one report per person per target.
    await page.locator("button[aria-label='More actions'][aria-haspopup]").click();
    await page.locator('[data-report-open="video"]').click();
    await fillReport(page, "spam");
    await page.locator("[data-report-send]").click();
    await page.waitForSelector("text=You reported this already");
    check(openReports("video", VIDEO_ID).length === 1, "report: a second report on the same video is not stored");

    await commentMenu(page, cid(1));
    await page.locator('[data-report-open="comment"]').click();
    await fillReport(page, "spam");
    await page.locator("[data-report-send]").click();
    await until(() => openReports("comment", cid(1)).length === 2);
    check(openReports("comment", cid(1)).length === 2, "report: the comment report joins the one already there");

    // Automod: a listed word, and 6 links.
    const box = page.locator("[data-comments] [data-comment-box] textarea").first();
    await box.click();
    await box.fill("Get a GIFTCARDS deal here");
    await page.locator("[data-comments] [data-comment-box] button:has-text('Comment')").first().click();
    await page.waitForSelector("text=contains a word that isn't allowed");
    check(!state.comments.some((c) => /GIFTCARDS/.test(c.body)), "automod: a comment with a listed word is refused with a plain message");
    await box.click();
    await box.fill(Array.from({ length: 6 }, (_, i) => `https://e${i}.example`).join(" "));
    await page.locator("[data-comments] [data-comment-box] button:has-text('Comment')").first().click();
    await page.waitForSelector(`text=Comments can have up to ${LINK_LIMIT} links`);
    check(true, "automod: a comment with 6 links is refused");

    await go(page, `/@${OWNER.handle}`);
    await page.locator('[data-report-open="channel"]').click();
    await fillReport(page, "harassment", "Mean replies everywhere");
    await page.locator("[data-report-send]").click();
    await until(() => openReports("channel", OWNER.channel).length === 1);
    check(openReports("channel", OWNER.channel).length === 1, "report: the channel report is stored");

    const res = await go(page, "/admin");
    check(res?.status() === 404, `viewer: /admin is a 404 (${res?.status()})`);
    const api = await page.evaluate(async () => (await fetch("/api/admin/action", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "dismiss", targetKind: "video", targetId: "f0000000-0000-4000-8000-000000000001" }) })).status);
    check(api === 404, `viewer: POST /api/admin/action is a 404 (${api})`);
    await context.close();
  }

  // The admin's queue ------------------------------------------------------------------------------
  {
    seed();
    const { context, page } = await open(browser, "/admin", { user: ADMIN });
    await page.waitForSelector("[data-queue-group]", { timeout: 60000 });
    const keys = await page.$$eval("[data-queue-group]", (els) => els.map((e) => e.getAttribute("data-queue-group")));
    check(keys[0] === `report:video:${SPAM_VIDEO}` && keys.length === 2, `queue: grouped by target, the most reported first (${keys.join(", ")})`);
    const spam = group(page, `report:video:${SPAM_VIDEO}`);
    check((await spam.locator("[data-queue-count]").getAttribute("data-queue-count")) === "3", "queue: the spam video shows 3 reports");
    check((await spam.locator("[data-queue-latest-reason]").innerText()) === "Something else", "queue: the latest reason leads");
    check((await spam.locator("[data-queue-reasons]").innerText()).includes("Spam or misleading 2"), "queue: the reasons are counted");

    // Remove needs a reason.
    await spam.locator('[data-action="remove"]').click();
    await spam.locator("[data-queue-error]").waitFor();
    check(state.videos[1].removed_at === null, "queue: remove without a reason is not sent");
    await spam.locator("[data-queue-reason]").fill("Spam links in the title");
    await spam.locator('[data-action="remove"]').click();
    await spam.waitFor({ state: "detached" });
    check(state.videos[1].removed_at !== null && state.videos[1].visibility === "private", "queue: remove makes the video private and removed");
    check(openReports("video", SPAM_VIDEO).length === 0, "queue: remove closes the target's reports");

    // Strike the comment's author: the second strike of three. Then dismiss is left.
    const com = group(page, `report:comment:${cid(1)}`);
    await com.locator("[data-queue-reason]").fill("Spam in the comments");
    await com.locator('[data-action="strike"]').click();
    await com.waitFor({ state: "detached" });
    check(strikesOf(BANNED.channel) === 2 && !state.suspended.has(BANNED.channel), "queue: a strike counts, two of three do not suspend");
    check(state.log.some((l) => l.action === "strike"), "queue: the strike is in the mod log");
    await page.waitForSelector("[data-queue-empty]");
    check(true, "queue: empty once both groups are handled");

    // Find a channel and strike it to its third: suspended.
    await go(page, `/admin?channel=@${BANNED.handle}`);
    await page.waitForSelector(`[data-channel-found="${BANNED.handle}"]`);
    await page.locator('[data-channel-found] input[aria-label="Reason"]').fill("Third spam wave");
    await page.locator('[data-channel-found] [data-channel-action="strike"]').click();
    await until(() => state.suspended.has(BANNED.channel));
    check(state.suspended.has(BANNED.channel) && state.log.at(-1).reason === `${STRIKE_LIMIT} strikes in ${STRIKE_DAYS} days`, "strikes: the third strike in 90 days suspends the channel");
    await go(page, "/admin");
    await page.waitForSelector(`[data-suspended="${BANNED.handle}"]`);
    check(true, "channels: the suspended channel is listed");
    await page.locator(`[data-suspended="${BANNED.handle}"] [data-channel-action="unsuspend"]`).click();
    await until(() => !state.suspended.has(BANNED.channel));
    check(!state.suspended.has(BANNED.channel), "channels: unsuspend from the list");
    await context.close();
  }

  // The removed comment, the owner's notice and the appeal ----------------------------------------------
  {
    seed();
    modAction({ action: "remove", target_kind: "comment", target_id: cid(1), reason: "Spam" });
    modAction({ action: "remove", target_kind: "video", target_id: VIDEO_ID, reason: "Misleading thumbnail" });
    state.videos[0].visibility = "public";
    state.videos[0].removed_at = stamp(Date.now() - HOUR);
    const v = await open(browser, WATCH);
    await v.page.waitForSelector('[data-comment-deleted="removed"]', { timeout: 60000 });
    check((await v.page.locator('[data-comment-deleted="removed"]').innerText()).includes("removed by moderation"), "comments: a removed comment says removed by moderation");
    await v.context.close();
    state.videos[0].visibility = "private";

    const { context, page } = await open(browser, "/studio/content", { user: OWNER });
    await page.waitForSelector("[data-removed-notice]", { timeout: 60000 });
    const notice = await page.locator("[data-removed-notice]").innerText();
    check(notice.includes("Your video was removed") && notice.includes("Misleading thumbnail"), "studio: the row says the video was removed, with the reason");
    await page.locator("[data-appeal-open]").click();
    await page.locator("[data-appeal-details]").fill("It is the real thumbnail, from minute two.");
    await page.locator("[data-appeal-send]").click();
    await page.waitForSelector('[data-appeal-state="open"]');
    check(state.reports.some((r) => r.kind === "appeal" && r.target_id === VIDEO_ID && r.status === "open"), "studio: the appeal is a report of kind appeal");
    await go(page, "/studio/content");
    await page.waitForSelector('[data-appeal-state="open"]');
    check((await page.locator("[data-appeal-open]").count()) === 0, "studio: once sent, no second appeal button");
    await context.close();

    const a = await open(browser, "/admin", { user: ADMIN });
    await a.page.waitForSelector(`[data-queue-group="appeal:video:${VIDEO_ID}"]`, { timeout: 60000 });
    const keys = await a.page.$$eval("[data-queue-group]", (els) => els.map((e) => e.getAttribute("data-queue-group")));
    check(keys[0] === `appeal:video:${VIDEO_ID}`, "queue: the appeal comes first");
    await a.page.locator(`[data-queue-group="appeal:video:${VIDEO_ID}"] [data-action="restore"]`).click();
    await until(() => state.videos[0].removed_at === null);
    check(state.videos[0].removed_at === null && state.videos[0].visibility === "public", "queue: restore gives the video back with its visibility");
    await a.context.close();
  }

  // The log, the word list, a ban ---------------------------------------------------------------------
  {
    seed();
    modAction({ action: "remove", target_kind: "video", target_id: SPAM_VIDEO, reason: "Spam links" });
    modAction({ action: "strike", target_kind: "video", target_id: SPAM_VIDEO, reason: "Spam links" });
    const { context, page } = await open(browser, "/admin/log", { user: ADMIN });
    await page.waitForSelector("[data-log-action]", { timeout: 60000 });
    const actions = await page.$$eval("[data-log-action]", (els) => els.map((e) => e.getAttribute("data-log-action")));
    check(actions[0] === "strike" && actions.includes("remove_video"), `log: newest first (${actions.join(", ")})`);

    await go(page, "/admin/words");
    await page.waitForSelector("[data-word-input]");
    await page.locator("[data-word-input]").fill("Bad!");
    await page.locator("[data-word-add]").click();
    await page.waitForSelector("[data-word-error]");
    check(!state.words.some((w) => w.word === "bad!"), "words: an invalid word is refused in the page");
    await page.locator("[data-word-input]").fill("  Free   Followers ");
    await page.locator("[data-word-add]").click();
    await page.waitForSelector('[data-word="free followers"]');
    check(state.words.some((w) => w.word === "free followers"), "words: a phrase is added lowercase with single spaces");
    await page.locator('[data-word-remove="giftcard*"]').click();
    await page.locator('[data-word="giftcard*"]').waitFor({ state: "detached" });
    check(!state.words.some((w) => w.word === "giftcard*"), "words: a word is removed");
    check(state.log.filter((l) => l.action === "add_word" || l.action === "remove_word").length === 2, "words: both changes are in the mod log");
    await context.close();

    const b = await open(browser, "/", { user: BANNED });
    await b.page.waitForURL(/\/login\?banned=1/, { timeout: 30000 });
    check((await b.page.locator("text=banned").count()) > 0, "ban: a banned account is signed out on its next page and told why");
    const cookies = await b.context.cookies();
    check(!cookies.some((c) => c.name.startsWith("sb-") && c.value), "ban: the session cookie is gone");
    await b.context.close();
  }

  // Screenshots ----------------------------------------------------------------------------------------------
  for (const theme of ["light", "dark"]) {
    for (const width of [1280, 390]) {
      const size = { width, height: width === 390 ? 844 : 900, theme, scale: 2 };
      seed();
      // A few more reports so the queue has a little of everything.
      reportTarget(VIEWER, { target_kind: "channel", target_id: BANNED.channel, reason: "spam", details: "Every comment is a link" });
      state.reports.push({ id: rid(90), kind: "appeal", reporter: OWNER, target_kind: "video", target_id: VIDEO_ID, reason: "appeal", details: "It is a cooking video, the knife is for the onions.", status: "open", created_at: stamp(NOW - 0.5 * HOUR) });
      Object.assign(state.videos[0], { removed_at: stamp(NOW - 2 * HOUR), removed_reason: "Violent content", removed_visibility: "public", visibility: "private" });
      state.suspended.set("c0000000-0000-4000-8000-000000000009", stamp(NOW - 3 * DAY));
      USERS.push({ id: "a0000000-0000-4000-8000-000000000009", username: "oldspam", name: "Old Spam", handle: "oldspam", channel: "c0000000-0000-4000-8000-000000000009" });
      state.suspendReason = { "c0000000-0000-4000-8000-000000000009": "3 strikes in 90 days" };

      const a = await open(browser, "/admin", { ...size, user: ADMIN });
      await a.page.waitForSelector("[data-queue-group]", { timeout: 60000 });
      await a.page.mouse.move(width - 2, 2);
      await a.page.screenshot({ path: join(outDir, `admin-${width}-${theme}.png`), fullPage: true });
      // The report box on the watch page.
      await a.context.close();
      USERS.pop();

      modAction({ action: "remove", target_kind: "video", target_id: SPAM_VIDEO, reason: "Spam links" });
      modAction({ action: "strike", target_kind: "video", target_id: SPAM_VIDEO, reason: "Spam links" });
      modAction({ action: "remove", target_kind: "comment", target_id: cid(1), reason: "Spam" });
      const l = await open(browser, "/admin/log", { ...size, user: ADMIN });
      await l.page.waitForSelector("[data-log-action]", { timeout: 60000 });
      await l.page.screenshot({ path: join(outDir, `log-${width}-${theme}.png`) });
      await go(l.page, "/admin/words");
      state.words.push({ word: "free followers", created_at: stamp(NOW - DAY), added_by: ADMIN.id });
      await go(l.page, "/admin/words");
      await l.page.waitForSelector("[data-word]");
      await l.page.screenshot({ path: join(outDir, `words-${width}-${theme}.png`) });
      await l.context.close();

      const w = await open(browser, WATCH, { ...size, user: VIEWER });
      state.videos[0].visibility = "public";
      await go(w.page, WATCH);
      await w.page.waitForSelector("[data-comment-list] [data-comment]", { timeout: 60000 });
      await pause(w.page);
      await w.page.locator("button[aria-label='More actions'][aria-haspopup]").click();
      await w.page.locator('[data-report-open="video"]').click();
      await fillReport(w.page, "violent", "The knife part");
      await w.page.mouse.move(width - 2, 2);
      await w.page.screenshot({ path: join(outDir, `report-${width}-${theme}.png`) });
      await w.page.keyboard.press("Escape");
      await w.page.locator('[data-comment-deleted="removed"]').evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 160));
      await w.page.waitForTimeout(200);
      await w.page.screenshot({ path: join(outDir, `removed-comment-${width}-${theme}.png`) });
      await w.context.close();
      state.videos[0].visibility = "private";

      const s = await open(browser, "/studio/content", { ...size, user: OWNER });
      await s.page.waitForSelector("[data-removed-notice]", { timeout: 60000 });
      await s.page.screenshot({ path: join(outDir, `studio-removed-${width}-${theme}.png`) });
      await s.context.close();
    }
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
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log(`\nall checks passed; screenshots in ${outDir}`);
process.exit(0);
