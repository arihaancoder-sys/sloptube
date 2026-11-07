// Made up analytics for `next dev` without a database, so the pages can be
// seen (and filmed) before anything is set up. No real data.
import { addDays, fillHours, rangeBounds, type DayPoint, type HourPoint, type Range } from "./rules.ts";
import { bucketsFromMasks, markPing } from "./retention.ts";
import type { ChannelAnalytics, VideoAnalytics } from "./types.ts";

const DAY = 86_400_000;
const id = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;

/** A smooth, repeatable wave: no randomness, so screenshots stay the same. */
const wave = (i: number, base: number) => Math.max(0, Math.round(base * (1 + 0.35 * Math.sin(i / 3.1) + 0.15 * Math.cos(i / 1.7) + i / 400)));

function days(range: Range, now: number, created: string, base: number): { from: string; to: string; daily: DayPoint[] } {
  const { from, to, days: n } = rangeBounds(range, now, created);
  const daily = Array.from({ length: n }, (_, i) => {
    const views = wave(i + n, base);
    return { day: addDays(from, i), views, watchS: views * 190 };
  });
  return { from, to, daily };
}

const sum = (d: DayPoint[], k: "views" | "watchS") => d.reduce((n, x) => n + x[k], 0);

export function previewChannel(range: Range, now = Date.now()): ChannelAnalytics {
  const created = new Date(now - 200 * DAY).toISOString();
  const { from, to, daily } = days(range, now, created, 420);
  const views = sum(daily, "views");
  const titles = ["Fluffy pancakes in ten minutes", "Three sauces for any pasta", "Flipping pancakes in slow motion", "Sourdough starter, day one"];
  return {
    range,
    from,
    to,
    channel: { id: id(90), handle: "your_channel", name: "Your channel", subscribers: 1234 },
    totals: { views, watchS: sum(daily, "watchS"), subsGained: Math.round(daily.length * 4.2), subsLost: Math.round(daily.length * 0.8), viewers: Math.round(views * 0.62) },
    daily,
    top: titles.map((title, i) => ({
      id: id(i + 1),
      title,
      isShort: i === 2,
      durationS: i === 2 ? 28 : 300 + i * 17,
      thumbnail: "/sample-thumbnail.svg",
      views: Math.round(views * [0.46, 0.27, 0.18, 0.09][i]),
      watchS: Math.round(views * [0.46, 0.27, 0.18, 0.09][i] * 190),
    })),
  };
}

export function previewVideo(videoId: string, range: Range, now = Date.now()): VideoAnalytics {
  const created = new Date(now - 30 * DAY).toISOString();
  const { from, to, daily } = days(range, now, created, 180);
  const views = sum(daily, "views");
  const durationS = 317;
  // Viewers who leave along the way: most watch the start, a few to the end.
  const masks = Array.from({ length: 40 }, (_, v) => {
    const stop = Math.min(durationS, 20 + ((v * 37) % 40) * 8);
    let m = 0;
    for (let at = 10; at <= stop; at += 10) m = markPing(m, at, 10, durationS);
    return markPing(m, stop, 0, durationS);
  });
  return {
    range,
    from,
    to,
    video: {
      id: videoId,
      title: "Fluffy pancakes in ten minutes",
      isShort: false,
      durationS,
      thumbnail: "/sample-thumbnail.svg",
      publishedAt: created,
      createdAt: created,
      views: views + 1200,
      likes: 2310,
      dislikes: 41,
      comments: 184,
    },
    totals: { views, watchS: sum(daily, "watchS"), likes: Math.round(views * 0.05), dislikes: Math.round(views * 0.002), comments: Math.round(views * 0.004), viewers: Math.round(views * 0.8) },
    daily,
    retention: bucketsFromMasks(masks),
    sources: [
      { source: "home", views: Math.round(views * 0.41), watchS: Math.round(views * 0.41 * 200) },
      { source: "search", views: Math.round(views * 0.24), watchS: Math.round(views * 0.24 * 230) },
      { source: "subscriptions", views: Math.round(views * 0.15), watchS: Math.round(views * 0.15 * 260) },
      { source: "external", views: Math.round(views * 0.1), watchS: Math.round(views * 0.1 * 120) },
      { source: "channel", views: Math.round(views * 0.06), watchS: Math.round(views * 0.06 * 180) },
      { source: "direct", views: Math.round(views * 0.04), watchS: Math.round(views * 0.04 * 150) },
    ],
  };
}

export function previewRealtime(now = Date.now()): HourPoint[] {
  return fillHours([], now).map((h, i) => ({ hour: h.hour, views: wave(i, 14) }));
}
