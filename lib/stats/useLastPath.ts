"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { viewSource } from "./source";
import type { Source } from "./rules";

// The page before this one inside the app. Client side navigation does not
// change document.referrer, so the app keeps it itself. Module state: one
// tab, one history, nothing stored.
let current: string | null = null;
let previous: string | null = null;

/** Mounted once in the root layout: follows the path as it changes. */
export function useTrackPath() {
  const path = usePathname();
  useEffect(() => {
    if (!path || path === current) return;
    previous = current;
    current = path;
  }, [path]);
}

/** Where the viewer of the page on screen came from, for the view ping. */
export function currentSource(): Source {
  return viewSource(previous, typeof document === "undefined" ? "" : document.referrer, typeof location === "undefined" ? "" : location.origin);
}
