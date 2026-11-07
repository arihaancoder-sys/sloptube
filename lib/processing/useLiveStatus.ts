"use client";

import { useEffect, useRef, useState } from "react";
import { STATUS_POLL_MS, isActive, type LiveStatus } from "./status";

type Polled = Pick<LiveStatus, "id" | "status" | "progress" | "job" | "thumbnailUrl" | "error">;

/**
 * Keeps videos that are on their way to ready up to date: every 5 seconds,
 * while any of them is uploaded or processing, it asks
 * /api/videos/<id>/status and merges the answer in. Stops by itself once
 * nothing is left to wait for, or for a video the route will not answer for.
 */
export function useLiveStatuses<T extends Polled>(initial: T[], enabled: boolean): T[] {
  const [live, setLive] = useState<Record<string, Polled>>({});
  const refused = useRef(new Set<string>());

  const merged = initial.map((v) => (live[v.id] ? { ...v, ...live[v.id] } : v));
  const activeIds = merged
    .filter((v) => isActive(v.status))
    .map((v) => v.id)
    .join(",");

  useEffect(() => {
    if (!enabled || !activeIds) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      const ids = activeIds.split(",").filter((id) => !refused.current.has(id));
      if (ids.length === 0) return;
      const answers = await Promise.all(
        ids.map(async (id) => {
          try {
            const res = await fetch(`/api/videos/${id}/status`, { cache: "no-store" });
            if (res.status >= 400 && res.status < 500) refused.current.add(id);
            return res.ok ? ((await res.json()) as Polled) : null;
          } catch {
            return null; // offline for a moment: ask again next time
          }
        }),
      );
      if (stopped) return;
      const fresh = answers.filter((a): a is Polled => a !== null && typeof a.id === "string");
      if (fresh.length) setLive((prev) => ({ ...prev, ...Object.fromEntries(fresh.map((a) => [a.id, a])) }));
      timer = setTimeout(poll, STATUS_POLL_MS);
    };

    timer = setTimeout(poll, STATUS_POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [enabled, activeIds]);

  return merged;
}
