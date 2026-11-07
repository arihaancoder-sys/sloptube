"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { PlayIcon, VolumeOffIcon } from "@/components/icons";
import { useWatchPings } from "@/lib/engagement/useWatchPings";
import type { Short } from "@/lib/shorts/types";

/** Safari (desktop and iOS) plays HLS itself; everybody else gets hls.js. */
function preferNative(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

/**
 * One short's video. Only the short on screen loads its stream and plays,
 * looping; the others show their poster. It starts muted (browsers only
 * autoplay without sound) until the first tap anywhere on a short, which
 * turns the sound on for this one and every one after it. A later tap
 * pauses and plays. View pings go out like on the watch page, the first one
 * at 3 seconds, when a short's view counts.
 */
export function ShortPlayer({
  short,
  active,
  muted,
  pings,
  onUnmute,
}: {
  short: Short;
  active: boolean;
  muted: boolean;
  /** The engagement flag is on: send view pings. */
  pings: boolean;
  onUnmute: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);

  useWatchPings(short.id, videoRef, pings && active, { short: true });

  // Load and play the stream while on screen; let it go when scrolled away.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !active) return;
    let hls: Hls | null = null;
    let cancelled = false;
    setFailed(false);
    setPaused(false);
    const play = () => {
      video.play().catch(() => {
        if (!cancelled) setPaused(true);
      });
    };
    if (preferNative(video)) {
      video.src = short.src;
      play();
    } else {
      void import("hls.js").then(({ default: HlsClass }) => {
        if (cancelled) return;
        if (!HlsClass.isSupported()) {
          video.src = short.src;
          play();
          return;
        }
        hls = new HlsClass({ maxBufferLength: 20, backBufferLength: 30 });
        hls.on(HlsClass.Events.MANIFEST_PARSED, play);
        hls.on(HlsClass.Events.ERROR, (_e, data) => {
          if (!data.fatal || !hls) return;
          if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setFailed(true);
        });
        hls.loadSource(new URL(short.src, window.location.href).toString());
        hls.attachMedia(video);
      });
    }
    return () => {
      cancelled = true;
      video.pause();
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
      setProgress(0);
    };
  }, [active, short.src]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.muted = muted;
  }, [muted, active]);

  const tap = () => {
    const video = videoRef.current;
    if (!video) return;
    if (muted) {
      onUnmute();
      video.muted = false;
      if (video.paused) void video.play().catch(() => setPaused(true));
      return;
    }
    if (video.paused) void video.play().catch(() => setPaused(true));
    else video.pause();
  };

  return (
    <div className="absolute inset-0" data-short-player={active ? "active" : "idle"}>
      <video
        ref={videoRef}
        poster={short.thumbnail}
        loop
        playsInline
        muted={muted}
        preload="none"
        onPlay={() => setPaused(false)}
        onPause={() => setPaused(true)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration > 0) setProgress(v.currentTime / v.duration);
        }}
        className="h-full w-full bg-black object-cover"
      />
      <button
        type="button"
        onClick={tap}
        aria-label={muted ? "Turn the sound on" : paused ? "Play" : "Pause"}
        data-short-tap
        className="absolute inset-0 cursor-pointer"
      >
        {active && paused && !failed && (
          <span className="absolute left-1/2 top-1/2 grid h-16 w-16 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/50">
            <PlayIcon className="h-10 w-10 text-white" />
          </span>
        )}
      </button>
      {active && muted && (
        <span
          data-short-muted
          className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-sm bg-black/60 px-2 py-1 text-[12px] font-medium uppercase tracking-[0.3px] text-white"
        >
          <VolumeOffIcon className="h-4 w-4" />
          Tap to unmute
        </span>
      )}
      {failed && (
        <p className="absolute inset-x-4 top-1/2 -translate-y-1/2 text-center text-[14px] text-white">This Snip can&apos;t play right now.</p>
      )}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
        <div className="h-full bg-[var(--mark)]" style={{ width: `${Math.round(progress * 1000) / 10}%` }} />
      </div>
    </div>
  );
}
