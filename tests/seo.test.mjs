// Feature 15: share cards, canonical links, JSON-LD, sitemap.xml and robots.txt.
import assert from "node:assert/strict";
import { test } from "node:test";
import { absoluteUrl, channelMetadata, cleanOrigin, clip, isoDuration, jsonLdText, shortMetadata, videoJsonLd, watchMetadata } from "../lib/seo/meta.ts";
import { pagesFor, parseSitemapName, robotsTxt, sitemapIndexXml, urlsetXml } from "../lib/seo/sitemap.ts";

const ORIGIN = "https://tube.example.com";
const sample = {
  id: "f0000000-0000-4000-8000-000000000001",
  title: "Fluffy pancakes in ten minutes, no mixer needed",
  description: "A made up video. Flour, milk, eggs and a hot pan.\n\nThat's it.",
  thumbnail: "/api/media/f0000000-0000-4000-8000-000000000001/thumb-1.webp",
  durationS: 612,
  date: "2026-10-01T12:00:00.000Z",
  views: 1234,
  visibility: "public",
  width: 1920,
  height: 1080,
  channel: { handle: "samplekitchen", name: "Sample Kitchen" },
};

/** Renders Next's Metadata object the way the <head> gets it, as name or property and content pairs. */
function tags(meta) {
  const out = [["title", meta.title]];
  if (meta.description) out.push(["description", meta.description]);
  if (meta.alternates?.canonical) out.push(["canonical", String(meta.alternates.canonical)]);
  const og = meta.openGraph ?? {};
  for (const k of ["type", "url", "title", "description", "siteName"]) if (og[k]) out.push([`og:${k === "siteName" ? "site_name" : k}`, String(og[k])]);
  for (const img of og.images ?? []) out.push(["og:image", img.url], ["og:image:width", String(img.width)], ["og:image:height", String(img.height)]);
  const tw = meta.twitter ?? {};
  for (const k of ["card", "title", "description"]) if (tw[k]) out.push([`twitter:${k}`, tw[k]]);
  for (const img of tw.images ?? []) out.push(["twitter:image", String(img)]);
  for (const [k, v] of Object.entries(meta.other ?? {})) out.push([k, String(v)]);
  return Object.fromEntries(out);
}

test("watch page metadata for a sample video", () => {
  const t = tags(watchMetadata(sample, ORIGIN));
  assert.equal(t.title, "Fluffy pancakes in ten minutes, no mixer needed | sloptube");
  assert.equal(t.description, "A made up video. Flour, milk, eggs and a hot pan. That's it.");
  assert.equal(t.canonical, `${ORIGIN}/watch?v=${sample.id}`);
  assert.equal(t["og:type"], "video.other");
  assert.equal(t["og:url"], t.canonical);
  assert.equal(t["og:site_name"], "sloptube");
  assert.equal(t["og:image"], `${ORIGIN}/api/media/${sample.id}/thumb-1.webp`);
  assert.equal(t["og:image:width"], "1920");
  assert.equal(t["twitter:card"], "summary_large_image");
  assert.equal(t["twitter:image"], t["og:image"]);
  assert.equal(t["video:duration"], "612");
  assert.equal(watchMetadata(sample, ORIGIN).robots, undefined, "public videos may be indexed");
  assert.deepEqual(watchMetadata({ ...sample, visibility: "unlisted" }, ORIGIN).robots, { index: false, follow: false });
});

test("watch page metadata without a description or thumbnail", () => {
  const meta = watchMetadata({ ...sample, description: "", thumbnail: null, durationS: null }, ORIGIN, "mytube");
  const t = tags(meta);
  assert.equal(t.title, `${sample.title} | mytube`);
  assert.equal(t.description, `${sample.title} by Sample Kitchen`);
  assert.equal(t["twitter:card"], "summary");
  assert.equal(t["og:image"], undefined);
  assert.equal(t["video:duration"], undefined);
});

test("an absolute thumbnail (MEDIA_PUBLIC_URL) stays as it is", () => {
  const t = tags(watchMetadata({ ...sample, thumbnail: "https://media.example.com/hls/x/thumb-1.webp" }, ORIGIN));
  assert.equal(t["og:image"], "https://media.example.com/hls/x/thumb-1.webp");
});

test("shorts and channels", () => {
  const s = tags(shortMetadata({ ...sample, width: 1080, height: 1920 }, ORIGIN));
  assert.equal(s.canonical, `${ORIGIN}/shorts/${sample.id}`);
  assert.equal(s["og:url"], s.canonical);
  assert.equal(s["og:image:height"], "1920");
  assert.match(s.title, /\| sloptube Snips$/);

  const channel = { handle: "samplekitchen", name: "Sample Kitchen", description: "", avatarUrl: "https://cdn.example.com/a.webp", bannerUrl: null, videoCount: 1, subscriberCount: 3 };
  const c = tags(channelMetadata(channel, ORIGIN));
  assert.equal(c.title, "Sample Kitchen | sloptube");
  assert.equal(c.description, "Sample Kitchen on sloptube. 1 video.");
  assert.equal(c.canonical, `${ORIGIN}/@samplekitchen`);
  assert.equal(c["og:type"], "profile");
  assert.equal(c["og:image"], channel.avatarUrl);
  assert.equal(c["twitter:card"], "summary");
  assert.equal(tags(channelMetadata(channel, ORIGIN, "sloptube", "videos")).canonical, `${ORIGIN}/@samplekitchen/videos`);
});

test("JSON-LD VideoObject", () => {
  const ld = videoJsonLd(sample, ORIGIN);
  assert.equal(ld["@type"], "VideoObject");
  assert.equal(ld.name, sample.title);
  assert.equal(ld.description, sample.description);
  assert.deepEqual(ld.thumbnailUrl, [`${ORIGIN}/api/media/${sample.id}/thumb-1.webp`]);
  assert.equal(ld.uploadDate, sample.date);
  assert.equal(ld.duration, "PT10M12S");
  assert.equal(ld.interactionStatistic.userInteractionCount, 1234);
  assert.equal(ld.author.url, `${ORIGIN}/@samplekitchen`);
  const text = jsonLdText({ ...ld, name: "</script><b>&" });
  assert.ok(!text.includes("</script>") && !text.includes("<b>"), "nothing can close the script tag");
  assert.equal(JSON.parse(text).name, "</script><b>&");
});

test("durations, descriptions and URLs", () => {
  assert.equal(isoDuration(0), "PT0S");
  assert.equal(isoDuration(59.6), "PT1M");
  assert.equal(isoDuration(3725), "PT1H2M5S");
  assert.equal(isoDuration(3600), "PT1H");
  assert.equal(isoDuration(null), null);
  assert.equal(isoDuration(-1), null);
  const long = "word ".repeat(60);
  assert.ok(clip(long).length <= 160);
  assert.ok(clip(long).endsWith("word…"));
  assert.equal(cleanOrigin("https://tube.example.com/"), "https://tube.example.com");
  assert.equal(cleanOrigin("tube.example.com"), null);
  assert.equal(cleanOrigin("https://tube.example.com/path"), null);
  assert.equal(absoluteUrl(ORIGIN, "/x"), `${ORIGIN}/x`);
  assert.equal(absoluteUrl(ORIGIN, "https://a.example/x"), "https://a.example/x");
});

test("sitemap index, pages and robots.txt", () => {
  assert.deepEqual(parseSitemapName("videos-2.xml"), { kind: "videos", page: 2 });
  assert.deepEqual(parseSitemapName("channels-1.xml"), { kind: "channels", page: 1 });
  assert.equal(parseSitemapName("videos-0.xml"), null);
  assert.equal(parseSitemapName("../etc.xml"), null);
  assert.equal(pagesFor(0), 1);
  assert.equal(pagesFor(5000), 1);
  assert.equal(pagesFor(5001), 2);

  const index = sitemapIndexXml(ORIGIN, { videos: 12001, channels: 3 });
  assert.equal((index.match(/<sitemap>/g) ?? []).length, 1 + 3 + 1);
  assert.ok(index.includes(`<loc>${ORIGIN}/sitemaps/videos-3.xml</loc>`));
  assert.ok(index.includes(`<loc>${ORIGIN}/sitemaps/channels-1.xml</loc>`));
  assert.equal((sitemapIndexXml(ORIGIN, null).match(/<sitemap>/g) ?? []).length, 1, "only pages.xml without a database");

  const xml = urlsetXml([
    { loc: `${ORIGIN}/watch?v=1&x=<y>`, lastmod: "2026-10-01T12:00:00Z", video: { thumbnail: `${ORIGIN}/t.webp`, title: "A & B", description: "", durationS: 61.4 } },
    { loc: `${ORIGIN}/@samplekitchen`, lastmod: "not a date" },
  ]);
  assert.ok(xml.includes('xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"'));
  assert.ok(xml.includes("<loc>https://tube.example.com/watch?v=1&amp;x=&lt;y&gt;</loc>"));
  assert.ok(xml.includes("<lastmod>2026-10-01T12:00:00.000Z</lastmod>"));
  assert.ok(xml.includes("<video:title>A &amp; B</video:title>"));
  assert.ok(xml.includes("<video:description>A &amp; B</video:description>"), "an empty description uses the title");
  assert.ok(xml.includes("<video:duration>61</video:duration>"));
  assert.equal((xml.match(/<lastmod>/g) ?? []).length, 1, "a bad date is left out");

  const robots = robotsTxt(ORIGIN);
  assert.match(robots, /^User-agent: \*\nAllow: \//);
  assert.ok(robots.includes("Disallow: /studio"));
  assert.ok(robots.includes("Disallow: /api/"));
  assert.ok(robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`));
  assert.equal(robotsTxt(ORIGIN, { maintenance: true }), "User-agent: *\nDisallow: /\n");
});
