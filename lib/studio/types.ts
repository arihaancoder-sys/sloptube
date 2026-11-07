// A row of studio_videos() and studio_overview() as the pages use them.
// Only relative imports, so Node can load this file directly.

export type Visibility = "private" | "unlisted" | "public";
export type CommentsMode = "on" | "off" | "held";

export type StudioRow = {
  id: string;
  title: string;
  description: string;
  visibility: Visibility;
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed";
  isShort: boolean;
  shortChoice: boolean | null;
  durationS: number | null;
  /** The picture to show: the chosen one, else the default still, else null. */
  thumbnail: string | null;
  thumbnailName: string | null;
  hlsKey: string | null;
  tags: string[];
  /** The video's own comments mode, null when it follows the channel. */
  commentsMode: CommentsMode | null;
  createdAt: string;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
  deletedAt: string | null;
  /** The visibility it gets back on restore. */
  trashVisibility: Visibility | null;
  /** Removed by moderation (016): when, and why. */
  removedAt?: string | null;
  removedReason?: string | null;
  /** The owner's appeal since the removal: open, dismissed (turned down), or null. */
  appeal?: "open" | "dismissed" | "actioned" | null;
};

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const VIS = new Set(["private", "unlisted", "public"]);
const vis = (v: unknown): Visibility => (VIS.has(String(v)) ? (v as Visibility) : "private");

/** A studio_videos() row; thumbnailFor turns the stored name and url into a link. */
export function rowToStudio(
  r: Record<string, unknown>,
  thumbnailFor: (id: string, name: string | null, url: string | null, hlsKey: string | null) => string | null,
): StudioRow {
  const id = String(r.id);
  const status = String(r.status ?? "uploading") as StudioRow["status"];
  const hlsKey = (r.hls_key as string | null) ?? null;
  const name = (r.thumbnail_name as string | null) ?? null;
  const url = (r.thumbnail_url as string | null) ?? null;
  const mode = r.comments_mode;
  return {
    id,
    title: String(r.title ?? ""),
    description: String(r.description ?? ""),
    visibility: vis(r.visibility),
    status,
    isShort: r.is_short === true,
    shortChoice: typeof r.short_choice === "boolean" ? r.short_choice : null,
    durationS: r.duration_s === null || r.duration_s === undefined ? null : num(r.duration_s),
    thumbnail: status === "ready" ? thumbnailFor(id, name, url, hlsKey) : null,
    thumbnailName: name,
    hlsKey,
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
    commentsMode: mode === "on" || mode === "off" || mode === "held" ? mode : null,
    createdAt: String(r.created_at ?? new Date(0).toISOString()),
    publishedAt: (r.published_at as string | null) ?? null,
    views: num(r.views),
    likes: num(r.like_count),
    comments: num(r.comment_count),
    deletedAt: (r.deleted_at as string | null) ?? null,
    trashVisibility: r.trash_visibility ? vis(r.trash_visibility) : null,
    removedAt: (r.removed_at as string | null) ?? null,
    removedReason: (r.removed_reason as string | null) ?? null,
    appeal: r.appeal === "open" || r.appeal === "dismissed" || r.appeal === "actioned" ? r.appeal : null,
  };
}

export type Overview = {
  channel: { id: string; handle: string; name: string; avatarUrl: string | null; subscribers: number } | null;
  totals: { views: number; videos: number; publicVideos: number; likes: number; comments: number; watchS: number };
  recent: { days: number; views: number; watchS: number };
  latest: {
    id: string;
    title: string;
    visibility: Visibility;
    status: StudioRow["status"];
    thumbnail: string | null;
    publishedAt: string | null;
    createdAt: string;
    views: number;
    likes: number;
    comments: number;
    watchS: number;
  } | null;
  trash: number;
};

/** studio_overview() as the dashboard uses it. */
export function readOverview(
  o: Record<string, unknown> | null,
  thumbnailFor: (id: string, name: string | null, url: string | null, hlsKey: string | null) => string | null,
): Overview {
  const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : null);
  const ch = obj(o?.channel);
  const t = obj(o?.totals) ?? {};
  const rc = obj(o?.recent) ?? {};
  const l = obj(o?.latest);
  return {
    channel: ch
      ? { id: String(ch.id), handle: String(ch.handle), name: String(ch.name ?? ch.handle), avatarUrl: (ch.avatar_url as string | null) ?? null, subscribers: num(ch.subscribers) }
      : null,
    totals: { views: num(t.views), videos: num(t.videos), publicVideos: num(t.public_videos), likes: num(t.likes), comments: num(t.comments), watchS: num(t.watch_s) },
    recent: { days: num(rc.days) || 28, views: num(rc.views), watchS: num(rc.watch_s) },
    latest: l
      ? {
          id: String(l.id),
          title: String(l.title ?? ""),
          visibility: vis(l.visibility),
          status: String(l.status ?? "ready") as StudioRow["status"],
          thumbnail:
            l.status === "ready"
              ? thumbnailFor(String(l.id), (l.thumbnail_name as string | null) ?? null, (l.thumbnail_url as string | null) ?? null, (l.hls_key as string | null) ?? null)
              : null,
          publishedAt: (l.published_at as string | null) ?? null,
          createdAt: String(l.created_at ?? ""),
          views: num(l.views),
          likes: num(l.likes),
          comments: num(l.comments),
          watchS: num(l.watch_s),
        }
      : null,
    trash: num(o?.trash),
  };
}

/** "0.0", "1.4", "120": hours of watch time, like the 2019 dashboard. */
export function watchHours(seconds: number): string {
  const h = Math.max(0, seconds) / 3600;
  return h >= 100 ? Math.round(h).toLocaleString("en-US") : h.toFixed(1);
}
