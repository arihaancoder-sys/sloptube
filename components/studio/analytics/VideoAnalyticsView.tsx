"use client";

import Link from "next/link";
import { compact } from "@/lib/stats/chart";
import { retentionCurve } from "@/lib/stats/retention";
import {
  averagePercent,
  averageViewS,
  clock,
  dayLabel,
  dayTitle,
  likeShare,
  percent,
  RANGE_LABELS,
  SOURCE_LABELS,
  viewsText,
  type HourPoint,
} from "@/lib/stats/rules";
import type { VideoAnalytics } from "@/lib/stats/types";
import { watchHours } from "@/lib/studio/types";
import { BarChart, LineChart } from "./Charts";
import { BackTitle, Card, RangePicker, RealtimeCard, Tile, Tiles } from "./Parts";

const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");

/** /studio/video/<id>/analytics: one video's numbers, the 2020 "Video analytics". */
export function VideoAnalyticsView({ data, realtime, live }: { data: VideoAnalytics; realtime: HourPoint[]; live: boolean }) {
  const { video, totals, daily, retention, sources } = data;
  const avg = averageViewS(totals.watchS, totals.views);
  const avgPct = averagePercent(totals.watchS, totals.views, video.durationS);
  const share = likeShare(totals.likes, totals.dislikes);
  const curve = retentionCurve(retention);
  const sourceViews = sources.reduce((s, x) => s + x.views, 0);
  const sourceMax = Math.max(1, ...sources.map((s) => s.views));

  return (
    <div data-video-analytics={video.id}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-4">
        <BackTitle href="/studio/content" label="Back to channel content" title="Video analytics" />
        <RangePicker range={data.range} from={data.from} to={data.to} />
      </div>

      <div className="mb-6 flex items-center gap-4">
        <span className="relative aspect-video w-[120px] shrink-0 overflow-hidden rounded-[2px] bg-skeleton">
          {video.thumbnail && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={video.thumbnail} alt="" className="h-full w-full object-cover" />
          )}
          {video.durationS ? (
            <span className="absolute bottom-0.5 right-0.5 rounded-[2px] bg-black/80 px-1 text-[11px] text-white">{clock(video.durationS)}</span>
          ) : null}
        </span>
        <div className="min-w-0">
          <p className="line-clamp-2 text-[15px] text-text" data-video-title>
            {video.title}
          </p>
          <p className="mt-1 flex flex-wrap gap-x-4 text-[13px]">
            <Link href={`/studio/video/${video.id}/edit`} className="font-medium uppercase text-[var(--studio-accent)] hover:underline">
              Details
            </Link>
            <Link href={video.isShort ? `/shorts/${video.id}` : `/watch?v=${video.id}`} className="font-medium uppercase text-[var(--studio-accent)] hover:underline">
              View on sloptube
            </Link>
          </p>
        </div>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <Tiles>
            <Tile name="views" label="Views" value={n(totals.views)} note={`${n(totals.viewers)} unique viewers`} />
            <Tile name="watch" label="Watch time (hours)" value={watchHours(totals.watchS)} />
            <Tile name="duration" label="Average view duration" value={clock(avg)} note={avgPct === null ? undefined : `${percent(avgPct)} of the video`} />
          </Tiles>

          <Card title="Views" hint={RANGE_LABELS[data.range]} name="views-chart">
            <LineChart
              label="Views per day"
              points={daily.map((d) => ({ label: dayLabel(d.day), value: d.views, title: dayTitle(d.day), text: viewsText(d.views) }))}
            />
          </Card>

          <Card title="Watch time (hours)" hint={RANGE_LABELS[data.range]} name="watch-chart">
            <BarChart
              label="Watch time in hours per day"
              tickFormat={(v) => compact(v)}
              points={daily.map((d) => ({ label: dayLabel(d.day), value: d.watchS / 3600, title: dayTitle(d.day), text: `${watchHours(d.watchS)} hours` }))}
            />
          </Card>

          <Card
            title="Audience retention"
            hint={
              curve.length
                ? `How many viewers were still watching at each point, out of ${n(retention.viewers)}`
                : "How many viewers were still watching at each point"
            }
            name="retention"
          >
            {curve.length === 0 || !video.durationS ? (
              <p className="py-6 text-center text-[14px] text-text-2" data-retention-empty>
                Not enough watching in this period to draw the curve yet.
              </p>
            ) : (
              <LineChart
                label="Audience retention: share of viewers still watching at each 5% of the video"
                max={100}
                whole
                tickFormat={(v) => `${v}%`}
                points={curve.map((p) => ({
                  label: clock(((video.durationS ?? 0) * p.at) / 100),
                  value: p.share,
                  title: p.at === 100 ? `The end (${clock(video.durationS ?? 0)})` : `${clock(((video.durationS ?? 0) * p.at) / 100)} (${p.at}%)`,
                  text: `${percent(p.share)} still watching`,
                }))}
              />
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <RealtimeCard initial={realtime} videoId={video.id} live={live} />

          <Card title="Engagement" hint={RANGE_LABELS[data.range]} name="engagement">
            <div className="flex justify-between py-2 text-[14px]">
              <span className="text-text-2">Likes</span>
              <span className="text-text" data-likes>
                {n(totals.likes)}
              </span>
            </div>
            <div className="flex justify-between border-t border-divider py-2 text-[14px]">
              <span className="text-text-2">Dislikes</span>
              <span className="text-text" data-dislikes>
                {n(totals.dislikes)}
              </span>
            </div>
            <div className="border-t border-divider py-2 text-[14px]">
              <div className="flex justify-between">
                <span className="text-text-2">Likes (vs. dislikes)</span>
                <span className="text-text" data-like-share>
                  {share === null ? "None yet" : percent(share)}
                </span>
              </div>
              {share !== null && (
                <div className="mt-2 h-1 overflow-hidden rounded-full bg-[var(--progress-track)]" aria-hidden>
                  <div className="h-full rounded-full bg-[var(--studio-accent)]" style={{ width: `${share}%` }} />
                </div>
              )}
            </div>
            <div className="flex justify-between border-t border-divider py-2 text-[14px]">
              <span className="text-text-2">Comments</span>
              <span className="text-text" data-comments>
                {n(totals.comments)}
              </span>
            </div>
          </Card>

          {/* Only when the view pings carried a source; no made up rows. */}
          {sources.length > 0 && (
            <Card title="Traffic sources" hint={`How viewers found this video, ${RANGE_LABELS[data.range].toLowerCase()}`} name="sources">
              <ul className="space-y-3" data-sources>
                {sources.map((s) => (
                  <li key={s.source} data-source={s.source}>
                    <div className="flex justify-between gap-3 text-[13px]">
                      <span className="truncate text-text">{SOURCE_LABELS[s.source]}</span>
                      <span className="shrink-0 text-text-2">
                        {n(s.views)} · {percent(sourceViews ? (s.views / sourceViews) * 100 : 0)}
                      </span>
                    </div>
                    <div className="mt-1 h-2 rounded-full bg-[var(--progress-track)]" aria-hidden>
                      <div className="h-full rounded-full bg-[var(--studio-accent)]" style={{ width: `${(s.views / sourceMax) * 100}%` }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
