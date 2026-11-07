import type { ChannelLink } from "./validation";

/** A channel as the pages use it. Safe for the browser: everything here is public. */
export type Channel = {
  id: string;
  ownerId: string;
  handle: string;
  name: string;
  description: string;
  links: ChannelLink[];
  avatarUrl: string | null;
  bannerUrl: string | null;
  handleChangedAt: string | null;
  subscriberCount: number;
  videoCount: number;
  createdAt: string;
};

export const CHANNEL_COLUMNS =
  "id, owner_id, handle, name, description, links, avatar_url, banner_url, handle_changed_at, subscriber_count, video_count, created_at";

type ChannelRow = {
  id: string;
  owner_id: string;
  handle: string;
  name: string | null;
  description: string | null;
  links: unknown;
  avatar_url: string | null;
  banner_url: string | null;
  handle_changed_at: string | null;
  subscriber_count: number | null;
  video_count: number | null;
  created_at: string;
};

function toLinks(value: unknown): ChannelLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l): l is ChannelLink => typeof l?.title === "string" && typeof l?.url === "string")
    .map((l) => ({ title: l.title, url: l.url }));
}

export function rowToChannel(row: ChannelRow): Channel {
  return {
    id: row.id,
    ownerId: row.owner_id,
    handle: row.handle,
    name: row.name || row.handle,
    description: row.description ?? "",
    links: toLinks(row.links),
    avatarUrl: row.avatar_url,
    bannerUrl: row.banner_url,
    handleChangedAt: row.handle_changed_at,
    subscriberCount: row.subscriber_count ?? 0,
    videoCount: row.video_count ?? 0,
    createdAt: row.created_at,
  };
}

/** A made up channel, shown as a preview when the database is not connected. */
export function previewChannel(handle: string): Channel {
  return {
    id: "preview",
    ownerId: "preview",
    handle,
    name: handle.replace(/[._]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Your channel",
    description:
      "This is a preview of a channel page. Connect the database to see real channels.\n\nChannel owners write their description in the studio.",
    links: [{ title: "Source on GitHub", url: "https://github.com/myfilehero/sloptube" }],
    avatarUrl: null,
    bannerUrl: "/sample-banner.svg",
    handleChangedAt: null,
    subscriberCount: 0,
    videoCount: 0,
    createdAt: "2026-01-01T00:00:00Z",
  };
}
