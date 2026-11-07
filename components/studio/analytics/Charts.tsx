"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { areaPath, bars, compact, labelIndexes, linePath, nearestIndex, niceScale, slotIndex, xFor, yFor, type Scale } from "@/lib/stats/chart";

// Plain inline SVG charts for the analytics pages: one series each (the
// title names it), a recessive grid, the studio blue in both themes, a
// crosshair or a highlighted bar with a tooltip on hover and on touch.

export type ChartPoint = {
  /** The axis label under the point, when it gets one. */
  label: string;
  value: number;
  /** The tooltip's first line, like "Wed, Nov 4". */
  title: string;
  /** The tooltip's value line, like "1,204 views". */
  text: string;
};

const PAD = { top: 12, right: 8, bottom: 26, left: 44 };

/** The width the chart has, in pixels, so text stays its real size. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function Frame({
  height,
  points,
  scale,
  tickFormat,
  label,
  maxLabels,
  hit,
  children,
  name,
}: {
  height: number;
  points: ChartPoint[];
  scale: Scale;
  tickFormat: (n: number) => string;
  label: string;
  maxLabels?: number;
  /** Which point the mouse at x (inside the plot) is on. */
  hit: (x: number, plotW: number) => number;
  children: (plotW: number, plotH: number, active: number | null) => ReactNode;
  name: string;
}) {
  const [ref, width] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = height - PAD.top - PAD.bottom;
  const shown = new Set(labelIndexes(points.length, maxLabels ?? Math.max(2, Math.floor(plotW / 72))));

  const move = (clientX: number) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box || points.length === 0) return;
    setActive(hit(clientX - box.left - PAD.left, plotW));
  };

  const tip = active !== null ? points[active] : null;
  const tipX = active !== null ? PAD.left + (name === "bar" ? ((active + 0.5) / points.length) * plotW : xFor(active, points.length, plotW)) : 0;

  return (
    <div ref={ref} className="relative select-none" data-chart={name}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          className="block touch-pan-y"
          onPointerMove={(e) => move(e.clientX)}
          onPointerDown={(e) => move(e.clientX)}
          onPointerLeave={() => setActive(null)}
        >
          {/* The grid and the value axis. */}
          {scale.ticks.map((t) => {
            const y = PAD.top + yFor(t, scale, plotH);
            return (
              <g key={t}>
                <line x1={PAD.left} x2={width - PAD.right} y1={y} y2={y} stroke="var(--divider)" strokeWidth={1} shapeRendering="crispEdges" />
                <text x={PAD.left - 8} y={y} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--text-3)">
                  {tickFormat(t)}
                </text>
              </g>
            );
          })}
          {/* The labels under the plot. */}
          {points.map((p, i) =>
            shown.has(i) ? (
              <text
                key={i}
                x={PAD.left + (name === "bar" ? ((i + 0.5) / points.length) * plotW : xFor(i, points.length, plotW))}
                y={height - 8}
                textAnchor={name === "bar" ? "middle" : i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
                fontSize={11}
                fill="var(--text-3)"
              >
                {p.label}
              </text>
            ) : null,
          )}
          <g transform={`translate(${PAD.left},${PAD.top})`}>{children(plotW, plotH, active)}</g>
        </svg>
      )}
      {width === 0 && <div style={{ height }} />}
      {tip && (
        <div
          role="status"
          data-chart-tip
          className="pointer-events-none absolute top-0 z-10 whitespace-nowrap rounded-[2px] bg-surface px-3 py-2 text-[12px] leading-4 shadow-[var(--menu-shadow)]"
          style={{
            left: Math.min(Math.max(tipX, 70), Math.max(70, width - 70)),
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="text-text-2">{tip.title}</p>
          <p className="mt-0.5 font-medium text-text">{tip.text}</p>
        </div>
      )}
    </div>
  );
}

/** A line with a light fill under it, and a crosshair on hover. */
export function LineChart({
  points,
  label,
  height = 220,
  whole = true,
  max,
  tickFormat = compact,
}: {
  points: ChartPoint[];
  label: string;
  height?: number;
  whole?: boolean;
  /** A fixed top for the axis, like 100 for percentages. */
  max?: number;
  tickFormat?: (n: number) => string;
}) {
  const values = points.map((p) => p.value);
  const scale = max ? niceScale(max, 4, whole) : niceScale(Math.max(0, ...values), 4, whole);
  return (
    <Frame
      name="line"
      height={height}
      points={points}
      scale={scale}
      tickFormat={tickFormat}
      label={label}
      hit={(x, w) => nearestIndex(x, points.length, w)}
    >
      {(w, h, active) => (
        <>
          <path d={areaPath(values, scale, w, h)} fill="var(--studio-accent)" opacity={0.08} />
          <path d={linePath(values, scale, w, h)} fill="none" stroke="var(--studio-accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.length === 1 && <circle cx={xFor(0, 1, w)} cy={yFor(values[0], scale, h)} r={4} fill="var(--studio-accent)" />}
          {active !== null && (
            <>
              <line x1={xFor(active, points.length, w)} x2={xFor(active, points.length, w)} y1={0} y2={h} stroke="var(--text-3)" strokeWidth={1} />
              <circle
                cx={xFor(active, points.length, w)}
                cy={yFor(values[active], scale, h)}
                r={5}
                fill="var(--studio-accent)"
                stroke="var(--surface)"
                strokeWidth={2}
              />
            </>
          )}
        </>
      )}
    </Frame>
  );
}

/** Bars from the axis with rounded tops; the one under the mouse is darker. */
export function BarChart({
  points,
  label,
  height = 220,
  whole = false,
  tickFormat = compact,
  maxLabels,
}: {
  points: ChartPoint[];
  label: string;
  height?: number;
  whole?: boolean;
  tickFormat?: (n: number) => string;
  maxLabels?: number;
}) {
  const values = points.map((p) => p.value);
  const scale = niceScale(Math.max(0, ...values), 4, whole);
  return (
    <Frame
      name="bar"
      height={height}
      points={points}
      scale={scale}
      tickFormat={tickFormat}
      label={label}
      maxLabels={maxLabels}
      hit={(x, w) => slotIndex(x, points.length, w)}
    >
      {(w, h, active) =>
        bars(values, scale, w, h, points.length > 60 ? 0.1 : 0.25).map((b, i) => {
          const r = Math.min(4, b.width / 2, b.height);
          // A rounded top, a square foot on the axis.
          const d =
            b.height <= 0
              ? ""
              : `M${b.x},${b.y + b.height}V${b.y + r}Q${b.x},${b.y} ${b.x + r},${b.y}H${b.x + b.width - r}Q${b.x + b.width},${b.y} ${b.x + b.width},${b.y + r}V${b.y + b.height}Z`;
          return d ? (
            <path key={i} d={d} fill="var(--studio-accent)" opacity={active === null || active === i ? 1 : 0.55} data-bar={i} />
          ) : null;
        })
      }
    </Frame>
  );
}
