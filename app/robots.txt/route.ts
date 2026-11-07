import { siteOrigin } from "@/lib/seo/origin";
import { maintenanceForAnon } from "@/lib/seo/server";
import { robotsTxt } from "@/lib/seo/sitemap";

// GET /robots.txt: public pages may be crawled, the studio, admin, settings
// and the API may not; the sitemap's address. Everything is off limits while
// the maintenance flag is on.
export async function GET() {
  const [origin, maintenance] = await Promise.all([siteOrigin(), maintenanceForAnon()]);
  return new Response(robotsTxt(origin, { maintenance }), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" },
  });
}
