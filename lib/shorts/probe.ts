"use client";

import type { ShortShape } from "./rules";

/** Give up on reading the file after this long. */
const PROBE_MS = 8000;

/**
 * The width, height and length of a picked file, read by the browser from
 * the file's header (nothing is uploaded for it). Browsers report the size
 * as shown, so phone videos filmed upright read as vertical. null when the
 * browser cannot read the format (MKV in some browsers) or takes too long.
 */
export function probeVideoFile(file: File): Promise<ShortShape | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined") return resolve(null);
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (shape: ShortShape | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(shape);
    };
    const timer = setTimeout(() => finish(null), PROBE_MS);
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      finish(
        video.videoWidth > 0 && Number.isFinite(video.duration)
          ? { width: video.videoWidth, height: video.videoHeight, durationS: video.duration }
          : null,
      );
    video.onerror = () => finish(null);
    video.src = url;
  });
}
