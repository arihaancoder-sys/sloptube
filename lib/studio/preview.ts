// Made up rows for `next dev` without a database, so the studio can be seen
// (and filmed) before anything is set up. No real data.
import type { Overview, StudioRow } from "./types.ts";

const DAY = 86_400_000;
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

function row(n: number, title: string, extra: Partial<StudioRow>, now: number): StudioRow {
  const at = new Date(now - n * 3.5 * DAY).toISOString();
  return {
    id: id(n),
    title,
    description: "",
    visibility: "public",
    status: "ready",
    isShort: false,
    shortChoice: null,
    durationS: 300 + n * 17,
    thumbnail: "/sample-thumbnail.svg",
    thumbnailName: null,
    hlsKey: null,
    tags: [],
    commentsMode: null,
    createdAt: at,
    publishedAt: at,
    views: 0,
    likes: 0,
    comments: 0,
    deletedAt: null,
    trashVisibility: null,
    ...extra,
  };
}

export function previewRows(trash: boolean, now = Date.now()): StudioRow[] {
  if (trash) {
    return [
      row(9, "Old intro, take two", { visibility: "private", trashVisibility: "unlisted", deletedAt: new Date(now - 4 * DAY).toISOString(), views: 12 }, now),
    ];
  }
  return [
    row(1, "Fluffy pancakes in ten minutes", { views: 48213, likes: 2310, comments: 184, tags: ["breakfast", "pancakes"] }, now),
    row(2, "Flipping pancakes in slow motion", { isShort: true, durationS: 28, views: 9120, likes: 801, comments: 22 }, now),
    row(3, "Sourdough starter, day one", { visibility: "unlisted", views: 311, likes: 18, comments: 4 }, now),
    row(4, "Kitchen tour (draft)", { visibility: "private", publishedAt: null, views: 0 }, now),
    row(5, "Three sauces for any pasta", { views: 15022, likes: 640, comments: 71 }, now),
  ];
}

export function previewOverview(now = Date.now()): Overview {
  const rows = previewRows(false, now);
  const latest = rows[0];
  return {
    channel: { id: id(90), handle: "your_channel", name: "Your channel", avatarUrl: null, subscribers: 1234 },
    totals: {
      views: rows.reduce((n, r) => n + r.views, 0),
      videos: rows.length,
      publicVideos: rows.filter((r) => r.visibility === "public").length,
      likes: rows.reduce((n, r) => n + r.likes, 0),
      comments: rows.reduce((n, r) => n + r.comments, 0),
      watchS: 5_400_000,
    },
    recent: { days: 28, views: 20410, watchS: 1_310_000 },
    latest: {
      id: latest.id,
      title: latest.title,
      visibility: latest.visibility,
      status: latest.status,
      thumbnail: latest.thumbnail,
      publishedAt: latest.publishedAt,
      createdAt: latest.createdAt,
      views: latest.views,
      likes: latest.likes,
      comments: latest.comments,
      watchS: 3_960_000,
    },
    trash: 1,
  };
}
