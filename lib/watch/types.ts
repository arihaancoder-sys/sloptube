// What the watch page hands to the browser. Everything here is safe to show:
// no keys, no owner ids. No imports, so the tests can load it.

export type WatchChannel = {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  subscriberCount: number;
};

export type WatchRendition = { name: string; width: number; height: number };

export type WatchVideo = {
  id: string;
  title: string;
  description: string;
  visibility: "private" | "unlisted" | "public";
  isOwner: boolean;
  /** published_at, or created_at for videos that were never public. */
  date: string;
  durationS: number | null;
  views: number;
  renditions: WatchRendition[];
  /** The poster. */
  thumbnail: string | null;
  /** master.m3u8, through /api/media or straight from MEDIA_PUBLIC_URL. Null in a preview without media. */
  src: string | null;
  /** The hover sprite's .vtt, or null when the video has none. */
  spriteVtt: string | null;
  channel: WatchChannel;
};

export type UpNextVideo = {
  id: string;
  title: string;
  thumbnail: string | null;
  durationS: number | null;
  views: number;
  date: string | null;
  /** From the feed (feature 6): the card's own channel. Else the watched video's. */
  channelName?: string;
};
