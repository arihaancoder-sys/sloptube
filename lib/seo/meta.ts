// Share cards, canonical links and structured data for watch pages, channel
// pages and Snips (feature 15). Pure functions from what the pages already
// read to Next's Metadata and to JSON-LD, so the tests can render them for a
// sample video. Only type imports, so Node loads it directly.
import type { Metadata } from "next";

export type SeoVideo = {
  id: string;
  title: string;
  description: string;
  /** Absolute, or a path on this site like /api/media/<id>/thumb-1.webp. */
  thumbnail: string | null;
  durationS: number | null;
  /** When it was published (or uploaded). */
  date: string;
  views: number;
  visibility: "public" | "unlisted" | "private";
  width?: number | null;
  height?: number | null;
  channel: { handle: string; name: string };
};

export type SeoChannel = {
  handle: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  videoCount: number;
  subscriberCount: number;
};

/** Search engines show about this much of a description. */
export const DESCRIPTION_MAX = 160;

/** The origin without a trailing slash, or null when it is not an http(s) URL. */
export function cleanOrigin(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^/\s]+$/i.test(v)) return null;
  return v;
}

/** A path on this site, or an absolute URL as it is. */
export function absoluteUrl(origin: string, pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${origin}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

/** One line, at most `max` characters, cut at a word with an ellipsis. */
export function clip(text: string, max = DESCRIPTION_MAX): string {
  const one = text.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s.,;:!?]+$/, "")}…`;
}

/** Seconds as an ISO 8601 duration, like PT1H2M5S, for schema.org. */
export function isoDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  return `PT${h ? `${h}H` : ""}${m ? `${m}M` : ""}${rest || (!h && !m) ? `${rest}S` : ""}`;
}

export const watchPath = (id: string) => `/watch?v=${id}`;
/** The player only page for link previews (feature 16). */
export const embedPath = (id: string) => `/embed/${id}`;
export const shortPath = (id: string) => `/shorts/${id}`;
export const channelPath = (handle: string) => `/@${handle}`;

function videoDescription(v: SeoVideo): string {
  return clip(v.description || `${v.title} by ${v.channel.name}`);
}

/** Unlisted and private videos stay out of search engines. */
function videoRobots(v: SeoVideo): Metadata["robots"] {
  return v.visibility === "public" ? undefined : { index: false, follow: false };
}

/** The player size in share cards: the video's own shape, 1280 wide at most. */
export function playerSize(v: Pick<SeoVideo, "width" | "height">): { width: number; height: number } {
  const w = v.width && v.width > 0 ? v.width : 1280;
  const h = v.height && v.height > 0 ? v.height : 720;
  if (w <= 1280) return { width: w, height: h };
  return { width: 1280, height: Math.round((h * 1280) / w) };
}

/**
 * The metadata of /watch?v=<id>: title, description, canonical link, Open
 * Graph and Twitter cards with the thumbnail and duration. With `embed` (the
 * yapin flag, feature 16) also og:video and a twitter:player card that point
 * at /embed/<id>, so chat apps can show a playable card.
 */
export function watchMetadata(v: SeoVideo, origin: string, siteName = "sloptube", opts: { embed?: boolean } = {}): Metadata {
  const url = absoluteUrl(origin, watchPath(v.id));
  const description = videoDescription(v);
  const image = v.thumbnail ? absoluteUrl(origin, v.thumbnail) : null;
  const duration = v.durationS !== null && v.durationS >= 0 ? String(Math.round(v.durationS)) : null;
  const player = opts.embed && v.visibility !== "private" ? { url: absoluteUrl(origin, embedPath(v.id)), ...playerSize(v) } : null;
  return {
    title: `${v.title} | ${siteName}`,
    description,
    alternates: { canonical: url },
    robots: videoRobots(v),
    openGraph: {
      type: "video.other",
      url,
      title: v.title,
      description,
      siteName,
      ...(image ? { images: [{ url: image, width: v.width ?? 1280, height: v.height ?? 720, alt: v.title }] } : {}),
      ...(player ? { videos: [{ url: player.url, ...(player.url.startsWith("https://") ? { secureUrl: player.url } : {}), type: "text/html", width: player.width, height: player.height }] } : {}),
    },
    twitter: player
      ? {
          card: "player",
          title: v.title,
          description,
          ...(image ? { images: [image] } : {}),
          players: [{ playerUrl: player.url, streamUrl: player.url, width: player.width, height: player.height }],
        }
      : {
          card: image ? "summary_large_image" : "summary",
          title: v.title,
          description,
          ...(image ? { images: [image] } : {}),
        },
    other: {
      ...(duration ? { "video:duration": duration } : {}),
      "video:channel": v.channel.name,
    },
  };
}

/** The metadata of /shorts/<id>: like a watch page, with the short's own canonical link. */
export function shortMetadata(v: SeoVideo, origin: string, siteName = "sloptube", opts: { embed?: boolean } = {}): Metadata {
  const base = watchMetadata(v, origin, siteName, opts);
  const url = absoluteUrl(origin, shortPath(v.id));
  return {
    ...base,
    title: `${v.title} | ${siteName} Snips`,
    alternates: { canonical: url },
    openGraph: { ...base.openGraph, url },
  };
}

/** The metadata of /embed/<id>: the title, kept out of search engines, the watch page as the canonical link. */
export function embedMetadata(v: SeoVideo, origin: string, siteName = "sloptube"): Metadata {
  return {
    title: `${v.title} | ${siteName}`,
    alternates: { canonical: absoluteUrl(origin, watchPath(v.id)) },
    robots: { index: false, follow: true },
  };
}

/** The metadata of /@handle: the channel's name, description, avatar and canonical link. */
export function channelMetadata(c: SeoChannel, origin: string, siteName = "sloptube", tab: "home" | "videos" | "shorts" | "about" = "home"): Metadata {
  const url = absoluteUrl(origin, channelPath(c.handle));
  const description = clip(c.description || `${c.name} on ${siteName}. ${c.videoCount} video${c.videoCount === 1 ? "" : "s"}.`);
  const image = c.avatarUrl ? absoluteUrl(origin, c.avatarUrl) : null;
  const tabTitle = tab === "home" ? "" : ` | ${tab === "about" ? "About" : tab === "videos" ? "Videos" : "Snips"}`;
  return {
    title: `${c.name}${tabTitle} | ${siteName}`,
    description,
    alternates: { canonical: tab === "home" ? url : `${url}/${tab}` },
    openGraph: {
      type: "profile",
      url,
      title: c.name,
      description,
      siteName,
      username: c.handle,
      ...(image ? { images: [{ url: image, width: 176, height: 176, alt: c.name }] } : {}),
    },
    twitter: { card: "summary", title: c.name, description, ...(image ? { images: [image] } : {}) },
  };
}

/** schema.org VideoObject for the watch page, as Google reads it. */
export function videoJsonLd(v: SeoVideo, origin: string): Record<string, unknown> {
  const url = absoluteUrl(origin, watchPath(v.id));
  const duration = isoDuration(v.durationS);
  return {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    "@id": url,
    name: v.title,
    description: v.description.trim() || v.title,
    url,
    ...(v.thumbnail ? { thumbnailUrl: [absoluteUrl(origin, v.thumbnail)] } : {}),
    uploadDate: new Date(v.date).toISOString(),
    ...(duration ? { duration } : {}),
    interactionStatistic: {
      "@type": "InteractionCounter",
      interactionType: { "@type": "WatchAction" },
      userInteractionCount: v.views,
    },
    author: { "@type": "Person", name: v.channel.name, url: absoluteUrl(origin, channelPath(v.channel.handle)) },
  };
}

/** JSON for a <script type="application/ld+json">, safe inside HTML (no closing tags). */
export function jsonLdText(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
