import { siteOrigin } from "@/lib/seo/origin";
import { sitemapPage } from "@/lib/seo/server";
import { parseSitemapName, urlsetXml, type SitemapUrl } from "@/lib/seo/sitemap";

const PAGES = ["/", "/trending", "/shorts", "/about", "/press", "/contact", "/terms", "/privacy", "/guidelines"];

// GET /sitemaps/pages.xml, /sitemaps/videos-<n>.xml, /sitemaps/channels-<n>.xml.
export async function GET(_request: Request, ctx: RouteContext<"/sitemaps/[name]">) {
  const { name } = await ctx.params;
  const origin = await siteOrigin();
  let urls: SitemapUrl[] | null;
  if (name === "pages.xml") {
    urls = PAGES.map((p) => ({ loc: `${origin}${p}` }));
  } else {
    const which = parseSitemapName(name);
    if (!which) return new Response("Not found\n", { status: 404, headers: { "content-type": "text/plain" } });
    urls = await sitemapPage(which.kind, which.page, origin);
    if (!urls) return new Response("The sitemap could not be read.\n", { status: 503, headers: { "content-type": "text/plain", "retry-after": "300" } });
  }
  return new Response(urlsetXml(urls), {
    headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
