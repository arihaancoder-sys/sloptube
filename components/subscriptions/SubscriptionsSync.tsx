"use client";

import { useEffect } from "react";
import { useFlag, useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";

/**
 * Reads the signed in person's subscriptions once per page load (for the
 * guide and every Subscribe button) and shows the toast. Mounted once, in the
 * layout. Signed out or with the flag off it reads nothing.
 */
export function SubscriptionsSync() {
  const loaded = useSession((s) => s.loaded);
  const userId = useSession((s) => s.user?.id ?? null);
  const on = useFlag("subscriptions");
  const load = useSubscriptions((s) => s.load);
  const reset = useSubscriptions((s) => s.reset);

  useEffect(() => {
    if (!loaded) return;
    if (userId && on) void load();
    else reset();
  }, [loaded, userId, on, load, reset]);

  return <Toast />;
}

/** The 2019 toast: a dark box at the bottom left for a few seconds. */
function Toast() {
  const toast = useSubscriptions((s) => s.toast);
  const clear = useSubscriptions((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => clear(toast.id), 4000);
    return () => clearTimeout(t);
  }, [toast, clear]);

  if (!toast) return null;
  return (
    <div
      role="status"
      data-sub-toast
      className="fixed bottom-6 left-3 right-3 z-50 rounded-sm bg-[#323232] px-6 py-3.5 text-[14px] leading-5 text-white shadow-lg sm:left-6 sm:right-auto sm:min-w-[288px] sm:max-w-[568px]"
    >
      {toast.text}
    </div>
  );
}
