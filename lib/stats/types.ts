// studio_analytics(), video_analytics() and realtime_views() as the pages
// use them. Only relative imports, so Node can load this file directly.

import { fillDays, fillHours, isSource, parseRange, type DayPoint, type HourPoint, type Range, type Source } from "./rules.ts";
import { POINTS, type RetentionCounts } from "./retention.ts";

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const arr = (v: unknown) => (Array.isArray(v) ? (v as unknown[]) : []);
const day = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : fallback);

type Thumb = (id: string, name: string | null, url: string | null) => string | null;

export type TopVideo = {
  id: string;
  title: string;
  isShort: boolean;
  durationS: number | null;
  thumbnail: string | null;
  views: number;
  watchS: number;
};

export type ChannelAnalytics = {
  range: Range;
  from: string;
  to: string;
  channel: { id: string; handle: string; name: string; subscribers: number } | null;
  totals: { views: number; watchS: number; subsGained: number; subsLost: number; viewers: number };
  /** Every day of the range, zeros filled in. */
  daily: DayPoint[];
  top: TopVideo[];
};

function readDaily(v: unknown, from: string, to: string): DayPoint[] {
  const rows = arr(v)
    .map(obj)
    .filter((r): r is Record<string, unknown> => r !== null)
    .map((r) => ({ day: day(r.day, ""), views: num(r.views), watchS: num(r.watch_s) }))
    .filter((r) => r.day);
  return fillDays(rows, from, to);
}

const today = () => new Date().toISOString().slice(0, 10);

/** studio_analytics(range). */
export function readChannelAnalytics(o: unknown, thumbnailFor: Thumb): ChannelAnalytics {
  const r = obj(o) ?? {};
  const to = day(r.to, today());
  const from = day(r.from, to);
  const ch = obj(r.channel);
  const t = obj(r.totals) ?? {};
  return {
    range: parseRange(r.range),
    from,
    to,
    channel: ch ? { id: String(ch.id), handle: String(ch.handle ?? ""), name: String(ch.name ?? ch.handle ?? ""), subscribers: num(ch.subscribers) } : null,
    totals: { views: num(t.views), watchS: num(t.watch_s), subsGained: num(t.subs_gained), subsLost: num(t.subs_lost), viewers: num(t.viewers) },
    daily: readDaily(r.daily, from, to),
    top: arr(r.top)
      .map(obj)
      .filter((x): x is Record<string, unknown> => x !== null)
      .slice(0, 10)
      .map((x) => {
        const id = String(x.id);
        return {
          id,
          title: String(x.title ?? ""),
          isShort: x.is_short === true,
          durationS: x.duration_s === null || x.duration_s === undefined ? null : num(x.duration_s),
          thumbnail: x.status === "ready" ? thumbnailFor(id, (x.thumbnail_name as string | null) ?? null, (x.thumbnail_url as string | null) ?? null) : null,
          views: num(x.views),
          watchS: num(x.watch_s),
        };
      }),
  };
}

export type SourceRow = { source: Source; views: number; watchS: number };

export type VideoAnalytics = {
  range: Range;
  from: string;
  to: string;
  video: {
    id: string;
    title: string;
    isShort: boolean;
    durationS: number | null;
    thumbnail: string | null;
    publishedAt: string | null;
    createdAt: string;
    views: number;
    likes: number;
    dislikes: number;
    comments: number;
  };
  totals: { views: number; watchS: number; likes: number; dislikes: number; comments: number; viewers: number };
  daily: DayPoint[];
  retention: RetentionCounts;
  /** Most views first; empty when no ping carried a source. */
  sources: SourceRow[];
};

/** video_analytics(video_id, range). */
export function readVideoAnalytics(o: unknown, thumbnailFor: Thumb): VideoAnalytics {
  const r = obj(o) ?? {};
  const to = day(r.to, today());
  const from = day(r.from, to);
  const v = obj(r.video) ?? {};
  const t = obj(r.totals) ?? {};
  const ret = obj(r.retention) ?? {};
  const buckets = arr(ret.buckets).map(num);
  const id = String(v.id ?? "");
  return {
    range: parseRange(r.range),
    from,
    to,
    video: {
      id,
      title: String(v.title ?? ""),
      isShort: v.is_short === true,
      durationS: v.duration_s === null || v.duration_s === undefined ? null : num(v.duration_s),
      thumbnail: v.status === "ready" ? thumbnailFor(id, (v.thumbnail_name as string | null) ?? null, (v.thumbnail_url as string | null) ?? null) : null,
      publishedAt: (v.published_at as string | null) ?? null,
      createdAt: String(v.created_at ?? ""),
      views: num(v.views),
      likes: num(v.likes),
      dislikes: num(v.dislikes),
      comments: num(v.comments),
    },
    totals: { views: num(t.views), watchS: num(t.watch_s), likes: num(t.likes), dislikes: num(t.dislikes), comments: num(t.comments), viewers: num(t.viewers) },
    daily: readDaily(r.daily, from, to),
    retention: {
      viewers: num(ret.viewers),
      buckets: Array.from({ length: POINTS }, (_, k) => buckets[k] ?? 0),
    },
    sources: arr(r.sources)
      .map(obj)
      .filter((x): x is Record<string, unknown> => x !== null && isSource(x.source))
      .map((x) => ({ source: x.source as Source, views: num(x.views), watchS: num(x.watch_s) }))
      .sort((a, b) => b.views - a.views || b.watchS - a.watchS),
  };
}

/** realtime_views(video_id): the last 48 hours, every hour filled in. */
export function readRealtime(o: unknown, now: number = Date.now()): HourPoint[] {
  const rows = arr(o)
    .map(obj)
    .filter((x): x is Record<string, unknown> => x !== null && typeof x.hour === "string")
    .map((x) => ({ hour: String(x.hour), views: num(x.views) }));
  return fillHours(rows, now);
}
