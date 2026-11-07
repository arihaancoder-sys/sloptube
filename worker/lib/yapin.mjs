// Upload announcements in Yapin' (feature 16, 018_yapin.sql). When a video
// first becomes public and ready, the database queues a post in yapin_posts
// for channels with an incoming webhook. Between encodes this claims a few,
// posts the card to the webhook (3 retries with backoff) and reports back.
//
// Yapin' incoming webhooks: POST https://www.yapin.gg/api/webhooks/<id>/<token>
// (the same service also answers on yapper.website), JSON { content,
// username, avatar_url, embeds, allowed_mentions, components }, the Discord
// style shape. No bot token. The card is `content` with the watch link plus
// one embed (title, link, description, thumbnail, author). Yapin' only shows
// embed images from its own list of image hosts, so the thumbnail may not
// show for an arbitrary R2 host: the watch link in `content` is what always
// works (Yapin' unfurls it from the watch page's Open Graph tags).
// buildCard is the one place to change the card.
import { sleep } from "./loop.mjs";

/** Tries after the first one. Keep in step with the studio text ("tries"). */
export const RETRIES = 3;
/** Waits before each retry: 2 s, 4 s, 8 s. */
export const BACKOFF_MS = [2000, 4000, 8000];
/** The most a Retry-After from Yapin' may hold a retry back. */
export const RETRY_AFTER_MAX_MS = 30000;
export const POST_TIMEOUT_MS = 10000;
export const YAPIN_BATCH = 5;

/** The hosts that serve Yapin' incoming webhooks. Keep in step with lib/yapin/rules.ts and 019. */
export const YAPIN_WEBHOOK_HOSTS = ["yapin.gg", "www.yapin.gg", "yapper.website", "www.yapper.website"];
const WEBHOOK_PATH = /^\/api\/webhooks\/[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/;

/**
 * The same check as yapin_webhook_is_valid in 019: https on one of the hosts
 * (exactly, no other subdomains), the path /api/webhooks/<id>/<token>.
 */
export function isYapinWebhook(url, hosts = YAPIN_WEBHOOK_HOSTS) {
  if (typeof url !== "string" || url.length > 500 || /\s/.test(url)) return false;
  let u;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port || u.search || u.hash) return false;
  return hosts.includes(u.hostname) && WEBHOOK_PATH.test(u.pathname);
}

/** One line, at most `max` characters, cut at a word. */
export function clip(text, max) {
  const one = String(text ?? "").replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?]+$/, "")}…`;
}

/**
 * The thumbnail link: thumbnail_url when the encoder stored one (with
 * MEDIA_PUBLIC_URL), else the site's media route, which serves it for public videos.
 */
export function thumbnailFor(post, siteUrl) {
  if (typeof post.thumbnailUrl === "string" && post.thumbnailUrl.startsWith("https://")) return post.thumbnailUrl;
  return `${siteUrl}/api/media/${post.videoId}/thumb-1.webp`;
}

/**
 * The message for one upload: { content, embeds: [{ title, url, description,
 * image, author }] }. `siteUrl` is this sloptube's address without a
 * trailing slash.
 */
export function buildCard(post, siteUrl, siteName = "sloptube") {
  const watchUrl = `${siteUrl}/watch?v=${post.videoId}`;
  const channelUrl = `${siteUrl}/@${post.channelHandle}`;
  const title = clip(post.title, 256) || "New video";
  const channel = clip(post.channelName || post.channelHandle, 80);
  return {
    // The link always goes in content: the embed image may not be shown (see above).
    content: clip(`${channel} uploaded a new video: ${title}`, 1800) + `\n${watchUrl}`,
    username: siteName,
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title,
        url: watchUrl,
        ...(post.description?.trim() ? { description: clip(post.description, 300) } : {}),
        image: { url: thumbnailFor(post, siteUrl) },
        author: { name: channel, url: channelUrl },
        footer: { text: siteName },
      },
    ],
  };
}

/** Worth another try: no answer, a timeout, 429 or a 5xx. Anything else (a deleted webhook is 404) is final. */
export function shouldRetry(status) {
  return status === null || status === 429 || status >= 500;
}

/** Retry-After in ms (seconds or an HTTP date), capped, or null. */
export function retryAfterMs(value, now = Date.now()) {
  if (!value) return null;
  const s = Number(value);
  const ms = Number.isFinite(s) ? s * 1000 : Date.parse(value) - now;
  if (!Number.isFinite(ms) || ms < 0) return null;
  return Math.min(ms, RETRY_AFTER_MAX_MS);
}

/**
 * Posts the card, with RETRIES retries and BACKOFF_MS between them. Answers
 * { ok, tries, error }. `wait` and `fetchFn` are passed in for the tests.
 */
export async function postCard(url, card, { fetchFn = fetch, wait = sleep, signal } = {}) {
  let error = "not sent";
  let delay = null;
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (attempt > 0) {
      await wait(delay ?? BACKOFF_MS[attempt - 1], signal);
      if (signal?.aborted) return { ok: false, tries: attempt, error };
    }
    let status = null;
    delay = null;
    try {
      const res = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(card),
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
        redirect: "error",
      });
      status = res.status;
      if (res.ok) return { ok: true, tries: attempt + 1, error: null };
      error = `Yapin' answered ${res.status}`;
      if (status === 429) delay = retryAfterMs(res.headers?.get?.("retry-after"));
    } catch (err) {
      error = `could not reach Yapin': ${err?.message ?? err}`;
    }
    if (!shouldRetry(status) || attempt === RETRIES) return { ok: false, tries: attempt + 1, error };
  }
  return { ok: false, tries: RETRIES + 1, error };
}

/**
 * One round: claim a few posts, send them, report back. Answers { sent,
 * failed }, or null when the database could not be asked or SITE_URL is not
 * set (the card needs this site's address).
 */
export async function drainYapin({ db, log, config }, { signal, fetchFn, wait } = {}) {
  if (!config.siteUrl) return null;
  let posts;
  try {
    posts = await db.claimYapin(config.workerName, YAPIN_BATCH);
  } catch (err) {
    log("yapin", {}, `could not ask for announcements: ${err.message}`);
    return null;
  }
  let sent = 0;
  let failed = 0;
  for (const post of posts) {
    if (signal?.aborted) break;
    let result;
    if (!isYapinWebhook(post.url, config.yapinHosts)) {
      result = { ok: false, tries: 1, error: "not a Yapin' webhook URL" };
    } else {
      result = await postCard(post.url, buildCard(post, config.siteUrl), { fetchFn, wait, signal });
    }
    if (result.ok) sent++;
    else failed++;
    // Never log the webhook URL: it is the channel's secret.
    log("yapin", { video: post.videoId, tries: result.tries }, result.ok ? "posted" : `failed: ${result.error}`);
    await db.yapinResult(post.id, result).catch((err) => log("yapin", { video: post.videoId }, `could not report back: ${err.message}`));
  }
  return { sent, failed };
}
