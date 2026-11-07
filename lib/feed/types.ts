// What the feed hands to the browser: one card per video, and pages of them.
// Everything here is safe to show: no keys, no owner ids.
// Only relative imports, so Node can load this file directly.

import { playbackUrls } from "../watch/media.ts";

/** channel_shorts: one channel's shorts (feature 11), newest first. */
export type FeedKind = "newest" | "trending" | "channel" | "channel_shorts";

export type FeedChannel = { id: string; handle: string; name: string; avatarUrl: string | null };

export type FeedCard = {
  id: string;
  title: string;
  durationS: number | null;
  /** The thumbnail: MEDIA_PUBLIC_URL, the encoder's thumbnail_url, or /api/media. */
  thumbnail: string;
  /** The hover sprite's .vtt, or null when the video has none. */
  spriteVtt: string | null;
  publishedAt: string;
  views: number;
  channel: FeedChannel;
  /** Vertical and a minute or less (feature 11). */
  isShort: boolean;
};

export type FeedPage = { cards: FeedCard[]; next: string | null };

/** A row from feed_videos() or related_videos(). */
export type FeedRow = {
  id: string;
  title: string;
  duration_s: number | string | null;
  thumbnail_url: string | null;
  hls_key: string | null;
  preview_sprite_key: string | null;
  published_at: string;
  views: number | string | null;
  channel_id: string;
  channel_handle: string;
  channel_name: string;
  channel_avatar_url: string | null;
  /** From 013 on; older rows and related_videos() have none. */
  is_short?: boolean | null;
};

export function isFeedKind(v: unknown): v is FeedKind {
  return v === "newest" || v === "trending" || v === "channel" || v === "channel_shorts";
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * The thumbnail and sprite links for a card. The feed never signs anything:
 * with MEDIA_PUBLIC_URL the browser loads the public file, else it asks
 * /api/media/<id>/thumb-1.webp, and the route signs that one image when the
 * browser actually loads it. So a page of 50 cards costs no signing up front.
 */
export function cardMedia(
  v: { id: string; thumbnailUrl: string | null; hlsKey: string | null; spriteKey: string | null },
  publicBase: string | null,
): { thumbnail: string; spriteVtt: string | null } {
  const id = v.id.toLowerCase();
  const urls = playbackUrls(id, v.hlsKey || `hls/${id}/master.m3u8`, v.spriteKey, publicBase);
  return { thumbnail: v.thumbnailUrl || urls.thumbnail("thumb-1.webp"), spriteVtt: urls.spriteVtt };
}

export function rowToCard(row: FeedRow, publicBase: string | null): FeedCard {
  const media = cardMedia(
    { id: row.id, thumbnailUrl: row.thumbnail_url, hlsKey: row.hls_key, spriteKey: row.preview_sprite_key },
    publicBase,
  );
  return {
    id: row.id,
    title: row.title,
    durationS: num(row.duration_s),
    thumbnail: media.thumbnail,
    spriteVtt: media.spriteVtt,
    publishedAt: row.published_at,
    views: num(row.views) ?? 0,
    channel: {
      id: row.channel_id,
      handle: row.channel_handle,
      name: row.channel_name,
      avatarUrl: row.channel_avatar_url,
    },
    isShort: row.is_short === true,
  };
}
