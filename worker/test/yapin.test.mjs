// Yapin' announcements (feature 16): the card, the retries and the drain,
// with fetch and the database faked. Nothing here touches the network.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDb } from "../lib/db.mjs";
import { BACKOFF_MS, RETRIES, buildCard, drainYapin, isYapinWebhook, postCard, retryAfterMs, shouldRetry, thumbnailFor, YAPIN_WEBHOOK_HOSTS } from "../lib/yapin.mjs";

const SITE = "https://tube.example.com";
const VIDEO = "aaaaaaaa-bbbb-4ccc-8ddd-000000000001";
const HOOK = "https://www.yapin.gg/api/webhooks/123/made-up-secret";
const post = {
  id: "p1",
  url: HOOK,
  videoId: VIDEO,
  title: "Fluffy pancakes in ten minutes, no mixer needed",
  description: "A made up video. Flour, milk, eggs and a hot pan.",
  thumbnailUrl: null,
  channelName: "Sample Kitchen",
  channelHandle: "samplekitchen",
  attempts: 0,
};

/** A fetch that answers the given statuses in turn and records every call. */
function fakeFetch(statuses, headers = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === "throw") throw new Error("connect ECONNREFUSED");
    return { ok: s >= 200 && s < 300, status: s, headers: new Headers(headers) };
  };
  fn.calls = calls;
  return fn;
}

const waits = () => {
  const w = [];
  const fn = async (ms) => void w.push(ms);
  fn.list = w;
  return fn;
};

test("the card has the title, the watch link, the thumbnail and the channel", () => {
  const card = buildCard(post, SITE);
  // The watch link is in content too: Yapin' may not show the embed image from an arbitrary host.
  assert.equal(card.content, `Sample Kitchen uploaded a new video: ${post.title}\n${SITE}/watch?v=${VIDEO}`);
  assert.equal(card.username, "sloptube");
  assert.deepEqual(card.allowed_mentions, { parse: [] }, "a title never pings anyone");
  assert.equal(card.embeds.length, 1);
  const e = card.embeds[0];
  assert.equal(e.title, post.title);
  assert.equal(e.url, `${SITE}/watch?v=${VIDEO}`);
  assert.equal(e.description, post.description);
  assert.deepEqual(e.image, { url: `${SITE}/api/media/${VIDEO}/thumb-1.webp` });
  assert.deepEqual(e.author, { name: "Sample Kitchen", url: `${SITE}/@samplekitchen` });
  assert.deepEqual(e.footer, { text: "sloptube" });
});

test("the card uses thumbnail_url when the encoder stored one, and clips long text", () => {
  assert.equal(thumbnailFor({ ...post, thumbnailUrl: "https://media.example.com/hls/x/thumb-1.webp" }, SITE), "https://media.example.com/hls/x/thumb-1.webp");
  assert.equal(thumbnailFor({ ...post, thumbnailUrl: "http://plain.example.com/t.webp" }, SITE), `${SITE}/api/media/${VIDEO}/thumb-1.webp`);
  const card = buildCard({ ...post, description: "word ".repeat(200), title: "" }, SITE);
  assert.ok(card.embeds[0].description.length <= 300);
  assert.ok(card.embeds[0].description.endsWith("…"));
  assert.equal(card.embeds[0].title, "New video");
  assert.equal("description" in buildCard({ ...post, description: "  " }, SITE).embeds[0], false);
});

test("only https://<yapin.gg or yapper.website>/api/webhooks/<id>/<token> is posted to", () => {
  assert.equal(isYapinWebhook(HOOK), true);
  assert.equal(isYapinWebhook("https://yapin.gg/api/webhooks/1/x"), true);
  assert.equal(isYapinWebhook("https://yapper.website/api/webhooks/1/x"), true);
  assert.equal(isYapinWebhook("https://www.yapper.website/api/webhooks/1/x"), true);
  assert.equal(isYapinWebhook("https://cdn.yapin.gg/api/webhooks/1/x"), false, "no other subdomains");
  assert.equal(isYapinWebhook("https://www.yapin.gg/api/oauth/token"), false, "only the webhook path");
  assert.equal(isYapinWebhook("https://www.yapin.gg/api/webhooks/1/x/extra"), false);
  assert.equal(isYapinWebhook("https://www.yapin.gg/api/webhooks/1/x?wait=true"), false);
  assert.equal(isYapinWebhook("https://yapper.website.evil.example/api/webhooks/1/x"), false);
  assert.equal(isYapinWebhook("http://www.yapin.gg/api/webhooks/1/x"), false);
  assert.equal(isYapinWebhook("https://yapin.gg.evil.example/api/webhooks/1/x"), false);
  assert.equal(isYapinWebhook("https://evilyapin.gg/x"), false);
  assert.equal(isYapinWebhook("https://user:pw@yapin.gg/x"), false);
  assert.equal(isYapinWebhook("https://yapin.gg:8443/x"), false);
  assert.equal(isYapinWebhook("https://169.254.169.254/latest"), false);
  assert.equal(isYapinWebhook(null), false);
});

test("which answers are retried", () => {
  assert.equal(shouldRetry(null), true);
  assert.equal(shouldRetry(429), true);
  assert.equal(shouldRetry(500), true);
  assert.equal(shouldRetry(503), true);
  assert.equal(shouldRetry(400), false);
  assert.equal(shouldRetry(404), false);
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs("120"), 30000);
  assert.equal(retryAfterMs("soon"), null);
  assert.equal(retryAfterMs(null), null);
});

test("a card that goes through the first time is posted once, as JSON", async () => {
  const fetchFn = fakeFetch([204]);
  const wait = waits();
  const result = await postCard(HOOK, buildCard(post, SITE), { fetchFn, wait });
  assert.deepEqual(result, { ok: true, tries: 1, error: null });
  assert.equal(fetchFn.calls.length, 1);
  assert.equal(fetchFn.calls[0].init.method, "POST");
  assert.equal(fetchFn.calls[0].init.headers["content-type"], "application/json");
  assert.equal(fetchFn.calls[0].init.redirect, "error");
  assert.deepEqual(wait.list, []);
});

test("errors are retried 3 times with backoff, then given up", async () => {
  const fetchFn = fakeFetch([500, "throw", 502, 503]);
  const wait = waits();
  const result = await postCard(HOOK, buildCard(post, SITE), { fetchFn, wait });
  assert.equal(result.ok, false);
  assert.equal(result.tries, RETRIES + 1);
  assert.equal(result.error, "Yapin' answered 503");
  assert.equal(fetchFn.calls.length, 4);
  assert.deepEqual(wait.list, BACKOFF_MS);
});

test("a retry that works stops there", async () => {
  const fetchFn = fakeFetch(["throw", 200]);
  const wait = waits();
  assert.deepEqual(await postCard(HOOK, {}, { fetchFn, wait }), { ok: true, tries: 2, error: null });
  assert.deepEqual(wait.list, [BACKOFF_MS[0]]);
});

test("429 waits as long as Retry-After says, a 404 is final", async () => {
  const slow = fakeFetch([429, 200], { "retry-after": "5" });
  const wait = waits();
  assert.equal((await postCard(HOOK, {}, { fetchFn: slow, wait })).tries, 2);
  assert.deepEqual(wait.list, [5000]);

  const gone = fakeFetch([404]);
  const wait2 = waits();
  assert.deepEqual(await postCard(HOOK, {}, { fetchFn: gone, wait: wait2 }), { ok: false, tries: 1, error: "Yapin' answered 404" });
  assert.deepEqual(wait2.list, []);
});

/** claim_yapin_posts and yapin_post_result like the SQL. */
function fakeSupabase(rows) {
  const results = [];
  return {
    results,
    async rpc(name, args) {
      if (name === "claim_yapin_posts") {
        const out = rows.filter((r) => r.status === "queued").slice(0, args.lim);
        for (const r of out) r.status = "sending";
        return { data: out.map((r) => ({ id: r.id, url: r.url, video_id: r.video_id, title: r.title, description: "", thumbnail_url: null, hls_key: null, channel_name: "Sample Kitchen", channel_handle: "samplekitchen", attempts: 0 })), error: null };
      }
      if (name === "yapin_post_result") {
        results.push(args);
        return { data: null, error: null };
      }
      return { data: null, error: { message: `unexpected ${name}` } };
    },
  };
}

test("the drain posts what was queued, reports each result and never logs the URL", async () => {
  const supabase = fakeSupabase([
    { id: "p1", url: HOOK, video_id: VIDEO, title: "One", status: "queued" },
    { id: "p2", url: "https://example.com/not-yapin", video_id: VIDEO, title: "Two", status: "queued" },
  ]);
  const lines = [];
  const log = (...a) => lines.push(JSON.stringify(a));
  const fetchFn = fakeFetch([200]);
  const out = await drainYapin({ db: createDb(supabase), log, config: { workerName: "box", siteUrl: SITE, yapinHosts: YAPIN_WEBHOOK_HOSTS } }, { fetchFn, wait: waits() });
  assert.deepEqual(out, { sent: 1, failed: 1 });
  assert.equal(fetchFn.calls.length, 1);
  assert.deepEqual(supabase.results, [
    { post_id: "p1", ok: true, tries: 1, error: null },
    { post_id: "p2", ok: false, tries: 1, error: "not a Yapin' webhook URL" },
  ]);
  assert.ok(lines.every((l) => !l.includes("made-up-secret")));
});

test("without SITE_URL nothing is claimed", async () => {
  const supabase = fakeSupabase([{ id: "p1", url: HOOK, video_id: VIDEO, title: "One", status: "queued" }]);
  assert.equal(await drainYapin({ db: createDb(supabase), log: () => {}, config: { workerName: "box", siteUrl: null } }), null);
  assert.equal(supabase.results.length, 0);
});
