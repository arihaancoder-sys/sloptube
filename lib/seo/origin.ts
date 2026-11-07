import "server-only";
import { headers } from "next/headers";
import { cleanOrigin } from "./meta";

/**
 * This site's address for canonical links, share cards and the sitemap.
 * SITE_URL when it is set (read at request time, never frozen into the
 * build), else what the reverse proxy says the browser asked for.
 */
export async function siteOrigin(): Promise<string> {
  const fromEnv = cleanOrigin(process.env["SITE_URL"]);
  if (fromEnv) return fromEnv;
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000").split(",")[0].trim();
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")).split(",")[0].trim();
  return cleanOrigin(`${proto}://${host}`) ?? "http://localhost:3000";
}
