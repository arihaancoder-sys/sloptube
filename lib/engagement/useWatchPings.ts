"use client";

import { useEffect, type RefObject } from "react";
import { currentSource } from "@/lib/stats/useLastPath";
import { useProgress } from "@/lib/store/progress";
import { PingBatcher, type Ping } from "./pinger";
import { progressFraction, SHORT_VIEW_SECONDS } from "./rules";

const ROUTE = "/api/watch/ping";

/**
 * Sends the player's view pings to /api/watch/ping (lib/engagement/pinger.ts
 * decides when): a start ping, one every 10 seconds of playback, and the
 * rest on pause, end, a hidden tab and leaving. Leaving uses sendBeacon so
 * the last seconds still arrive. Also moves the red bar for this video, so
 * the cards show it right away. Only runs with the engagement flag on.
 */
export function useWatchPings(
  videoId: string,
  videoRef: RefObject<HTMLVideoElement | null>,
  enabled: boolean,
  opts: { short?: boolean } = {},
) {
  const short = opts.short === true;
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !video) return;
    // A short's view counts at 3 seconds, so its first tick goes out then.
    const batcher = new PingBatcher(short ? { firstS: SHORT_VIEW_SECONDS } : {});

    const send = (ping: Ping | null, leaving = false) => {
      if (!ping) return;
      const d = video.duration;
      if (Number.isFinite(d) && d > 0) useProgress.getState().put({ [videoId]: progressFraction(ping.positionS, d) });
      // The start ping opens the day's row, so it says where the viewer came from (traffic sources).
      const body = JSON.stringify({
        videoId,
        position: ping.positionS,
        played: ping.playedS,
        ...(ping.reason === "start" ? { source: currentSource() } : {}),
      });
      if (leaving && typeof navigator.sendBeacon === "function") {
        if (navigator.sendBeacon(ROUTE, new Blob([body], { type: "application/json" }))) return;
      }
      fetch(ROUTE, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {
        // A lost ping only loses a few seconds of watch time.
      });
    };

    const now = () => Date.now();
    const onPlaying = () => send(batcher.play(video.currentTime, now()));
    const onTime = () => {
      if (!video.paused) send(batcher.tick(video.currentTime, now()));
    };
    const onSeeking = () => batcher.seek(video.currentTime);
    const onPause = () => {
      if (!video.ended) send(batcher.flush(video.currentTime, now(), "pause"));
    };
    const onEnded = () => send(batcher.flush(video.currentTime, now(), "end"));
    const onHidden = () => {
      if (document.visibilityState === "hidden") send(batcher.flush(video.currentTime, now(), "leave"), true);
    };
    const onPageHide = () => send(batcher.flush(video.currentTime, now(), "leave"), true);

    video.addEventListener("playing", onPlaying);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      // Leaving for another video (Up next) without a page load.
      send(batcher.flush(video.currentTime, now(), "leave"), true);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [videoId, videoRef, enabled, short]);
}
