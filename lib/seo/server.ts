import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { flagOn } from "@/lib/flags";
import { readSupabaseConfig } from "@/lib/supabase/env";
import { playbackUrls, readPublicBase } from "@/lib/watch/media";
import { absoluteUrl, channelPath, shortPath, watchPath } from "./meta";
import { SITEMAP_PER, type SitemapKind, type SitemapUrl } from "./sitemap";

/** The sitemap only lists what a signed out visitor can open. Flags are read for nobody. */
async function anonClient() {
  await connection();
  const config = readSupabaseConfig();
  if (!config) return null;
  return createSupabaseClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Is maintenance mode on for signed out visitors? robots.txt then asks crawlers to stay away. */
export async function maintenanceForAnon(): Promise<boolean> {
  await connection();
  if (!readSupabaseConfig()) return false;
  return flagOn("maintenance", null);
}

/** How many public videos and channels there are, or null without a database or before migration 017. */
export async function sitemapCounts(): Promise<{ videos: number; channels: number } | null> {
  const supabase = await anonClient();
  if (!supabase) return null;
  const [watchOn, channelsOn] = await Promise.all([flagOn("watch", null), flagOn("channels", null)]);
  const { data, error } = await supabase.rpc("sitemap_counts");
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) return null;
  return { videos: watchOn ? Number(row.videos) || 0 : 0, channels: channelsOn ? Number(row.channels) || 0 : 0 };
}

type VideoRow = {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  hls_key: string | null;
  duration_s: number | string | null;
  published_at: string | null;
  updated_at: string | null;
  is_short: boolean | null;
  channel_handle: string;
};

/** One sitemap file: public videos (shorts at /shorts/<id> with the shorts flag on) or channels. */
export async function sitemapPage(kind: SitemapKind, page: number, origin: string): Promise<SitemapUrl[] | null> {
  const supabase = await anonClient();
  if (!supabase) return null;
  if (kind === "channels") {
    if (!(await flagOn("channels", null))) return [];
    const { data, error } = await supabase.rpc("sitemap_channels", { page, per: SITEMAP_PER });
    if (error) return null;
    return ((data ?? []) as { handle: string; created_at: string }[]).map((c) => ({
      loc: absoluteUrl(origin, channelPath(c.handle)),
      lastmod: c.created_at,
    }));
  }
  const [watchOn, shortsOn] = await Promise.all([flagOn("watch", null), flagOn("shorts", null)]);
  if (!watchOn) return [];
  const { data, error } = await supabase.rpc("sitemap_videos", { page, per: SITEMAP_PER });
  if (error) return null;
  const base = readPublicBase(process.env.MEDIA_PUBLIC_URL);
  return ((data ?? []) as VideoRow[]).map((v) => {
    const thumb = v.thumbnail_url ?? (v.hls_key ? playbackUrls(v.id, v.hls_key, null, base).thumbnail("thumb-1.webp") : null);
    const duration = v.duration_s === null ? null : Number(v.duration_s);
    return {
      loc: absoluteUrl(origin, v.is_short && shortsOn ? shortPath(v.id) : watchPath(v.id)),
      lastmod: v.updated_at ?? v.published_at,
      video: thumb
        ? { thumbnail: absoluteUrl(origin, thumb), title: v.title, description: v.description ?? "", durationS: Number.isFinite(duration) ? duration : null }
        : null,
    };
  });
}
