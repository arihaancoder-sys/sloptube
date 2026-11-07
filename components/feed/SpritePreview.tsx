"use client";

import { useEffect, useRef, useState } from "react";
import { frameAt, PREVIEW_DELAY_MS, PREVIEW_STEP_MS, previewFrames, sheetSize, tileStyle } from "@/lib/feed/preview";
import { parseSpriteVtt, type SpriteCue } from "@/lib/watch/vtt";

// One fetch per sprite .vtt per page, shared by every card that shows it.
const cueCache = new Map<string, Promise<SpriteCue[]>>();

function loadCues(vtt: string): Promise<SpriteCue[]> {
  let p = cueCache.get(vtt);
  if (!p) {
    const url = new URL(vtt, window.location.href).toString();
    p = fetch(url)
      .then((r) => (r.ok ? r.text() : ""))
      .then((text) => parseSpriteVtt(text, url))
      .catch(() => []);
    cueCache.set(vtt, p);
  }
  return p;
}

/**
 * The hover preview over a card's thumbnail. After a second on the card it
 * loads the sprite's .vtt (a few KB) and steps through up to 10 frames of the
 * sprite image, looping, until the pointer leaves. No video is loaded.
 */
export function SpritePreview({ vtt }: { vtt: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [cue, setCue] = useState<{ cue: SpriteCue; index: number; sheet: { w: number; h: number } } | null>(null);

  useEffect(() => {
    const card = ref.current?.closest("[data-feed-card]");
    if (!card) return;
    let delay: ReturnType<typeof setTimeout> | undefined;
    let tick: ReturnType<typeof setInterval> | undefined;
    let active = false;

    const stop = () => {
      active = false;
      clearTimeout(delay);
      clearInterval(tick);
      setCue(null);
    };
    const start = () => {
      stop();
      active = true;
      delay = setTimeout(async () => {
        const cues = await loadCues(vtt);
        if (!active || cues.length === 0) return;
        const frames = previewFrames(cues.length);
        const sheet = sheetSize(cues);
        const began = performance.now();
        const show = () => {
          const index = frameAt(frames, performance.now() - began, PREVIEW_STEP_MS);
          if (index >= 0) setCue({ cue: cues[index], index, sheet });
        };
        show();
        tick = setInterval(show, PREVIEW_STEP_MS / 2);
      }, PREVIEW_DELAY_MS);
    };

    card.addEventListener("pointerenter", start);
    card.addEventListener("pointerleave", stop);
    return () => {
      card.removeEventListener("pointerenter", start);
      card.removeEventListener("pointerleave", stop);
      stop();
    };
  }, [vtt]);

  return (
    <span
      ref={ref}
      aria-hidden
      data-sprite-preview={cue ? "on" : "off"}
      data-preview-frame={cue?.index ?? -1}
      className="pointer-events-none absolute inset-0 bg-no-repeat"
      style={
        cue
          ? { backgroundImage: `url("${cue.cue.url}")`, ...tileStyle(cue.cue, cue.sheet) }
          : { display: "none" }
      }
    />
  );
}
