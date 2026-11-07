import "server-only";
import type { Metadata } from "next";
import { channelByHandle } from "@/lib/channels/server";
import { channelTitle } from "@/lib/channels/validation";
import type { Channel } from "@/lib/channels/types";
import { shortsState } from "@/lib/shorts/server";
import type { Short } from "@/lib/shorts/types";
import type { WatchVideo } from "@/lib/watch/types";
import { watchPageState } from "@/lib/watch/server";
import { flagOn } from "@/lib/flags";
import { siteConfig } from "@/site.config";
import { channelMetadata, shortMetadata, watchMetadata, type SeoChannel, type SeoVideo } from "./meta";
import { siteOrigin } from "./origin";

const hidden: Metadata["robots"] = { index: false, follow: false };

/**
 * og:video and twitter:player point at /embed/<id> when the yapin flag is on
 * for a signed out visitor (feature 16): link previews are fetched signed out,
 * and the embed page answers only then.
 */
const embedOn = () => flagOn("yapin", null);

export function seoVideo(v: WatchVideo): SeoVideo {
  const top = [...v.renditions].sort((a, b) => b.height - a.height)[0];
  return {
    id: v.id,
    title: v.title,
    description: v.description,
    thumbnail: v.thumbnail,
    durationS: v.durationS,
    date: v.date,
    views: v.views,
    visibility: v.visibility,
    width: top?.width || null,
    height: top?.height || null,
    channel: { handle: v.channel.handle, name: v.channel.name },
  };
}

export function seoShort(s: Short): SeoVideo {
  return {
    id: s.id,
    title: s.title,
    description: "",
    thumbnail: s.thumbnail,
    durationS: s.durationS,
    date: s.publishedAt,
    views: s.views,
    visibility: "public",
    width: s.width,
    height: s.height,
    channel: { handle: s.channel.handle, name: s.channel.name },
  };
}

export function seoChannel(c: Channel): SeoChannel {
  return {
    handle: c.handle,
    name: c.name,
    description: c.description,
    avatarUrl: c.avatarUrl,
    bannerUrl: c.bannerUrl,
    videoCount: c.videoCount,
    subscriberCount: c.subscriberCount,
  };
}

/** /watch?v=<id>. The page reads the same state (watchPageState is cached per request). */
export async function watchPageMetadata(v: string | null): Promise<Metadata> {
  const state = await watchPageState(v);
  const name = siteConfig.siteName;
  if (state.kind === "ready" && !state.preview) return watchMetadata(seoVideo(state.video), await siteOrigin(), name, { embed: await embedOn() });
  if (state.kind === "processing" || state.kind === "owner-processing") {
    return { title: `${state.kind === "processing" ? state.title : state.video.title} | ${name}`, robots: hidden };
  }
  return { title: state.kind === "missing" ? `Video unavailable | ${name}` : `Watch | ${name}`, robots: hidden };
}

/** /@handle and its tabs. */
export async function channelPageMetadata(segment: string, tab: "home" | "videos" | "shorts" | "about"): Promise<Metadata> {
  const state = await channelByHandle(segment);
  if (state.kind === "ready") return channelMetadata(seoChannel(state.channel), await siteOrigin(), siteConfig.siteName, tab);
  return { title: channelTitle(segment, tab === "home" ? undefined : tab[0].toUpperCase() + tab.slice(1)), robots: hidden };
}

/** /shorts/<id>. */
export async function shortPageMetadata(id: string): Promise<Metadata> {
  const state = await shortsState(id);
  if (state.kind === "ready" && state.start) return shortMetadata(seoShort(state.start), await siteOrigin(), siteConfig.siteName, { embed: await embedOn() });
  return { title: `Snips | ${siteConfig.siteName}`, robots: state.kind === "ready" ? undefined : hidden };
}
