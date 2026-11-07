// sitemap.xml and robots.txt (feature 15). Pure, so the tests can read the
// output. No imports.

/** URLs per sitemap file. The protocol allows 50,000; smaller files are kinder to the database. */
export const SITEMAP_PER = 5000;

export type SitemapKind = "videos" | "channels";
export type SitemapUrl = {
  loc: string;
  lastmod?: string | null;
  video?: { thumbnail: string; title: string; description: string; durationS: number | null } | null;
};

/** "videos-2.xml" -> { kind: "videos", page: 2 }, anything else null. */
export function parseSitemapName(name: string): { kind: SitemapKind; page: number } | null {
  const m = /^(videos|channels)-([1-9][0-9]{0,4})\.xml$/.exec(name);
  return m ? { kind: m[1] as SitemapKind, page: Number(m[2]) } : null;
}

/** How many files a list of `count` URLs needs (at least one, so the index is never empty). */
export function pagesFor(count: number, per = SITEMAP_PER): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / per));
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function isoOrNull(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** The sitemap index: the home page list, then every videos and channels file. */
export function sitemapIndexXml(origin: string, counts: { videos: number; channels: number } | null): string {
  const files = ["pages.xml"];
  if (counts) {
    for (let p = 1; p <= pagesFor(counts.videos); p++) files.push(`videos-${p}.xml`);
    for (let p = 1; p <= pagesFor(counts.channels); p++) files.push(`channels-${p}.xml`);
  }
  const body = files.map((f) => `  <sitemap><loc>${xmlEscape(`${origin}/sitemaps/${f}`)}</loc></sitemap>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</sitemapindex>\n`;
}

/** One sitemap file. Video entries carry the video extension (title, thumbnail, duration). */
export function urlsetXml(urls: SitemapUrl[]): string {
  const hasVideo = urls.some((u) => u.video);
  const items = urls.map((u) => {
    const parts = [`    <loc>${xmlEscape(u.loc)}</loc>`];
    const lastmod = isoOrNull(u.lastmod);
    if (lastmod) parts.push(`    <lastmod>${lastmod}</lastmod>`);
    if (u.video) {
      const v = u.video;
      parts.push(
        "    <video:video>",
        `      <video:thumbnail_loc>${xmlEscape(v.thumbnail)}</video:thumbnail_loc>`,
        `      <video:title>${xmlEscape(v.title.slice(0, 100))}</video:title>`,
        `      <video:description>${xmlEscape((v.description.trim() || v.title).slice(0, 2048))}</video:description>`,
        ...(v.durationS !== null && v.durationS > 0 ? [`      <video:duration>${Math.max(1, Math.min(28800, Math.round(v.durationS)))}</video:duration>`] : []),
        "    </video:video>",
      );
    }
    return `  <url>\n${parts.join("\n")}\n  </url>`;
  });
  const ns = hasVideo ? ' xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"' : "";
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${ns}>\n${items.join("\n")}\n</urlset>\n`;
}

/**
 * robots.txt: everything public may be crawled; the studio, the admin pages,
 * settings, the API and the sign in pages may not. With maintenance on,
 * nothing may (so the maintenance page is not indexed).
 */
export function robotsTxt(origin: string, { maintenance = false }: { maintenance?: boolean } = {}): string {
  if (maintenance) return "User-agent: *\nDisallow: /\n";
  const disallow = ["/api/", "/studio", "/admin", "/settings", "/upload", "/login", "/signup", "/welcome", "/auth/", "/flags", "/feed/history", "/feed/subscriptions", "/results"];
  return ["User-agent: *", "Allow: /", ...disallow.map((d) => `Disallow: ${d}`), "", `Sitemap: ${origin}/sitemap.xml`, ""].join("\n");
}
