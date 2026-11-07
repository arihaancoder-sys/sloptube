// What search hands to the browser. Everything here is safe to show.
// Only relative imports, so Node can load this file directly.

import { rowToCard, type FeedCard, type FeedRow } from "../feed/types.ts";

/** A row from search_videos(): a feed card row plus the description and the keys. */
export type SearchVideoRow = FeedRow & {
  description: string | null;
  score: number | string | null;
  sort_key: number | string;
};

export type SearchVideo = FeedCard & { description: string };

export type SearchPage = { videos: SearchVideo[]; next: string | null };

/** A row from search_channels(). */
export type SearchChannelRow = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  subscriber_count: number | string | null;
  video_count: number | string | null;
};

export type SearchChannel = {
  id: string;
  handle: string;
  name: string;
  description: string;
  avatarUrl: string | null;
  subscriberCount: number;
  videoCount: number;
};

export function rowToSearchVideo(row: SearchVideoRow, publicBase: string | null): SearchVideo {
  return { ...rowToCard(row, publicBase), description: row.description ?? "" };
}

export function rowToSearchChannel(row: SearchChannelRow): SearchChannel {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    description: row.description ?? "",
    avatarUrl: row.avatar_url,
    subscriberCount: Number(row.subscriber_count) || 0,
    videoCount: Number(row.video_count) || 0,
  };
}
