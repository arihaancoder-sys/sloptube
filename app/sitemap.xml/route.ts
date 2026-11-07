import { siteOrigin } from "@/lib/seo/origin";
import { sitemapCounts } from "@/lib/seo/server";
import { sitemapIndexXml } from "@/lib/seo/sitemap";

// GET /sitemap.xml: the sitemap index. pages.xml, then videos-<n>.xml and
// channels-<n>.xml, 5,000 URLs each (sitemap_counts in 017_launch.sql).
export async function GET() {
  const [origin, counts] = await Promise.all([siteOrigin(), sitemapCounts()]);
  return new Response(sitemapIndexXml(origin, counts), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
