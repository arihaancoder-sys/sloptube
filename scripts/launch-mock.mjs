// The made up site behind scripts/lighthouse.mjs, scripts/a11y-check.mjs and
// scripts/launch-shots.mjs (feature 15). Not run on its own.
//
// startSite() does three things:
// 1. Makes a 6 second test clip as HLS and a WebP thumbnail for every video
//    with ffmpeg, in a temp folder.
// 2. Starts a tiny local server that stands in for Supabase's REST and auth
//    APIs (flags, the feed, the watch page, channels, Snips, the contact
//    form, the sitemap, is_admin) and for the public bucket domain
//    (MEDIA_PUBLIC_URL).
// 3. Starts the production build (`next start`, so run `npm run build`
//    first) pointed at it.
//
// Made up titles and channels, no real data. Nothing here touches the network.
// scripts/yapin-shots.mjs (feature 16) passes extra settings in `env` and
// answers more of the stand in's routes with `handle`.

import { spawn, spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve } from "node:path";
import { buildEncodeArgs } from "../worker/lib/ffmpeg.mjs";
import { pickRenditions } from "../worker/lib/ladder.mjs";

export const root = resolve(new URL("..", import.meta.url).pathname);
const NOW = Date.now();
const HOUR = 3_600_000;
const CLIP_S = 6;

export const CHANNELS = [
  { id: "c1500000-0000-4000-8000-000000000001", owner: "a1500000-0000-4000-8000-000000000001", handle: "samplekitchen", name: "Sample Kitchen", subs: 12400 },
  { id: "c1500000-0000-4000-8000-000000000002", owner: "a1500000-0000-4000-8000-000000000002", handle: "desklab", name: "Desk Setup Lab", subs: 830 },
  { id: "c1500000-0000-4000-8000-000000000003", owner: "a1500000-0000-4000-8000-000000000003", handle: "trailnotes", name: "Trail Notes", subs: 45100 },
];
const TITLES = [
  "Fluffy pancakes in ten minutes, no mixer needed",
  "My desk setup tour",
  "Sunrise hike to the old fire lookout",
  "Why every cast iron pan needs this one step",
  "Cable management that actually lasts",
  "Packing light: three days with one small bag",
  "Bread with four ingredients",
  "Keyboard sound test: six switches side by side",
  "Night sky timelapse from the ridge",
  "Soup for a cold evening",
  "Standing desk, one year later",
  "Map and compass basics",
];
const vid = (n) => `f1500000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const VIDEOS = TITLES.map((title, i) => ({
  id: vid(i + 1),
  title,
  description: `A made up video for the launch checks. ${title}.`,
  channel: CHANNELS[i % 3],
  published: NOW - (i * 7 + 2) * HOUR,
  views: [128000, 5400, 980, 31000, 2200, 640, 15000, 87, 4300, 120, 9900, 760][i],
  duration: [612, 2710, 1844, 903, 415, 2400, 1290, 333, 128, 700, 1500, 980][i],
  short: false,
}));
export const SHORTS = ["Flipping a pancake in slow motion", "One cable trick", "Fog rolling over the ridge"].map((title, i) => ({
  id: vid(i + 101),
  title,
  description: "",
  channel: CHANNELS[i % 3],
  published: NOW - (i * 5 + 1) * HOUR,
  views: [12400, 830, 45100][i],
  duration: CLIP_S,
  short: true,
}));
const ALL = [...VIDEOS, ...SHORTS];
const byId = new Map(ALL.map((v) => [v.id, v]));
const stamp = (ms) => new Date(ms).toISOString().replace("Z", "123+00:00");

/** The admin, for the maintenance and /admin/messages checks. */
export const ADMIN = { id: "a1500000-0000-4000-8000-0000000000ad", email: "admin@example.com", username: "siteadmin", name: "Site Admin" };

const b64url = (s) => Buffer.from(s).toString("base64url");
export function sessionFor(user) {
  const exp = Math.floor(NOW / 1000) + 24 * 3600;
  const token = [
    b64url(JSON.stringify({ alg: "HS256", typ: "JWT" })),
    b64url(JSON.stringify({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", exp, iat: exp - 86400 })),
    b64url("not-a-real-signature"),
  ].join(".");
  const authUser = { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: {}, user_metadata: {}, created_at: new Date(NOW).toISOString() };
  return { token, authUser, session: { access_token: token, refresh_token: "mock-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user: authUser } };
}
const SESSION = sessionFor(ADMIN);
/** The @supabase/ssr cookie for the admin (the mock's project ref is "127"). */
export const adminCookie = (domain = "localhost") => ({ name: "sb-127-auth-token", value: "base64-" + b64url(JSON.stringify(SESSION.session)), domain, path: "/" });

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: ["ignore", "ignore", "pipe"], ...opts });
  if (r.status !== 0) throw new Error(`${cmd} failed: ${r.stderr}`);
}

function fixtures() {
  const work = mkdtempSync(join(tmpdir(), "sloptube-launch-"));
  const hlsDir = join(work, "clip");
  mkdirSync(hlsDir, { recursive: true });
  const source = join(work, "source.mp4");
  run("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `testsrc2=size=640x360:rate=30:duration=${CLIP_S}`,
    "-f", "lavfi", "-i", `sine=frequency=330:sample_rate=48000:duration=${CLIP_S}`,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", source,
  ]);
  run("ffmpeg", buildEncodeArgs({ input: source, renditions: pickRenditions({ width: 640, height: 360, fps: 30 }), hasAudio: true, segmentSeconds: 2 }), { cwd: hlsDir });
  ALL.forEach((v, i) => {
    const dir = join(work, "thumbs", v.id);
    mkdirSync(dir, { recursive: true });
    run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", `testsrc2=size=${v.short ? "360x640" : "640x360"}:rate=1:duration=1`,
      "-vf", `hue=h=${(i * 47) % 360}:s=0.8`, "-frames:v", "1", "-c:v", "libwebp", "-quality", "70", join(dir, "thumb-1.webp"),
    ]);
  });
  return { work, hlsDir };
}

const TYPES = { ".m3u8": "application/vnd.apple.mpegurl", ".m4s": "video/iso.segment", ".mp4": "video/mp4", ".webp": "image/webp" };

const channelRow = (c) => ({
  id: c.id, owner_id: c.owner, handle: c.handle, name: c.name, description: `A made up channel for the launch checks: ${c.name}.`,
  links: [], avatar_url: null, banner_url: null, handle_changed_at: null, subscriber_count: c.subs,
  video_count: ALL.filter((v) => v.channel === c).length, created_at: new Date(NOW - 400 * 24 * HOUR).toISOString(), comments_default: "on",
});
const feedRow = (v) => ({
  id: v.id, title: v.title, duration_s: v.duration, thumbnail_url: null, hls_key: `hls/${v.id}/master.m3u8`, preview_sprite_key: null,
  published_at: stamp(v.published), views: v.views, score: 0, channel_id: v.channel.id, channel_handle: v.channel.handle,
  channel_name: v.channel.name, channel_avatar_url: null, is_short: v.short,
});
const shortRow = (v) => ({
  id: v.id, title: v.title, duration_s: v.duration, width: 360, height: 640, thumbnail_url: null, hls_key: `hls/${v.id}/master.m3u8`,
  published_at: stamp(v.published), views: v.views, like_count: 0, comment_count: 0, comments_mode: "on", my_reaction: null,
  channel_id: v.channel.id, channel_handle: v.channel.handle, channel_name: v.channel.name, channel_avatar_url: null,
  tier: 0, score: v.views, as_of: stamp(NOW), is_short: true,
});

function feedVideos({ kind, cursor, cursor_id, lim, for_channel, exclude_shorts }) {
  return ALL.filter((v) => (kind === "channel" ? v.channel.id === for_channel : kind === "channel_shorts" ? v.channel.id === for_channel && v.short : true))
    .filter((v) => !(exclude_shorts && kind !== "channel_shorts" && v.short))
    .sort((a, b) => b.published - a.published || (a.id < b.id ? 1 : -1))
    .filter((v) => !cursor || stamp(v.published) < cursor || (stamp(v.published) === cursor && v.id < cursor_id))
    .slice(0, lim ?? 24)
    .map(feedRow);
}

/**
 * Starts the fixtures, the stand in and `next start`. Answers the app's
 * address, the state the checks can change (flags, messages) and stop().
 */
export async function startSite({ port = 3470, flags: extraFlags = {}, env: extraEnv = {}, handle = null } = {}) {
  if (!existsSync(join(root, ".next", "BUILD_ID"))) throw new Error("No production build: run `npm run build` first.");
  const { work, hlsDir } = fixtures();

  const state = {
    flags: {
      accounts: "everyone", channels: "everyone", watch: "everyone", feed: "everyone", subscriptions: "everyone", search: "everyone",
      shorts: "everyone", moderation: "everyone", launch: "everyone", maintenance: "off", ...extraFlags,
    },
    messages: [],
    requests: [],
  };

  const mock = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (status, body, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "access-control-allow-origin": "*", "access-control-allow-headers": "*" });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const fail = (message) => send(400, { code: "P0001", message });
    if (req.method === "OPTIONS") return send(204, "", "text/plain");
    state.requests.push(url.pathname);

    const media = url.pathname.match(/^\/hls\/([0-9a-f-]{36})\/(.+)$/);
    if (media) {
      const name = normalize(decodeURIComponent(media[2])).replace(/^([/\\])+/, "");
      const file = name === "thumb-1.webp" ? join(work, "thumbs", media[1], name) : join(hlsDir, name);
      if (!file.startsWith(work) || !existsSync(file) || !statSync(file).isFile()) return send(404, { error: "not_found" });
      res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "access-control-allow-origin": "*", "cache-control": "public, max-age=31536000, immutable" });
      return createReadStream(file).pipe(res);
    }

    let raw = "";
    for await (const chunk of req) raw += chunk;
    const args = raw ? JSON.parse(raw) : {};
    const me = req.headers.authorization === `Bearer ${SESSION.token}` ? ADMIN : null;
    if (handle && (await handle({ req, url, args, send, fail, me, state }))) return;
    const one = (rows) => (String(req.headers.accept).includes("vnd.pgrst.object") ? (rows[0] ? send(200, rows[0]) : send(406, { code: "PGRST116" })) : send(200, rows));
    const eq = (name) => url.searchParams.get(name)?.replace(/^eq\./, "");
    const flagOn = (key) => state.flags[key] === "everyone";

    if (url.pathname === "/auth/v1/user") return me ? send(200, SESSION.authUser) : send(401, { msg: "no session" });
    if (url.pathname === "/auth/v1/logout") return send(204, "", "text/plain");
    if (url.pathname === "/rest/v1/feature_flags") {
      const rows = Object.entries(state.flags).map(([key, mode]) => ({ key, label: key, description: "", mode, users: [], updated_at: null }));
      const only = eq("key");
      return one(only ? rows.filter((r) => r.key === only) : rows);
    }
    if (url.pathname === "/rest/v1/profiles") {
      return one(eq("id") === ADMIN.id ? [{ id: ADMIN.id, username: ADMIN.username, display_name: ADMIN.name, avatar_url: null, bio: "", onboarded: true }] : []);
    }
    if (url.pathname === "/rest/v1/channels") {
      const c = CHANNELS.find((x) => x.handle === eq("handle") || x.owner === eq("owner_id") || x.id === eq("id"));
      return one(c ? [channelRow(c)] : []);
    }

    const rpc = url.pathname.replace("/rest/v1/rpc/", "");
    switch (rpc) {
      case "is_admin":
        return send(200, JSON.stringify(me !== null));
      case "feed_videos":
        return send(200, feedVideos(args));
      case "related_videos":
        return send(200, VIDEOS.filter((v) => v.id !== args.video_id).slice(0, args.lim ?? 12).map(feedRow));
      case "watch_video": {
        const v = byId.get(args.video_id);
        if (!v) return send(200, []);
        return send(200, [{
          ...feedRow(v), description: v.description, visibility: "public", status: "ready", is_owner: false, created_at: stamp(v.published),
          width: v.short ? 360 : 640, height: v.short ? 640 : 360, renditions: [{ name: "360p", width: 640, height: 360 }], channel_subscriber_count: v.channel.subs,
        }]);
      }
      case "list_shorts":
        return flagOn("shorts") ? send(200, args.cursor ? [] : SHORTS.map(shortRow)) : fail("shorts_off");
      case "get_short": {
        const v = byId.get(args.video_id);
        return send(200, v ? [{ ...shortRow(v), is_short: v.short }] : []);
      }
      case "my_subscriptions":
      case "subscriptions_feed":
        return send(200, []);
      case "contact_send": {
        if (!flagOn("launch")) return fail("launch_off");
        const email = String(args.email ?? "").toLowerCase();
        if (state.messages.filter((m) => m.email === email).length >= 5) return fail("rate_limited");
        const id = `e1500000-0000-4000-8000-${String(state.messages.length + 1).padStart(12, "0")}`;
        state.messages.unshift({ id, ...args, email, created_at: new Date().toISOString(), handled_at: null, sender_handle: null });
        return send(200, JSON.stringify(id));
      }
      case "admin_contact_messages":
        if (!me) return fail("not_admin");
        return send(200, state.messages.filter((m) => args.include_handled || !m.handled_at));
      case "admin_contact_mark": {
        if (!me) return fail("not_admin");
        const m = state.messages.find((x) => x.id === args.id);
        if (!m) return fail("not_found");
        m.handled_at = args.handled ? new Date().toISOString() : null;
        return send(200, "null");
      }
      case "sitemap_counts":
        return send(200, [{ videos: ALL.length, channels: CHANNELS.length }]);
      case "sitemap_videos":
        return send(200, ALL.map((v) => ({ id: v.id, title: v.title, description: v.description, thumbnail_url: null, hls_key: `hls/${v.id}/master.m3u8`, duration_s: v.duration, published_at: stamp(v.published), updated_at: stamp(v.published), is_short: v.short, channel_handle: v.channel.handle })));
      case "sitemap_channels":
        return send(200, CHANNELS.map((c) => ({ handle: c.handle, name: c.name, created_at: new Date(NOW - 400 * 24 * HOUR).toISOString() })));
      case "admin_reports":
      case "admin_suspended":
        return send(200, []);
    }
    if (url.pathname.startsWith("/rest/v1/")) return send(200, []);
    send(404, { error: "not_found" });
  });
  await new Promise((r) => mock.listen(0, "127.0.0.1", r));
  const mockUrl = `http://127.0.0.1:${mock.address().port}`;

  const env = {
    ...process.env,
    NEXT_PUBLIC_SUPABASE_URL: mockUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "placeholder-for-the-mock",
    MEDIA_PUBLIC_URL: mockUrl,
    NO_PROXY: "127.0.0.1,localhost",
    no_proxy: "127.0.0.1,localhost",
    PORT: String(port),
    ...extraEnv,
  };
  const app = spawn("npx", ["next", "start", "-p", String(port)], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  let log = "";
  app.stdout.on("data", (d) => (log += d));
  app.stderr.on("data", (d) => (log += d));
  const base = `http://localhost:${port}`;

  const stop = () => {
    try {
      process.kill(-app.pid, "SIGTERM");
    } catch {
      app.kill("SIGTERM");
    }
    mock.closeAllConnections();
    mock.close();
    rmSync(work, { recursive: true, force: true });
  };

  for (let i = 0; ; i++) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    if (i > 60) {
      stop();
      throw new Error("next start did not come up:\n" + log.slice(-2000));
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  // Warm every page once so the first measured load is not the first render.
  for (const p of ["/", `/watch?v=${VIDEOS[0].id}`, `/@${CHANNELS[0].handle}`]) await fetch(base + p).then((r) => r.text());

  return { base, mockUrl, state, stop, log: () => log, watchPath: `/watch?v=${VIDEOS[0].id}`, channelPath: `/@${CHANNELS[0].handle}`, shortPath: `/shorts/${SHORTS[0].id}` };
}
