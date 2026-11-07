"use client";

import { useSyncExternalStore } from "react";

const noSubscribe = () => () => {};

// One clock reading per page load, so the snapshot stays the same between renders.
let pageNow: number | null = null;

/** Date.now() in the browser, null while rendering on the server and hydrating. */
export function useClientNow(): number | null {
  return useSyncExternalStore(
    noSubscribe,
    () => (pageNow ??= Date.now()),
    () => null,
  );
}

/** The browser's time zone offset in minutes (0 on the server, so the first render matches). */
export function useTimezoneOffset(): number {
  return useSyncExternalStore(
    noSubscribe,
    () => new Date().getTimezoneOffset(),
    () => 0,
  );
}
