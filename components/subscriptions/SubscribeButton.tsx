"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BellActiveIcon, BellOutlineIcon } from "@/components/icons";
import { useFlag, useSession } from "@/lib/store/session";
import { useSubscriptions } from "@/lib/store/subscriptions";
import { viewToggle } from "@/lib/subscriptions/toggle";

const base =
  "inline-flex h-9 shrink-0 items-center rounded-[2px] px-4 text-[14px] font-medium uppercase tracking-[0.007px]";
const red = `${base} bg-red text-white`;
// SUBSCRIBED is grey on grey in 2019: a light box with grey text, dark in the dark theme.
const grey = `${base} bg-[var(--sub-bg)] text-text-2`;

/** The disabled placeholder, while the flag is off or there is no database. */
function Placeholder({ title }: { title: string }) {
  return (
    <button type="button" disabled title={title} className={`${red} cursor-not-allowed opacity-60`} data-subscribe="off">
      Subscribe
    </button>
  );
}

/**
 * SUBSCRIBE (red) or SUBSCRIBED (grey) with the bell next to it, 2019 style.
 * Clicks show at once and go to the server one at a time (see
 * lib/subscriptions/toggle.ts). Signed out, the click goes to sign in and
 * comes back here. `count` is the subscriber count the server rendered.
 */
export function SubscribeButton({ channelId, channelName, count }: { channelId: string; channelName: string; count: number }) {
  const router = useRouter();
  const on = useFlag("subscriptions");
  const loaded = useSession((s) => s.loaded);
  const signedIn = useSession((s) => s.user !== null);
  const configured = useSession((s) => s.config !== null);
  const status = useSubscriptions((s) => s.status);
  const state = useSubscriptions((s) => s.toggles[channelId]);
  const seed = useSubscriptions((s) => s.seed);
  const toggle = useSubscriptions((s) => s.toggle);
  const bell = useSubscriptions((s) => s.bell);

  useEffect(() => {
    if (on && signedIn) seed(channelId, count);
  }, [on, signedIn, channelId, count, seed]);

  if (!loaded || !configured || !on) return <Placeholder title="Subscribing isn't on yet." />;

  if (!signedIn) {
    return (
      <button
        type="button"
        className={red}
        data-subscribe="signed-out"
        onClick={() => {
          const here = window.location.pathname + window.location.search;
          router.push(`/login?next=${encodeURIComponent(here)}`);
        }}
      >
        Subscribe
      </button>
    );
  }

  const ready = status === "ready" && state;
  const view = state ? viewToggle(state) : { subscribed: false, notify: false, count };
  if (!ready) {
    return (
      <button type="button" disabled className={`${red} opacity-60`} data-subscribe="loading" aria-busy>
        Subscribe
      </button>
    );
  }

  if (!view.subscribed) {
    return (
      <button
        type="button"
        className={red}
        data-subscribe="no"
        aria-pressed={false}
        onClick={() => toggle(channelId)}
      >
        Subscribe
      </button>
    );
  }

  const Bell = view.notify ? BellActiveIcon : BellOutlineIcon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      <button
        type="button"
        className={grey}
        data-subscribe="yes"
        aria-pressed
        title={`Unsubscribe from ${channelName}`}
        onClick={() => toggle(channelId)}
      >
        Subscribed
      </button>
      <button
        type="button"
        onClick={() => bell(channelId)}
        aria-label={view.notify ? "Turn off notifications" : "Turn on notifications"}
        aria-pressed={view.notify}
        title={view.notify ? "All notifications" : "No notifications"}
        data-sub-bell={view.notify ? "on" : "off"}
        className="grid h-10 w-10 place-items-center rounded-full text-icon hover:bg-hover"
      >
        <Bell className="h-6 w-6" />
      </button>
    </span>
  );
}
