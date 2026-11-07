"use client";

import type Hls from "hls.js";
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DefaultViewIcon,
  FullscreenExitIcon,
  FullscreenIcon,
  PauseIcon,
  PipIcon,
  PlayIcon,
  ReplayIcon,
  SettingsIcon,
  TheaterIcon,
  VolumeDownIcon,
  VolumeOffIcon,
  VolumeUpIcon,
} from "@/components/icons";
import { resumeAt } from "@/lib/engagement/rules";
import type { WatchEngagement } from "@/lib/engagement/types";
import { useWatchPings } from "@/lib/engagement/useWatchPings";
import { useWatch } from "@/lib/store/watch";
import { formatTime } from "@/lib/watch/format";
import { clampTime, keyAction, stepVolume, type PlayerAction } from "@/lib/watch/keys";
import { loadQuality, loadResume, loadVolume, saveQuality, saveResume, saveVolume } from "@/lib/watch/prefs";
import { AUTO, levelForSaved, qualityOptions, qualitySummary, SPEEDS, speedLabel, type QualityOption } from "@/lib/watch/quality";
import { cueAt, parseSpriteVtt, type SpriteCue } from "@/lib/watch/vtt";

type Props = {
  videoId: string;
  /** master.m3u8, or null in a preview without media. */
  src: string | null;
  poster: string | null;
  spriteVtt: string | null;
  /** From the database, so the bar has a length before the playlist loads. */
  durationS: number | null;
  /** ?t= from a shared link, in seconds. Wins over the remembered position. */
  startAt: number;
  /**
   * With the engagement flag on (feature 9): the player sends view pings, and
   * for a signed in viewer starts from the position saved in their history.
   * Signed out, or with the flag off, the browser's own position is used.
   */
  engagement?: WatchEngagement | null;
  /** /embed/<id> (feature 16): no theater mode, there is no page around it. */
  embed?: boolean;
};

type Menu = null | "main" | "quality" | "speed";

/** Controls fade out after this long without the mouse moving, while playing. */
const IDLE_MS = 2500;
/** The resume position is saved this often while playing. */
const RESUME_EVERY_S = 5;
/** A key press note (volume, subtitles) stays this long. */
const NOTE_MS = 1200;
/** The "Resumed" note stays this long after playback starts. */
const RESUMED_MS = 3000;

/** Safari (desktop and iOS) plays HLS itself; everybody else gets hls.js. */
function preferNative(video: HTMLVideoElement): boolean {
  if (!video.canPlayType("application/vnd.apple.mpegurl")) return false;
  const ua = navigator.userAgent;
  return /safari/i.test(ua) && !/chrome|chromium|crios|android|edg/i.test(ua);
}

/**
 * The video player, in the 2019 YouTube style: red progress bar with sprite
 * previews on hover, a big play button while paused, and a bottom bar with
 * play, volume, time, the settings gear (speed and quality), theater, picture
 * in picture and fullscreen. hls.js everywhere except Safari, which plays
 * HLS natively (and then picks the quality itself).
 */
export function Player({ videoId, src, poster, spriteVtt, durationS, startAt, engagement = null, embed = false }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const gearRef = useRef<HTMLButtonElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastSaved = useRef(0);

  const theater = useWatch((s) => s.theater);
  const toggleTheater = useWatch((s) => s.toggleTheater);
  const setStoreTime = useWatch((s) => s.setCurrentTime);

  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(durationS ?? 0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [options, setOptions] = useState<QualityOption[]>([]);
  const [chosen, setChosen] = useState(AUTO);
  const [playingLevel, setPlayingLevel] = useState(-1);
  const [native, setNative] = useState(false);
  const [menu, setMenu] = useState<Menu>(null);
  const [active, setActive] = useState(true);
  const [hover, setHover] = useState<{ x: number; t: number; w: number } | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const [volumeDrag, setVolumeDrag] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [pipOk, setPipOk] = useState(false);
  const [cues, setCues] = useState<SpriteCue[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [resumed, setResumed] = useState(false);
  // A short note after a key press (volume, mute, subtitles), also read out by screen readers.
  const [note, setNote] = useState<string | null>(null);
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flash = useCallback((text: string) => {
    setNote(text);
    if (noteTimer.current) clearTimeout(noteTimer.current);
    noteTimer.current = setTimeout(() => setNote(null), NOTE_MS);
  }, []);

  // The server only hands engagement over when the flag is on for this
  // viewer, so this is known from the first render and the stream loads once.
  const engagementOn = engagement !== null;
  // A signed in viewer resumes from their history (past 10 s, before 90%).
  // null: use the position this browser remembers.
  const serverStart =
    engagementOn && engagement?.signedIn ? resumeAt(engagement.positionS, engagement.durationS ?? durationS) : null;
  useWatchPings(videoId, videoRef, engagementOn);

  // Load the stream -------------------------------------------------------------------

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    let cancelled = false;
    let hls: Hls | null = null;
    const saved = loadQuality();
    const start = startAt > 0 ? startAt : (serverStart ?? loadResume(videoId));
    setResumed(startAt <= 0 && serverStart !== null && serverStart > 0);
    const v = loadVolume();
    video.volume = v.volume;
    video.muted = v.muted;
    setVolume(v.volume);
    setMuted(v.muted);
    setPipOk(typeof document !== "undefined" && document.pictureInPictureEnabled === true);

    const tryAutoplay = () => {
      video.play().catch(() => {
        // Autoplay with sound is often blocked: the big play button is there.
      });
    };

    if (preferNative(video)) {
      setNative(true);
      setOptions(qualityOptions([]));
      video.src = src;
      video.addEventListener(
        "loadedmetadata",
        () => {
          if (start > 0) video.currentTime = start;
          tryAutoplay();
        },
        { once: true },
      );
      return () => {
        video.removeAttribute("src");
        video.load();
      };
    }

    void import("hls.js").then(({ default: HlsClass }) => {
      if (cancelled) return;
      if (!HlsClass.isSupported()) {
        if (video.canPlayType("application/vnd.apple.mpegurl")) {
          setNative(true);
          setOptions(qualityOptions([]));
          video.src = src;
        } else {
          setError("This browser can't play this video.");
        }
        return;
      }
      hls = new HlsClass({ startPosition: start > 0 ? start : -1, maxBufferLength: 30, backBufferLength: 60 });
      hlsRef.current = hls;
      hls.on(HlsClass.Events.MANIFEST_PARSED, (_e, data) => {
        const opts = qualityOptions(data.levels.map((l) => ({ height: l.height, width: l.width, bitrate: l.bitrate })));
        setOptions(opts);
        const level = levelForSaved(opts, saved);
        setChosen(level);
        if (hls && level !== AUTO) {
          hls.startLevel = level;
          hls.currentLevel = level;
        }
        tryAutoplay();
      });
      hls.on(HlsClass.Events.LEVEL_SWITCHED, (_e, data) => setPlayingLevel(data.level));
      hls.on(HlsClass.Events.ERROR, (_e, data) => {
        if (!data.fatal || !hls) return;
        if (data.type === HlsClass.ErrorTypes.NETWORK_ERROR) hls.startLoad();
        else if (data.type === HlsClass.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else setError("Something went wrong playing this video. Reload the page to try again.");
      });
      hls.loadSource(new URL(src, window.location.href).toString());
      hls.attachMedia(video);
    });

    return () => {
      cancelled = true;
      hls?.destroy();
      hlsRef.current = null;
    };
  }, [src, startAt, videoId, serverStart]);

  // "Resumed" fades a moment after playback starts.
  useEffect(() => {
    if (!resumed || !started) return;
    const t = setTimeout(() => setResumed(false), RESUMED_MS);
    return () => clearTimeout(t);
  }, [resumed, started]);

  // The hover sprite ------------------------------------------------------------------

  useEffect(() => {
    if (!spriteVtt) return;
    let stopped = false;
    const url = new URL(spriteVtt, window.location.href).toString();
    fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => {
        if (stopped) return;
        const parsed = parseSpriteVtt(text, url);
        setCues(parsed);
        if (parsed[0]) new Image().src = parsed[0].url;
      })
      .catch(() => {});
    return () => {
      stopped = true;
    };
  }, [spriteVtt]);

  // Remember where the video was left -------------------------------------------------

  useEffect(() => {
    const save = () => {
      const video = videoRef.current;
      if (video && video.currentTime > 0) saveResume(videoId, video.currentTime, video.duration);
    };
    window.addEventListener("pagehide", save);
    return () => {
      save();
      window.removeEventListener("pagehide", save);
    };
  }, [videoId]);

  // Fullscreen ------------------------------------------------------------------------

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Actions ---------------------------------------------------------------------------

  const poke = useCallback(() => {
    setActive(true);
    clearTimeout(idleTimer.current);
    idleTimer.current = setTimeout(() => setActive(false), IDLE_MS);
  }, []);

  useEffect(() => () => clearTimeout(idleTimer.current), []);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    if (video.paused || video.ended) video.play().catch(() => {});
    else video.pause();
  }, [src]);

  const seekTo = useCallback((t: number) => {
    const video = videoRef.current;
    if (!video) return;
    const d = Number.isFinite(video.duration) ? video.duration : duration;
    video.currentTime = clampTime(t, d);
    setTime(video.currentTime);
  }, [duration]);

  const toggleFullscreen = useCallback(() => {
    const wrap = wrapRef.current;
    const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (!wrap || !video) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else if (wrap.requestFullscreen) void wrap.requestFullscreen().catch(() => {});
    else video.webkitEnterFullscreen?.();
  }, []);

  const togglePip = useCallback(() => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) void document.exitPictureInPicture().catch(() => {});
    else void video.requestPictureInPicture().catch(() => {});
  }, []);

  /** c: subtitles on or off, from hls.js or the video's own text tracks; a note when the video has none. */
  const toggleCaptions = useCallback(() => {
    const video = videoRef.current;
    const hls = hlsRef.current;
    if (hls && hls.subtitleTracks.length > 0) {
      const on = hls.subtitleTrack >= 0 && hls.subtitleDisplay;
      hls.subtitleDisplay = !on;
      hls.subtitleTrack = on ? -1 : 0;
      return flash(on ? "Subtitles off" : "Subtitles on");
    }
    const tracks = video ? Array.from(video.textTracks).filter((t) => t.kind === "subtitles" || t.kind === "captions") : [];
    if (tracks.length === 0) return flash("No subtitles for this video");
    const on = tracks.some((t) => t.mode === "showing");
    tracks.forEach((t, i) => (t.mode = !on && i === 0 ? "showing" : "disabled"));
    flash(on ? "Subtitles off" : "Subtitles on");
  }, [flash]);

  const run = useCallback(
    (action: PlayerAction) => {
      const video = videoRef.current;
      if (!video) return;
      switch (action.type) {
        case "toggle-play":
          return togglePlay();
        case "seek-by":
          return seekTo(video.currentTime + action.seconds);
        case "seek-percent": {
          const d = Number.isFinite(video.duration) ? video.duration : duration;
          return seekTo((d * action.percent) / 100);
        }
        case "volume-by":
          if (video.muted && action.delta > 0) video.muted = false;
          video.volume = stepVolume(video.volume, action.delta);
          return flash(`${Math.round((video.muted ? 0 : video.volume) * 100)}%`);
        case "toggle-mute":
          video.muted = !video.muted;
          return flash(video.muted ? "Muted" : `${Math.round(video.volume * 100)}%`);
        case "fullscreen":
          return toggleFullscreen();
        case "theater":
          return embed ? undefined : toggleTheater();
        case "pip":
          return togglePip();
        case "captions":
          return toggleCaptions();
      }
    },
    [duration, embed, flash, seekTo, toggleCaptions, toggleFullscreen, togglePip, togglePlay, toggleTheater],
  );

  // Keyboard shortcuts, page wide like YouTube, but never while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('[role="dialog"]')) return;
      const action = keyAction({
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        altKey: e.altKey,
        targetTag: target?.tagName,
        targetEditable: target?.isContentEditable,
      });
      if (!action) return;
      e.preventDefault();
      run(action);
      poke();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [run, poke]);

  // Close the settings menu on a click anywhere else.
  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || gearRef.current?.contains(t)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  const pickQuality = (opt: QualityOption) => {
    setChosen(opt.level);
    saveQuality(opt.label);
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = opt.level;
    setMenu(null);
  };

  const pickSpeed = (r: number) => {
    if (videoRef.current) videoRef.current.playbackRate = r;
    setMenu(null);
  };

  // Progress bar and volume slider ----------------------------------------------------

  const timeAtPointer = (clientX: number) => {
    const bar = barRef.current;
    if (!bar || !(duration > 0)) return null;
    const rect = bar.getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, clientX - rect.left));
    return { x, t: (x / rect.width) * duration, w: rect.width };
  };

  const onBarMove = (e: ReactPointerEvent) => {
    const at = timeAtPointer(e.clientX);
    setHover(at);
    if (scrubbing && at) seekTo(at.t);
  };

  const onBarDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const at = timeAtPointer(e.clientX);
    if (!at) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrubbing(true);
    seekTo(at.t);
  };

  const onBarUp = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    setScrubbing(false);
  };

  const setVolumeAt = (clientX: number) => {
    const el = volumeRef.current;
    const video = videoRef.current;
    if (!el || !video) return;
    const rect = el.getBoundingClientRect();
    const v = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    video.volume = Math.round(v * 100) / 100;
    video.muted = v === 0;
  };

  // Rendering -------------------------------------------------------------------------

  const summary = qualitySummary(options, chosen, playingLevel);
  const playingOpt = options.find((o) => o.level === (chosen === AUTO ? playingLevel : chosen));
  const hd = playingOpt?.hd ?? false;
  const showChrome = !playing || active || menu !== null || scrubbing || volumeDrag;
  const shownVolume = muted ? 0 : volume;
  const VolumeIcon = muted || volume === 0 ? VolumeOffIcon : volume < 0.5 ? VolumeDownIcon : VolumeUpIcon;
  const pct = (n: number) => (duration > 0 ? `${Math.min(100, (n / duration) * 100)}%` : "0%");
  const cue = hover && cues.length ? cueAt(cues, hover.t) : null;
  const tipHalf = Math.max(cue ? cue.w + 4 : 0, 48) / 2;
  const tipLeft = hover ? Math.min(Math.max(hover.x, tipHalf), Math.max(tipHalf, hover.w - tipHalf)) : 0;
  // The encoder cuts 160 x 90 tiles, so a frame is shown at its own size.
  const sprite = cue
    ? { backgroundImage: `url("${cue.url}")`, backgroundPosition: `-${cue.x}px -${cue.y}px`, width: cue.w, height: cue.h }
    : undefined;

  return (
    <div
      ref={wrapRef}
      data-player
      data-player-state={ended ? "ended" : playing ? "playing" : "paused"}
      data-quality={summary}
      data-level={playingLevel}
      data-native={native ? "1" : undefined}
      onPointerMove={poke}
      onPointerLeave={() => playing && setActive(false)}
      className={`group/player relative h-full w-full select-none overflow-hidden bg-black text-white ${
        showChrome ? "" : "cursor-none"
      }`}
    >
      <video
        ref={videoRef}
        poster={poster ?? undefined}
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-contain"
        onClick={() => (menu ? setMenu(null) : togglePlay())}
        onDoubleClick={toggleFullscreen}
        onPlay={() => {
          setPlaying(true);
          setStarted(true);
          setEnded(false);
          poke();
        }}
        onPause={(e) => {
          setPlaying(false);
          saveResume(videoId, e.currentTarget.currentTime, e.currentTarget.duration);
        }}
        onEnded={(e) => {
          setPlaying(false);
          setEnded(true);
          saveResume(videoId, e.currentTarget.duration, e.currentTarget.duration);
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setTime(v.currentTime);
          setStoreTime(v.currentTime);
          if (Math.abs(v.currentTime - lastSaved.current) >= RESUME_EVERY_S) {
            lastSaved.current = v.currentTime;
            saveResume(videoId, v.currentTime, v.duration);
          }
        }}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration)) setDuration(e.currentTarget.duration);
        }}
        onProgress={(e) => {
          const v = e.currentTarget;
          const b = v.buffered;
          for (let i = 0; i < b.length; i++) {
            if (b.start(i) <= v.currentTime + 0.5 && b.end(i) >= v.currentTime) return setBuffered(b.end(i));
          }
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
          saveVolume(e.currentTarget.volume, e.currentTarget.muted);
        }}
        onRateChange={(e) => setRate(e.currentTarget.playbackRate)}
      />

      {!src && !error && (
        <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/70 to-transparent p-4 text-[13px] text-[#eeeeee]">
          Preview without media. Set MEDIA_PUBLIC_URL to play the sample clip.
        </div>
      )}

      {error && (
        <div className="absolute inset-0 grid place-items-center bg-black p-6 text-center text-[16px]">{error}</div>
      )}

      {resumed && !error && (
        <div
          role="status"
          data-resumed
          className="pointer-events-none absolute left-3 top-3 rounded-sm bg-black/80 px-3 py-1.5 text-[13px] font-medium text-white"
        >
          Resumed
        </div>
      )}

      {note && !error && (
        <div
          aria-hidden
          data-player-note
          className="pointer-events-none absolute left-1/2 top-[12%] -translate-x-1/2 rounded-sm bg-black/70 px-4 py-2 text-[15px] font-medium text-white"
        >
          {note}
        </div>
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {note ?? ""}
      </div>

      {waiting && playing && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      )}

      {/* The big play button, while paused. */}
      {!playing && !error && !scrubbing && (
        <button
          type="button"
          aria-label={ended ? "Replay" : "Play"}
          data-big-play
          onClick={togglePlay}
          disabled={!src}
          className="group/big absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 disabled:cursor-default"
        >
          {/* A round button in the brand green (lib/brand.ts), our own shape. */}
          <svg viewBox="0 0 64 64" className="h-full w-full drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]" aria-hidden>
            <circle
              cx="32"
              cy="32"
              r="30"
              className={`transition-colors ${started ? "fill-[#212121] opacity-80 group-hover/big:fill-[var(--mark)] group-hover/big:opacity-100" : "fill-[var(--mark)]"}`}
            />
            {ended ? (
              <path d="M32 21v-5l-6.5 6.5L32 29v-5c4.14 0 7.5 3.36 7.5 7.5S36.14 39 32 39s-7.5-3.36-7.5-7.5h-3c0 5.8 4.7 10.5 10.5 10.5S42.5 37.3 42.5 31.5 37.8 21 32 21z" fill="#fff" />
            ) : (
              <path d="M26 20.5v23L44 32z" fill="#fff" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      )}

      {/* The bottom chrome. */}
      <div
        className={`absolute inset-x-0 bottom-0 transition-opacity duration-200 ${
          showChrome ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[98px] bg-gradient-to-t from-black/70 via-black/25 to-transparent" />

        {/* Hover preview: the sprite frame and the time. */}
        {hover && (
          <div
            data-hover-preview
            className="pointer-events-none absolute bottom-[52px] z-10 flex -translate-x-1/2 flex-col items-center"
            style={{ left: 12 + tipLeft }}
          >
            {sprite && <div data-sprite-frame className="box-content border-2 border-white bg-black bg-no-repeat" style={sprite} />}
            <span className="mt-1 text-[13px] font-medium [text-shadow:0_0_4px_rgba(0,0,0,.75)]">
              {formatTime(hover.t)}
            </span>
          </div>
        )}

        {/* The progress bar: a 3 px line that grows to 5 px under the mouse. */}
        <div
          ref={barRef}
          role="slider"
          aria-label="Seek slider"
          aria-valuemin={0}
          aria-valuemax={Math.floor(duration)}
          aria-valuenow={Math.floor(time)}
          aria-valuetext={`${formatTime(time)} of ${formatTime(duration)}`}
          tabIndex={-1}
          data-progress
          onPointerMove={onBarMove}
          onPointerLeave={() => !scrubbing && setHover(null)}
          onPointerDown={onBarDown}
          onPointerUp={onBarUp}
          className="group/bar absolute inset-x-3 bottom-9 h-[17px] cursor-pointer touch-none"
        >
          <div
            className={`absolute inset-x-0 bottom-[7px] h-[3px] origin-bottom bg-white/20 transition-transform group-hover/bar:scale-y-[1.67] ${
              scrubbing ? "scale-y-[1.67]" : ""
            }`}
          >
            <div className="absolute inset-y-0 left-0 bg-white/40" style={{ width: pct(buffered) }} />
            {hover && <div className="absolute inset-y-0 left-0 bg-white/50" style={{ width: pct(hover.t) }} />}
            <div className="absolute inset-y-0 left-0 bg-[var(--mark)]" style={{ width: pct(time) }} />
          </div>
          <div
            className={`absolute bottom-[3px] h-[13px] w-[13px] -translate-x-1/2 rounded-full bg-[var(--mark)] transition-transform ${
              scrubbing ? "scale-100" : "scale-0 group-hover/bar:scale-100"
            }`}
            style={{ left: pct(time) }}
          />
        </div>

        {/* The bottom bar. */}
        <div className="relative flex h-9 items-center px-3 text-[#eeeeee]">
          <CtrlButton label={playing ? "Pause (k)" : ended ? "Replay" : "Play (k)"} onClick={togglePlay} data-play>
            {playing ? <PauseIcon className="h-7 w-7" /> : ended ? <ReplayIcon className="h-6 w-6" /> : <PlayIcon className="h-7 w-7" />}
          </CtrlButton>

          <div className="group/vol flex items-center">
            <CtrlButton
              label={muted ? "Unmute (m)" : "Mute (m)"}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.muted = !v.muted;
              }}
              data-mute
            >
              <VolumeIcon className="h-6 w-6" />
            </CtrlButton>
            <div
              className={`overflow-hidden transition-[width] duration-200 group-hover/vol:w-[60px] group-focus-within/vol:w-[60px] ${
                volumeDrag ? "w-[60px]" : "w-0"
              }`}
            >
              <div
                ref={volumeRef}
                role="slider"
                aria-label="Volume"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(shownVolume * 100)}
                tabIndex={0}
                data-volume
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setVolumeDrag(true);
                  setVolumeAt(e.clientX);
                }}
                onPointerMove={(e) => volumeDrag && setVolumeAt(e.clientX)}
                onPointerUp={() => setVolumeDrag(false)}
                className="relative mx-1.5 h-9 w-[52px] cursor-pointer touch-none"
              >
                <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 bg-white/20">
                  <div className="h-full bg-white" style={{ width: `${shownVolume * 100}%` }} />
                </div>
                <div
                  className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
                  style={{ left: `${shownVolume * 100}%` }}
                />
              </div>
            </div>
          </div>

          <span data-time className="whitespace-nowrap px-2 text-[13px] leading-9 [text-shadow:0_0_2px_rgba(0,0,0,.5)]">
            {formatTime(time)} / {formatTime(duration)}
          </span>

          <div className="ml-auto flex items-center">
            <div className="relative">
              <CtrlButton
                ref={gearRef}
                label="Settings"
                onClick={() => setMenu(menu ? null : "main")}
                data-settings
                aria-expanded={menu !== null}
              >
                <SettingsIcon className={`h-6 w-6 transition-transform duration-200 ${menu ? "rotate-[30deg]" : ""}`} />
                {hd && (
                  <span className="absolute right-[6px] top-[5px] rounded-[1px] bg-[var(--mark)] px-[2px] text-[8px] font-bold leading-[10px] text-white">
                    HD
                  </span>
                )}
              </CtrlButton>
            </div>
            {!embed && (
              <CtrlButton
                label={theater ? "Default view (t)" : "Theater mode (t)"}
                onClick={toggleTheater}
                className="max-[1015px]:hidden"
                data-theater
              >
                {theater ? <DefaultViewIcon className="h-6 w-6" /> : <TheaterIcon className="h-6 w-6" />}
              </CtrlButton>
            )}
            {pipOk && (
              <CtrlButton label="Picture in picture (i)" onClick={togglePip} data-pip>
                <PipIcon className="h-[22px] w-[22px]" />
              </CtrlButton>
            )}
            <CtrlButton label={fullscreen ? "Exit full screen (f)" : "Full screen (f)"} onClick={toggleFullscreen} data-fullscreen>
              {fullscreen ? <FullscreenExitIcon className="h-7 w-7" /> : <FullscreenIcon className="h-7 w-7" />}
            </CtrlButton>
          </div>
        </div>
      </div>

      {/* The settings menu. */}
      {menu && (
        <div
          ref={menuRef}
          role="menu"
          data-settings-menu={menu}
          className="absolute bottom-[49px] right-3 z-20 min-w-[251px] rounded-[2px] bg-[rgba(28,28,28,0.9)] py-2 text-[13px] font-medium text-[#eeeeee] [text-shadow:0_0_2px_rgba(0,0,0,.5)]"
        >
          {menu === "main" && (
            <>
              <MenuRow onClick={() => setMenu("speed")} label="Playback speed" value={speedLabel(rate)} />
              <MenuRow onClick={() => setMenu("quality")} label="Quality" value={summary} />
            </>
          )}
          {menu === "speed" && (
            <>
              <MenuBack onClick={() => setMenu("main")} label="Playback speed" />
              <div className="max-h-[260px] overflow-y-auto">
                {SPEEDS.map((r) => (
                  <MenuChoice key={r} checked={rate === r} onClick={() => pickSpeed(r)}>
                    {speedLabel(r)}
                  </MenuChoice>
                ))}
              </div>
            </>
          )}
          {menu === "quality" && (
            <>
              <MenuBack onClick={() => setMenu("main")} label="Quality" />
              {options.map((o) => (
                <MenuChoice key={o.level} checked={chosen === o.level} onClick={() => pickQuality(o)} data-quality-option={o.label}>
                  {o.level === AUTO && chosen === AUTO && playingOpt ? `Auto (${playingOpt.label})` : o.label}
                  {o.hd && <sup className="ml-0.5 text-[9px] font-bold text-[var(--mark)]">HD</sup>}
                </MenuChoice>
              ))}
              {native && <p className="px-4 pb-1 pt-2 text-[12px] font-normal text-[#aaaaaa]">Safari picks the quality itself.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CtrlButton({
  label,
  children,
  className = "",
  ref,
  ...rest
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
  ref?: React.Ref<HTMLButtonElement>;
  onClick?: () => void;
  "aria-expanded"?: boolean;
} & Record<`data-${string}`, unknown>) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={`relative grid h-9 w-[46px] shrink-0 place-items-center opacity-90 hover:opacity-100 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

function MenuRow({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} className="flex h-10 w-full items-center px-4 hover:bg-white/10">
      <span className="mr-6 flex-1 text-left">{label}</span>
      <span className="text-right font-normal">{value}</span>
      <ChevronRightIcon className="-mr-1.5 ml-1 h-5 w-5" />
    </button>
  );
}

function MenuBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mb-2 flex h-12 w-full items-center border-b border-white/20 px-2 text-[15px] hover:bg-white/10"
    >
      <ChevronLeftIcon className="mr-2 h-6 w-6" />
      {label}
    </button>
  );
}

function MenuChoice({
  checked,
  onClick,
  children,
  ...rest
}: { checked: boolean; onClick: () => void; children: React.ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={checked}
      onClick={onClick}
      className="flex h-10 w-full items-center pl-2 pr-6 hover:bg-white/10"
      {...rest}
    >
      <span className="grid w-8 place-items-center">{checked && <CheckIcon className="h-5 w-5" />}</span>
      <span>{children}</span>
    </button>
  );
}
