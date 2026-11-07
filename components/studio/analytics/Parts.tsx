"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { compact } from "@/lib/stats/chart";
import { fillHours, RANGE_LABELS, RANGES, viewsText, type HourPoint, type Range } from "@/lib/stats/rules";
import { BarChart } from "./Charts";

/** A white card on the grey studio page, like the dashboard's. */
export function Card({ title, hint, children, name, className = "" }: { title: string; hint?: ReactNode; children: ReactNode; name: string; className?: string }) {
  return (
    <section data-stats-card={name} className={`min-w-0 rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)] ${className}`}>
      <div className="px-6 pb-2 pt-5">
        <h2 className="text-[18px] font-normal leading-6 text-text">{title}</h2>
        {hint && <p className="mt-0.5 text-[12px] text-text-2">{hint}</p>}
      </div>
      <div className="px-6 pb-5">{children}</div>
    </section>
  );
}

/** One headline number: the label over it, a line under it. */
export function Tile({ label, value, note, name }: { label: string; value: string; note?: string; name: string }) {
  return (
    <div className="min-w-0 border-b border-divider px-6 py-4 sm:border-b-0 sm:border-r last:border-0" data-stat={name}>
      <p className="text-[13px] leading-4 text-text-2">{label}</p>
      <p className="mt-1 text-[26px] leading-8 text-text" data-stat-value>
        {value}
      </p>
      {note && <p className="mt-0.5 truncate text-[12px] text-text-2">{note}</p>}
    </div>
  );
}

export function Tiles({ children }: { children: ReactNode }) {
  return (
    <div className="grid rounded-[2px] bg-surface shadow-[0_0_0_1px_var(--divider)] sm:auto-cols-fr sm:grid-flow-col" data-stats-tiles>
      {children}
    </div>
  );
}

/** The range menu at the top right. Changing it reloads the page with ?range=. */
export function RangePicker({ range, from, to }: { range: Range; from: string; to: string }) {
  const router = useRouter();
  const path = usePathname();
  return (
    <label className="flex flex-col items-end gap-0.5">
      <span className="text-[12px] text-text-2" data-range-dates>
        {from === to ? from : `${from} to ${to}`}
      </span>
      <select
        value={range}
        aria-label="Date range"
        data-range
        onChange={(e) => router.push(`${path}?range=${e.target.value}`, { scroll: false })}
        className="h-9 rounded-[2px] border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-[14px] text-text"
      >
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {RANGE_LABELS[r]}
          </option>
        ))}
      </select>
    </label>
  );
}

const hourFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric" });

/**
 * "Realtime": counted views per hour for the last 48 hours, asked again every
 * minute while the tab is visible (not in the preview, which has no database).
 */
export function RealtimeCard({ initial, videoId, live }: { initial: HourPoint[]; videoId?: string; live: boolean }) {
  const [hours, setHours] = useState(initial);
  useEffect(() => {
    if (!live) return;
    const url = `/api/studio/analytics/realtime${videoId ? `?video=${videoId}` : ""}`;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      const res = await fetch(url, { cache: "no-store" }).catch(() => null);
      const json = res?.ok ? ((await res.json().catch(() => null)) as { hours?: HourPoint[] } | null) : null;
      if (json?.hours) setHours(fillHours(json.hours.map((h) => ({ hour: h.hour, views: h.views }))));
    };
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, [live, videoId]);

  const total = hours.reduce((n, h) => n + h.views, 0);
  const last = hours.at(-1)?.views ?? 0;
  return (
    <Card title="Realtime" hint="Updating live" name="realtime">
      <p className="text-[26px] leading-8 text-text" data-realtime-total>
        {total.toLocaleString("en-US")}
      </p>
      <p className="mb-3 text-[12px] text-text-2">Views · Last 48 hours</p>
      <BarChart
        label="Views per hour, last 48 hours"
        height={120}
        whole
        tickFormat={compact}
        maxLabels={2}
        points={hours.map((h, i) => ({
          label: i === 0 ? "48h" : i === hours.length - 1 ? "Now" : "",
          value: h.views,
          title: hourFormat.format(new Date(h.hour)),
          text: viewsText(h.views),
        }))}
      />
      <p className="mt-3 border-t border-divider pt-3 text-[13px] text-text-2">
        <span className="text-text" data-realtime-hour>
          {last.toLocaleString("en-US")}
        </span>{" "}
        {last === 1 ? "view" : "views"} this hour
      </p>
    </Card>
  );
}

/** The back arrow and a title, for the video page. */
export function BackTitle({ href, label, title }: { href: string; label: string; title: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Link href={href} aria-label={label} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-icon hover:bg-hover">
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden>
          <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
        </svg>
      </Link>
      <h1 className="truncate text-[24px] font-normal leading-8 text-text">{title}</h1>
    </div>
  );
}
