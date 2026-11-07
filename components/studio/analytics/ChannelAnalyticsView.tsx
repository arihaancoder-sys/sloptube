"use client";

import Link from "next/link";
import { compact } from "@/lib/stats/chart";
import { clock, dayLabel, dayTitle, RANGE_LABELS, signed, viewsText, type HourPoint } from "@/lib/stats/rules";
import type { ChannelAnalytics } from "@/lib/stats/types";
import { watchHours } from "@/lib/studio/types";
import { SnipsIcon } from "../../icons";
import { BarChart, LineChart } from "./Charts";
import { Card, RangePicker, RealtimeCard, Tile, Tiles } from "./Parts";

const n = (v: number) => Math.max(0, Math.floor(v)).toLocaleString("en-US");
const hours = (s: number) => Math.max(0, s) / 3600;

/** /studio/analytics: the 2020 "Channel analytics" overview. */
export function ChannelAnalyticsView({ data, realtime, live }: { data: ChannelAnalytics; realtime: HourPoint[]; live: boolean }) {
  const { totals, daily, top } = data;
  const net = totals.subsGained - totals.subsLost;
  return (
    <div data-channel-analytics={data.range}>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[24px] font-normal leading-8 text-text">Channel analytics</h1>
        <RangePicker range={data.range} from={data.from} to={data.to} />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-6">
          <div>
            <p className="mb-3 text-[15px] text-text">
              Your channel got <span className="font-medium">{viewsText(totals.views)}</span> in the {RANGE_LABELS[data.range].toLowerCase()}
            </p>
            <Tiles>
              <Tile name="views" label="Views" value={n(totals.views)} />
              <Tile name="watch" label="Watch time (hours)" value={watchHours(totals.watchS)} />
              <Tile name="subscribers" label="Subscribers" value={signed(net)} note={`${n(totals.subsGained)} gained, ${n(totals.subsLost)} lost`} />
              <Tile name="audience" label="Estimated audience" value={n(totals.viewers)} note="Unique viewers" />
            </Tiles>
          </div>

          <Card title="Views" hint="Counted views per day" name="views-chart">
            <LineChart
              label="Views per day"
              points={daily.map((d) => ({ label: dayLabel(d.day), value: d.views, title: dayTitle(d.day), text: viewsText(d.views) }))}
            />
          </Card>

          <Card title="Watch time (hours)" hint="Hours watched per day" name="watch-chart">
            <BarChart
              label="Watch time in hours per day"
              tickFormat={(v) => compact(v)}
              points={daily.map((d) => ({
                label: dayLabel(d.day),
                value: hours(d.watchS),
                title: dayTitle(d.day),
                text: `${watchHours(d.watchS)} hours`,
              }))}
            />
          </Card>

          <Card title="Top videos" hint={`By views, ${RANGE_LABELS[data.range].toLowerCase()}`} name="top">
            {top.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-text-2" data-top-empty>
                No views in this period yet.
              </p>
            ) : (
              <ol className="-mx-6" data-top-videos>
                <li className="hidden grid-cols-[32px_minmax(0,1fr)_110px_110px] gap-4 border-b border-divider px-6 pb-2 text-[12px] text-text-2 sm:grid">
                  <span />
                  <span>Video</span>
                  <span className="text-right">Views</span>
                  <span className="text-right">Watch time (hours)</span>
                </li>
                {top.map((v, i) => (
                  <li
                    key={v.id}
                    className="grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-3 border-b border-divider px-6 py-2 last:border-0 sm:grid-cols-[32px_minmax(0,1fr)_110px_110px] sm:gap-4"
                    data-top-video={v.id}
                  >
                    <span className="text-[13px] text-text-2">{i + 1}</span>
                    <Link href={`/studio/video/${v.id}/analytics?range=${data.range}`} className="flex min-w-0 items-center gap-3 hover:underline">
                      <span className="relative hidden aspect-video w-[88px] shrink-0 overflow-hidden rounded-[2px] bg-skeleton sm:block">
                        {v.thumbnail && (
                          // A signed R2 link that changes on every load: next/image would only get in the way.
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={v.thumbnail} alt="" className="h-full w-full object-cover" />
                        )}
                        {v.durationS ? (
                          <span className="absolute bottom-0.5 right-0.5 rounded-[2px] bg-black/80 px-1 text-[11px] text-white">{clock(v.durationS)}</span>
                        ) : null}
                      </span>
                      <span className="flex min-w-0 items-center gap-1 text-[13px] leading-[18px] text-text">
                        {v.isShort && <SnipsIcon className="h-4 w-4 shrink-0 text-[var(--mark)]" />}
                        <span className="line-clamp-2">{v.title}</span>
                      </span>
                    </Link>
                    <span className="text-right text-[13px] text-text" data-top-views>
                      {n(v.views)}
                      <span className="text-text-2 sm:hidden"> views</span>
                    </span>
                    <span className="hidden text-right text-[13px] text-text sm:block">{watchHours(v.watchS)}</span>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <RealtimeCard initial={realtime} live={live} />
          <Card title="Subscribers" hint={RANGE_LABELS[data.range]} name="subscribers">
            <p className="text-[26px] leading-8 text-text" data-current-subscribers>
              {n(data.channel?.subscribers ?? 0)}
            </p>
            <p className="mb-3 text-[12px] text-text-2">Current subscribers</p>
            <div className="flex justify-between border-t border-divider py-2 text-[14px]">
              <span className="text-text-2">Gained</span>
              <span className="text-text">{n(totals.subsGained)}</span>
            </div>
            <div className="flex justify-between border-t border-divider py-2 text-[14px]">
              <span className="text-text-2">Lost</span>
              <span className="text-text">{n(totals.subsLost)}</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
