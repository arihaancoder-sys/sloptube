// ffmpeg arguments and its -progress output. Pure functions, so the tests can
// snapshot the exact command line.
//
// Why fMP4 segments and not MPEG-TS: fMP4 (CMAF) has less overhead per
// segment, plays in hls.js and in Safari's native HLS, and the same files can
// be served as DASH later without encoding again. TS would only help very old
// players, which sloptube does not target.
//
// The encode runs with its working directory set to the job's output folder,
// so every output path here is relative and the arguments do not depend on
// where the temp folder is.
import { SEGMENT_SECONDS, THUMBNAIL_WIDTH, X264_PRESET } from "./limits.mjs";

export const MASTER_PLAYLIST = "master.m3u8";
export const SPRITE_IMAGE = "sprite.webp";
export const SPRITE_VTT = "sprite.vtt";

/** Thumbnail file names: thumb-1.webp is the default one. */
export function thumbnailName(i) {
  return `thumb-${i + 1}.webp`;
}

/** The playlist of one rendition, relative to the master playlist. */
export function renditionPlaylist(r) {
  return `${r.name}/index.m3u8`;
}

/**
 * One ffmpeg run that decodes the source once, splits the picture into every
 * rendition plus the sprite, and writes the HLS ladder and sprite.webp.
 * @param {{
 *   input: string,
 *   renditions: { name: string, width: number, height: number, videoKbps: number, audioKbps: number }[],
 *   hasAudio: boolean,
 *   sprite?: { interval: number, columns: number, rows: number, width: number, height: number } | null,
 *   segmentSeconds?: number,
 *   preset?: string,
 * }} opts
 */
export function buildEncodeArgs({ input, renditions, hasAudio, sprite = null, segmentSeconds = SEGMENT_SECONDS, preset = X264_PRESET }) {
  if (!renditions.length) throw new Error("no renditions");
  const outs = renditions.map((_, i) => `[s${i}]`);
  if (sprite) outs.push("[sp]");

  const graph = [`[0:v]split=${outs.length}${outs.join("")}`];
  renditions.forEach((r, i) => {
    graph.push(`[s${i}]scale=${r.width}:${r.height}:flags=bicubic,setsar=1,format=yuv420p[v${i}]`);
  });
  if (sprite) {
    graph.push(
      `[sp]fps=1/${sprite.interval},` +
        `scale=${sprite.width}:${sprite.height}:force_original_aspect_ratio=decrease,` +
        `pad=${sprite.width}:${sprite.height}:(ow-iw)/2:(oh-ih)/2,setsar=1,` +
        `tile=${sprite.columns}x${sprite.rows}[spr]`,
    );
  }

  const args = ["-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1"];
  args.push("-i", input, "-filter_complex", graph.join(";"));

  renditions.forEach((_, i) => {
    args.push("-map", `[v${i}]`);
    if (hasAudio) args.push("-map", "0:a:0");
  });

  args.push(
    "-c:v", "libx264",
    "-preset", preset,
    "-profile:v", "high",
    "-sc_threshold", "0",
    "-force_key_frames", `expr:gte(t,n_forced*${segmentSeconds})`,
  );
  renditions.forEach((r, i) => {
    args.push(
      `-b:v:${i}`, `${r.videoKbps}k`,
      `-maxrate:v:${i}`, `${Math.round(r.videoKbps * 1.07)}k`,
      `-bufsize:v:${i}`, `${Math.round(r.videoKbps * 1.5)}k`,
    );
  });
  if (hasAudio) {
    args.push("-c:a", "aac", "-ac", "2", "-ar", "48000");
    renditions.forEach((r, i) => args.push(`-b:a:${i}`, `${r.audioKbps}k`));
  }

  const streamMap = renditions
    .map((r, i) => (hasAudio ? `v:${i},a:${i},name:${r.name}` : `v:${i},name:${r.name}`))
    .join(" ");
  args.push(
    "-f", "hls",
    "-hls_time", String(segmentSeconds),
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_fmp4_init_filename", "init.mp4",
    "-hls_segment_filename", "%v/seg_%05d.m4s",
    "-master_pl_name", MASTER_PLAYLIST,
    "-var_stream_map", streamMap,
    "%v/index.m3u8",
  );

  if (sprite) {
    args.push("-map", "[spr]", "-frames:v", "1", "-c:v", "libwebp", "-quality", "70", SPRITE_IMAGE);
  }
  return args;
}

/** One thumbnail: a fast seek, one frame, 1280 wide (never wider than the source), WebP. */
export function buildThumbnailArgs({ input, atSeconds, output, width = THUMBNAIL_WIDTH }) {
  return [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-ss", atSeconds.toFixed(3),
    "-i", input,
    "-frames:v", "1",
    "-vf", `scale='min(${width},iw)':-2,setsar=1`,
    "-c:v", "libwebp",
    "-quality", "80",
    output,
  ];
}

/**
 * Turns ffmpeg's `-progress pipe:1` stream into seconds encoded so far.
 * Feed it chunks as they arrive; it calls onTime(seconds) for each update
 * and onEnd() when ffmpeg writes progress=end.
 */
export function createProgressParser(onTime, onEnd = () => {}) {
  let carry = "";
  return (chunk) => {
    carry += String(chunk);
    const lines = carry.split("\n");
    carry = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.trim();
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq);
      const value = line.slice(eq + 1);
      // out_time_ms is in microseconds too (an old ffmpeg naming mistake).
      if (key === "out_time_us" || key === "out_time_ms") {
        const us = Number(value);
        if (Number.isFinite(us) && us >= 0) onTime(us / 1e6);
      } else if (key === "progress" && value === "end") {
        onEnd();
      }
    }
  };
}

/** The share of the job a step covers, so the studio bar moves once from 0 to 100. */
export const PROGRESS_STEPS = {
  downloaded: 3,
  encodeStart: 5,
  encodeEnd: 90,
  thumbnails: 92,
  uploadEnd: 99,
};

/** Whole percent for `seconds` encoded out of `durationS`, inside the encode share. */
export function encodePercent(seconds, durationS) {
  const { encodeStart, encodeEnd } = PROGRESS_STEPS;
  if (!(durationS > 0)) return encodeStart;
  const share = Math.min(1, Math.max(0, seconds / durationS));
  return Math.floor(encodeStart + share * (encodeEnd - encodeStart));
}
