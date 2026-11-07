// What the shorts routes and pages hand to the browser. Nothing here is
// secret: no owner ids. Only relative imports, so Node can load this file.

import { cardMedia, type FeedChannel } from "../feed/types.ts";
import { isReaction, type Reaction } from "../engagement/rules.ts";
import { playbackUrls } from "../watch/media.ts";
import type { ShortKey } from "./cursor.ts";

export type Short = {
  id: string;
  title: string;
  durationS: number | null;
  width: number | null;
  height: number | null;
  /** master.m3u8: MEDIA_PUBLIC_URL, or the media route. */
  src: string;
  thumbnail: string;
  publishedAt: string;
  views: number;
  likes: number;
  comments: number;
  /** "on", "off" or "held", the video's own or its channel's. */
  commentsMode: string;
  /** The viewer's thumb, when signed in and the engagement flag is on. */
  reaction: Reaction | null;
  channel: FeedChannel;
};

export type ShortsPage = { shorts: Short[]; next: string | null };

/** A row from list_shorts() or get_short(). */
export type ShortRow = {
  id: string;
  title: string;
  duration_s: number | string | null;
  width: number | null;
  height: number | null;
  thumbnail_url: string | null;
  hls_key: string | null;
  published_at: string;
  views: number | string | null;
  like_count: number | string | null;
  comment_count: number | string | null;
  comments_mode: string | null;
  my_reaction: string | null;
  channel_id: string;
  channel_handle: string;
  channel_name: string;
  channel_avatar_url: string | null;
  /** list_shorts only. */
  tier?: number | null;
  score?: number | string | null;
  as_of?: string | null;
  /** get_short only. */
  is_short?: boolean | null;
};

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function rowToShort(row: ShortRow, publicBase: string | null): Short {
  const id = row.id.toLowerCase();
  const hlsKey = row.hls_key || `hls/${id}/master.m3u8`;
  const media = cardMedia({ id, thumbnailUrl: row.thumbnail_url, hlsKey, spriteKey: null }, publicBase);
  return {
    id,
    title: row.title,
    durationS: num(row.duration_s),
    width: num(row.width),
    height: num(row.height),
    src: playbackUrls(id, hlsKey, null, publicBase).src,
    thumbnail: media.thumbnail,
    publishedAt: row.published_at,
    views: num(row.views) ?? 0,
    likes: num(row.like_count) ?? 0,
    comments: num(row.comment_count) ?? 0,
    commentsMode: row.comments_mode ?? "on",
    reaction: isReaction(row.my_reaction) ? row.my_reaction : null,
    channel: { id: row.channel_id, handle: row.channel_handle, name: row.channel_name, avatarUrl: row.channel_avatar_url },
  };
}

/** The keyset fields of a list_shorts() row, for the next cursor. */
export function rowKey(row: ShortRow): ShortKey & { asOf: string } {
  return { tier: Number(row.tier) || 0, score: num(row.score) ?? 0, id: row.id.toLowerCase(), asOf: row.as_of ?? "" };
}
