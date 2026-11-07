"use client";

import { useTrackPath } from "@/lib/stats/useLastPath";

/** Remembers the previous page, so a view can say where it came from (traffic sources). */
export function PathTracker() {
  useTrackPath();
  return null;
}
