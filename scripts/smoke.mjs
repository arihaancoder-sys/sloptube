#!/usr/bin/env node
// Smoke test for a running sloptube.
// It starts nothing itself. Point it at a server that is already up:
//   node scripts/smoke.mjs http://localhost:3123

const base = (process.argv[2] || process.env.BASE_URL || "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node scripts/smoke.mjs <base-url>");
  process.exit(2);
}

const checks = [
  {
    // The home feed. With the feed flag off (or no database) the placeholder
    // grid shows, inside data-feed-state="off" or "no-db". Never a crash.
    path: "/",
    test: (body) =>
      (body.includes("sloptube") && /data-feed-state="(off|no-db|not-set-up|empty|ready)"/.test(body)) ||
      "home page shows none of the feed states",
  },
  {
    path: "/trending",
    test: (body) =>
      /data-feed-state="(off|no-db|not-set-up|empty|ready)"/.test(body) || "trending page shows none of the feed states",
  },
  {
    // The next page route answers with JSON, never a crash: 503 without the
    // database, 403 with the feed flag off.
    path: "/api/feed?kind=newest",
    allowStatus: [403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.cards) || "neither cards nor an error code";
    },
  },
  {
    // Subscriptions: the flag off placeholder, the sign in state, or the feed.
    // /subscriptions redirects here. Never a crash.
    path: "/feed/subscriptions",
    test: (body) =>
      /data-subs-state="(off|no-db|signed-out|not-set-up|empty|ready)"/.test(body) ||
      "subscriptions page shows none of its states",
  },
  {
    path: "/subscriptions",
    test: (body) => /data-subs-state="/.test(body) || "/subscriptions does not land on the subscriptions page",
  },
  {
    // The subscription routes answer with JSON, never a crash: 503 without the
    // database, 403 with the flag off, 401 signed out.
    path: "/api/subscriptions",
    allowStatus: [401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/subscriptions",
    method: "POST",
    allowStatus: [400, 401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/subscriptions/feed?notify=1",
    allowStatus: [401, 403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.cards) || "neither cards nor an error code";
    },
  },
  {
    // Search results: the flag off placeholder (also without the database),
    // or one of the result states. Never a crash.
    path: "/results?search_query=test",
    test: (body) =>
      /data-search-state="(off|no-db|not-set-up|empty-query|rate-limited|failed|none|ready)"/.test(body) ||
      "results page shows none of its states",
  },
  {
    // Suggestions answer with JSON, never a crash: 503 without the database,
    // 403 with the search flag off.
    path: "/api/search/suggest?q=te",
    allowStatus: [403, 429, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.suggestions) || "neither suggestions nor an error code";
    },
  },
  {
    path: "/api/search?search_query=test&cursor=x",
    allowStatus: [403, 429, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.videos) || "neither videos nor an error code";
    },
  },
  {
    // Watch history: the flag off placeholder (also without the database),
    // the sign in state, or the list. /history redirects here. Never a crash.
    path: "/feed/history",
    test: (body) =>
      /data-history-state="(off|no-db|signed-out|not-set-up|ready)"/.test(body) || "history page shows none of its states",
  },
  {
    path: "/history",
    test: (body) => /data-history-state="/.test(body) || "/history does not land on the history page",
  },
  {
    // The player's view ping, with a real looking body so it gets past the
    // checks: 503 without the database, 403 with the engagement flag off.
    path: "/api/watch/ping",
    method: "POST",
    body: JSON.stringify({ videoId: "00000000-0000-4000-8000-000000000000", position: 12, played: 10 }),
    allowStatus: [403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/reactions",
    method: "POST",
    body: JSON.stringify({ videoId: "00000000-0000-4000-8000-000000000000", kind: "like" }),
    allowStatus: [401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/history",
    allowStatus: [401, 403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.cards) || "neither cards nor an error code";
    },
  },
  {
    path: "/api/history/progress",
    method: "POST",
    body: JSON.stringify({ ids: ["00000000-0000-4000-8000-000000000000"] }),
    allowStatus: [403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || typeof json.progress === "object" || "neither progress nor an error code";
    },
  },
  {
    // Comments: every route answers with JSON, never a crash: 503 without the
    // database, 403 with the comments flag off, 401 signed out for writes.
    path: "/api/comments?v=00000000-0000-4000-8000-000000000000&sort=top",
    allowStatus: [403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.comments) || "neither comments nor an error code";
    },
  },
  {
    path: "/api/comments?v=00000000-0000-4000-8000-000000000000&since=",
    allowStatus: [403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.comments) || "neither comments nor an error code";
    },
  },
  {
    path: "/api/comments/replies?parent=00000000-0000-4000-8000-000000000000",
    allowStatus: [403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || Array.isArray(JSON.parse(body).comments) || "no error code",
  },
  {
    path: "/api/comments",
    method: "POST",
    body: JSON.stringify({ videoId: "00000000-0000-4000-8000-000000000000", body: "hello" }),
    allowStatus: [401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/comments/like",
    method: "POST",
    body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000", on: true }),
    allowStatus: [401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/comments/moderate",
    method: "POST",
    body: JSON.stringify({ id: "00000000-0000-4000-8000-000000000000", action: "pin" }),
    allowStatus: [401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    // A request that is not right answers 400 before anything else.
    path: "/api/comments?v=not-a-video",
    allowStatus: [400],
    test: (body) => JSON.parse(body).error === "bad_request" || "not bad_request",
  },
  {
    // The studio page: the flag off page, the database notice, or the list
    // (signed out it sends people to sign in). Never a crash.
    path: "/studio/comments",
    test: (body) =>
      /data-studio-comments-state="(off|no-db|not-set-up|ready)"/.test(body) ||
      body.includes("Sign in") ||
      "studio comments page shows none of its states",
  },
  {
    // Snips: the placeholder with the flag off (also without the database),
    // or one of the feed states. Never a crash. A deep link the same.
    path: "/shorts",
    test: (body) =>
      /data-shorts-state="(off|no-db|not-set-up|missing|loading)"|data-shorts-feed="(empty|ready)"/.test(body) ||
      "shorts page shows none of its states",
  },
  {
    path: "/shorts/00000000-0000-4000-8000-000000000000",
    test: (body) =>
      /data-shorts-state="(off|no-db|not-set-up|missing|loading)"|data-shorts-feed="(empty|ready)"/.test(body) ||
      "shorts deep link shows none of the shorts states",
  },
  {
    // The shorts routes answer with JSON, never a crash: 503 without the
    // database, 403 with the shorts flag off, 400 for a bad body.
    path: "/api/shorts",
    allowStatus: [403, 503],
    test: (body) => {
      const json = JSON.parse(body);
      return typeof json.error === "string" || Array.isArray(json.shorts) || "neither shorts nor an error code";
    },
  },
  {
    path: "/api/shorts/comments?v=00000000-0000-4000-8000-000000000000",
    allowStatus: [403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "comments" in JSON.parse(body) || "no error code",
  },
  {
    path: "/api/shorts/choice",
    method: "POST",
    body: JSON.stringify({ videoId: "00000000-0000-4000-8000-000000000000", on: true }),
    allowStatus: [400, 401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/@someone/shorts",
    test: (body) => /data-channel-state="/.test(body) || "/@handle/shorts shows no channel state",
  },
  {
    // The creator studio (feature 12): the coming soon page with the flag off,
    // the database notice, or the studio itself (signed out it sends people
    // to sign in). Never a crash. The same for Content, the trash, the edit
    // page and the settings placeholder.
    path: "/studio",
    test: (body) =>
      /data-studio-state="(off|no-db|not-set-up|ready)"/.test(body) || body.includes("Sign in") || "studio shows none of its states",
  },
  ...["/studio/content", "/studio/content/trash", "/studio/video/00000000-0000-4000-8000-000000000000/edit", "/studio/settings"].map((path) => ({
    path,
    test: (body) =>
      /data-studio-state="(off|no-db|not-set-up|ready|missing|settings)"/.test(body) ||
      body.includes("Sign in") ||
      `${path} shows none of the studio states`,
  })),
  {
    // The studio routes answer with JSON, never a crash: 400 for a bad body,
    // 401 signed out, 403 with the flag off, 503 without the database.
    path: "/api/studio/bulk",
    method: "POST",
    body: JSON.stringify({ ids: ["00000000-0000-4000-8000-000000000000"], action: "trash" }),
    allowStatus: [400, 401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/studio/bulk",
    method: "POST",
    body: JSON.stringify({ ids: ["not-a-video"], action: "trash" }),
    allowStatus: [400],
    test: (body) => JSON.parse(body).error === "bad_request" || "not bad_request",
  },
  ...["/api/studio/video", "/api/studio/thumbnail", "/api/studio/thumbnail/sign"].map((path) => ({
    path,
    method: "POST",
    allowStatus: [400, 401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  })),
  // Analytics (feature 13): the studio or stats coming soon page, the
  // database notice, or the page (signed out it sends people to sign in).
  ...["/studio/analytics", "/studio/analytics?range=7d", "/studio/video/00000000-0000-4000-8000-000000000000/analytics"].map((path) => ({
    path,
    test: (body) =>
      /data-studio-state="(off|stats-off|no-db|not-set-up|ready|missing|error)"/.test(body) ||
      body.includes("Sign in") ||
      `${path} shows none of the analytics states`,
  })),
  {
    // The analytics routes answer with JSON, never a crash: 401 signed out,
    // 403 with a flag off, 503 without the database.
    path: "/api/studio/analytics",
    allowStatus: [401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  ...["/api/studio/analytics/video?id=00000000-0000-4000-8000-000000000000", "/api/studio/analytics/realtime"].map((path) => ({
    path,
    allowStatus: [401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  })),
  ...["/api/studio/analytics?range=3d", "/api/studio/analytics/video?id=nope", "/api/studio/analytics/realtime?video=nope"].map((path) => ({
    path,
    allowStatus: [400],
    test: (body) => JSON.parse(body).error === "bad_request" || "not bad_request",
  })),
  { path: "/login", test: (body) => body.includes("Sign in") || "login page does not contain \"Sign in\"" },
  {
    path: "/signup",
    test: (body) => body.includes("Create your account") || "signup page does not contain \"Create your account\"",
  },
  {
    // A channel that does not exist: the off page, the missing page or the
    // database notice, but never a crash. 404 is fine too.
    path: "/@someone",
    allow404: true,
    test: (body) =>
      /data-channel-state="(off|missing|no-db|not-set-up)"/.test(body) ||
      "channel page shows none of the off, missing or database notices",
  },
  {
    // Signed out, the upload page shows the flag off page (also when the
    // database is not connected), or sends people to sign in. Never a crash.
    path: "/upload",
    test: (body) =>
      /data-upload-state="off"/.test(body) ||
      /data-upload-state="(ready|preview)"/.test(body) ||
      "upload page shows neither the flag off page nor the uploader",
  },
  {
    path: "/studio/videos",
    test: (body) =>
      /data-upload-state="(off|no-db|not-set-up|ready|preview)"/.test(body) || "studio videos page shows none of its states",
  },
  {
    // The upload routes answer with JSON, never a crash: 501 without R2.
    path: "/api/upload/sign",
    method: "POST",
    allowStatus: [401, 403, 501, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    // The studio poll route answers with JSON, never a crash: 401 signed out,
    // 403 with the processing flag off, 503 without the database.
    path: "/api/videos/00000000-0000-0000-0000-000000000000/status",
    allowStatus: [401, 403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    // With the watch flag off (or no database) the feature 4 stub shows,
    // inside data-watch-state="off". Never a crash.
    path: "/watch?v=00000000-0000-0000-0000-000000000000",
    test: (body) =>
      /data-watch-state="(off|no-db|not-set-up|missing|processing|owner-processing|ready)"/.test(body) ||
      "watch page shows none of its states",
  },
  {
    // The media route answers with JSON, never a crash: 503 without the
    // database, 403 with the watch flag off, 404 for a video nobody may see.
    path: "/api/media/00000000-0000-0000-0000-000000000000/master.m3u8",
    allowStatus: [403, 404, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  // Moderation (feature 14). /admin is a real 404 for anyone but an admin
  // with the moderation flag on: signed out here, so always.
  ...["/admin", "/admin/log", "/admin/words", "/admin?channel=someone"].map((path) => ({
    path,
    expectStatus: 404,
    test: (body) => (body.includes("This page isn") && !body.includes("data-admin-page")) || "/admin shows something besides the 404 page",
  })),
  {
    // Reports answer with JSON, never a crash: 503 without the database, 403
    // with the flag off, 401 signed out, 400 for a bad report.
    path: "/api/moderation/report",
    method: "POST",
    body: JSON.stringify({ targetKind: "video", targetId: "00000000-0000-0000-0000-000000000000", reason: "spam", details: "" }),
    allowStatus: [400, 401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/moderation/report",
    method: "POST",
    body: JSON.stringify({ targetKind: "video", targetId: "00000000-0000-0000-0000-000000000000", reason: "other", details: "" }),
    expectStatus: 400,
    test: (body) => JSON.parse(body).error === "details_required" || "an empty 'other' report went through",
  },
  {
    path: "/api/moderation/appeal",
    method: "POST",
    body: JSON.stringify({ videoId: "00000000-0000-0000-0000-000000000000", details: "" }),
    allowStatus: [400, 401, 403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    // The admin routes are a 404 for anyone but an admin.
    path: "/api/admin/action",
    method: "POST",
    body: JSON.stringify({ action: "dismiss", targetKind: "video", targetId: "00000000-0000-0000-0000-000000000000" }),
    expectStatus: 404,
    test: (body) => JSON.parse(body).error === "not_admin" || "the admin action route did not answer not_admin",
  },
  {
    path: "/api/admin/words",
    method: "POST",
    body: JSON.stringify({ word: "spam", on: true }),
    expectStatus: 404,
    test: (body) => JSON.parse(body).error === "not_admin" || "the word list route did not answer not_admin",
  },
  { path: "/api/health", test: (body) => JSON.parse(body).ok === true || "ok is not true" },
  {
    path: "/api/version",
    test: (body) => {
      const json = JSON.parse(body);
      return ("sha" in json && "builtAt" in json) || "missing sha or builtAt";
    },
  },
  // Feature 15: the public pages (behind the launch flag; without a
  // database they say so), the contact route, sitemap.xml, robots.txt, the
  // 404 page with a real 404 and /admin/messages hidden.
  ...["/about", "/terms", "/privacy", "/guidelines", "/press", "/contact"].map((path) => ({
    path,
    test: (body) => /data-launch-state="(off|no-db|on)"/.test(body) || `${path} shows none of its states`,
  })),
  {
    path: "/api/contact",
    method: "POST",
    body: JSON.stringify({ name: "Smoke", email: "smoke@example.com", topic: "general", body: "A smoke test message." }),
    allowStatus: [403, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/contact",
    method: "POST",
    expectStatus: 400,
    test: (body) => JSON.parse(body).error === "bad_name" || "an empty message is not refused",
  },
  {
    path: "/sitemap.xml",
    test: (body) => (body.includes("<sitemapindex") && body.includes("/sitemaps/pages.xml")) || "no sitemap index",
  },
  {
    path: "/sitemaps/pages.xml",
    test: (body) => (body.includes("<urlset") && body.includes("/about</loc>")) || "no pages sitemap",
  },
  {
    path: "/robots.txt",
    test: (body) => (body.startsWith("User-agent: *") && /Sitemap: https?:\/\/\S+\/sitemap\.xml/.test(body)) || "robots.txt without the sitemap",
  },
  {
    path: "/this-page-does-not-exist",
    expectStatus: 404,
    test: (body) => body.includes('data-error-state="404"') || "not the styled 404 page",
  },
  {
    path: "/admin/messages",
    expectStatus: 404,
    test: () => true,
  },
  // Feature 16: Yapin'. Without the flag, or without YAPIN_CLIENT_ID,
  // YAPIN_CLIENT_SECRET and SUPABASE_SERVICE_ROLE_KEY, sign in answers 503
  // yapin_off and no button shows; the API answers JSON; /embed shows one of
  // its states and may only be framed by Yapin', yapper.website and this site.
  {
    path: "/auth/yapin/start",
    expectStatus: 503,
    test: (body) => JSON.parse(body).error === "yapin_off" || "sign in with Yapin' is not off",
  },
  {
    path: "/auth/yapin?code=x&state=y",
    expectStatus: 503,
    test: (body) => JSON.parse(body).error === "yapin_off" || "the Yapin' callback is not off",
  },
  {
    path: "/login",
    test: (body) => !body.includes("data-yapin-signin") || "Continue with Yapin' shows without the Yapin' settings",
  },
  {
    path: "/api/yapin/unlink",
    method: "POST",
    allowStatus: [401, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/yapin/webhook",
    allowStatus: [401, 503],
    test: (body) => typeof JSON.parse(body).error === "string" || "no error code",
  },
  {
    path: "/api/yapin/webhook",
    method: "POST",
    body: JSON.stringify({ url: "http://example.com/not-yapin" }),
    expectStatus: 400,
    test: (body) => JSON.parse(body).error === "bad_webhook" || "a webhook off yapin.gg is not refused",
  },
  {
    path: "/embed/00000000-0000-4000-8000-000000000004",
    test: (body, res) =>
      (/data-embed-state="(off|no-db|missing|ready)"/.test(body) &&
        /frame-ancestors 'self' https:\/\/yapin\.gg/.test(res.headers.get("content-security-policy") ?? "")) ||
      "/embed shows none of its states or lacks frame-ancestors",
  },
];

let failed = 0;
for (const { path, test, allow404, method = "GET", allowStatus = [], expectStatus, body: payload = "{}" } of checks) {
  const url = base + path;
  try {
    const res = await fetch(url, {
      method,
      signal: AbortSignal.timeout(15000),
      ...(method === "POST" ? { headers: { "content-type": "application/json" }, body: payload } : {}),
    });
    const body = await res.text();
    const allowed =
      expectStatus !== undefined
        ? res.status === expectStatus
        : res.status === 200 || (allow404 && res.status === 404) || allowStatus.includes(res.status);
    let problem = allowed ? null : `status ${res.status}`;
    if (!problem && (res.status === 200 || res.status === expectStatus || allowStatus.includes(res.status))) {
      const result = test(body, res);
      if (result !== true) problem = result;
    }
    if (problem) {
      failed++;
      console.log(`FAIL ${path}  ${problem}`);
    } else {
      const preview = path.startsWith("/api") ? `  ${res.status === 200 ? "" : res.status + " "}${body.trim()}` : "";
      console.log(`ok   ${path}${preview}`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL ${path}  ${err instanceof Error ? err.message : err}`);
  }
}

if (failed) {
  console.log(`\n${failed} check(s) failed against ${base}`);
  process.exit(1);
}
console.log(`\nall checks passed against ${base}`);
