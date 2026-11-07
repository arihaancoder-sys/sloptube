// What the player remembers in this browser: volume, the last quality picked
// and where each video was left. Feature 9 moves the resume position to the
// server. Every read and write is wrapped: storage can be off or full.

const VOLUME_KEY = "sloptube.player.volume";
const QUALITY_KEY = "sloptube.player.quality";
const THEATER_KEY = "sloptube.player.theater";
const RESUME_KEY = "sloptube.player.resume";

/** How many videos keep a resume position. The oldest is dropped first. */
const RESUME_MAX = 50;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode or full: the player still works, it just forgets.
  }
}

export function loadVolume(): { volume: number; muted: boolean } {
  try {
    const v = JSON.parse(read(VOLUME_KEY) ?? "null");
    const volume = Number(v?.volume);
    return { volume: Number.isFinite(volume) ? Math.min(1, Math.max(0, volume)) : 1, muted: v?.muted === true };
  } catch {
    return { volume: 1, muted: false };
  }
}

export function saveVolume(volume: number, muted: boolean) {
  write(VOLUME_KEY, JSON.stringify({ volume: Math.round(volume * 100) / 100, muted }));
}

/** "720p" or "Auto", or null when nothing was picked yet. */
export function loadQuality(): string | null {
  return read(QUALITY_KEY);
}

export function saveQuality(label: string) {
  write(QUALITY_KEY, label);
}

export function loadTheater(): boolean {
  return read(THEATER_KEY) === "1";
}

export function saveTheater(on: boolean) {
  write(THEATER_KEY, on ? "1" : null);
}

type ResumeMap = Record<string, { t: number; at: number }>;

function readResume(): ResumeMap {
  try {
    const v = JSON.parse(read(RESUME_KEY) ?? "{}");
    return v && typeof v === "object" ? (v as ResumeMap) : {};
  } catch {
    return {};
  }
}

/** Where this video was left, in seconds, or 0. */
export function loadResume(videoId: string): number {
  const t = Number(readResume()[videoId]?.t);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

/**
 * Remembers the position, like YouTube: not in the first 5 seconds and not in
 * the last 10 (then the video starts from the top next time).
 */
export function saveResume(videoId: string, t: number, duration: number) {
  const map = readResume();
  const done = Number.isFinite(duration) && duration > 0 && t > duration - 10;
  if (t < 5 || done) delete map[videoId];
  else map[videoId] = { t: Math.floor(t), at: Date.now() };
  const kept = Object.entries(map)
    .sort((a, b) => b[1].at - a[1].at)
    .slice(0, RESUME_MAX);
  write(RESUME_KEY, kept.length ? JSON.stringify(Object.fromEntries(kept)) : null);
}
