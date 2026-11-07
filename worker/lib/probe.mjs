// ffprobe: the arguments and what we read from its JSON. Pure functions.

export function buildProbeArgs(input) {
  return ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", input];
}

function rate(value) {
  if (typeof value !== "string") return null;
  const [n, d = "1"] = value.split("/");
  const r = Number(n) / Number(d);
  return Number.isFinite(r) && r > 0 ? r : null;
}

/**
 * The facts the encoder needs from `ffprobe -print_format json`.
 * Throws "no video stream" or "no duration" for files it cannot work with.
 */
export function parseProbe(json) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const streams = Array.isArray(data?.streams) ? data.streams : [];
  const video = streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!video) throw new Error("no video stream");
  const audio = streams.find((s) => s.codec_type === "audio");

  const sideRotation = (video.side_data_list ?? []).find((d) => typeof d.rotation === "number")?.rotation;
  const tagRotation = Number(video.tags?.rotate);
  const rotation = typeof sideRotation === "number" ? sideRotation : Number.isFinite(tagRotation) ? tagRotation : 0;

  const durationS = Number(data?.format?.duration ?? video.duration);
  if (!Number.isFinite(durationS) || durationS <= 0) throw new Error("no duration");

  return {
    durationS,
    width: Number(video.width) || 0,
    height: Number(video.height) || 0,
    rotation,
    fps: rate(video.avg_frame_rate) ?? rate(video.r_frame_rate) ?? 30,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name ?? null,
  };
}
