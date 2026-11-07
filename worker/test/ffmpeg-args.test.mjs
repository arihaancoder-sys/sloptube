// The ffmpeg and ffprobe command lines, snapshotted, and the -progress parser.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEncodeArgs,
  buildThumbnailArgs,
  createProgressParser,
  encodePercent,
} from "../lib/ffmpeg.mjs";
import { pickRenditions } from "../lib/ladder.mjs";
import { buildProbeArgs, parseProbe } from "../lib/probe.mjs";
import { spritePlan } from "../lib/sprite.mjs";

// The full command for a 12 s 720p source with sound. If you change the
// encode on purpose, update this snapshot in the same commit.
const SNAPSHOT_720P = [
  "-hide_banner", "-nostdin", "-y", "-loglevel", "error", "-nostats", "-progress", "pipe:1",
  "-i", "/work/job/source.mp4",
  "-filter_complex",
  "[0:v]split=3[s0][s1][sp];" +
    "[s0]scale=640:360:flags=bicubic,setsar=1,format=yuv420p[v0];" +
    "[s1]scale=1280:720:flags=bicubic,setsar=1,format=yuv420p[v1];" +
    "[sp]fps=1/5,scale=160:90:force_original_aspect_ratio=decrease,pad=160:90:(ow-iw)/2:(oh-ih)/2,setsar=1,tile=3x1[spr]",
  "-map", "[v0]", "-map", "0:a:0",
  "-map", "[v1]", "-map", "0:a:0",
  "-c:v", "libx264", "-preset", "veryfast", "-profile:v", "high",
  "-sc_threshold", "0", "-force_key_frames", "expr:gte(t,n_forced*4)",
  "-b:v:0", "800k", "-maxrate:v:0", "856k", "-bufsize:v:0", "1200k",
  "-b:v:1", "2800k", "-maxrate:v:1", "2996k", "-bufsize:v:1", "4200k",
  "-c:a", "aac", "-ac", "2", "-ar", "48000",
  "-b:a:0", "96k", "-b:a:1", "128k",
  "-f", "hls", "-hls_time", "4", "-hls_playlist_type", "vod",
  "-hls_segment_type", "fmp4", "-hls_flags", "independent_segments",
  "-hls_fmp4_init_filename", "init.mp4",
  "-hls_segment_filename", "%v/seg_%05d.m4s",
  "-master_pl_name", "master.m3u8",
  "-var_stream_map", "v:0,a:0,name:360p v:1,a:1,name:720p",
  "%v/index.m3u8",
  "-map", "[spr]", "-frames:v", "1", "-c:v", "libwebp", "-quality", "70", "sprite.webp",
];

test("encode args for a 720p source with sound (snapshot)", () => {
  const args = buildEncodeArgs({
    input: "/work/job/source.mp4",
    renditions: pickRenditions({ width: 1280, height: 720 }),
    hasAudio: true,
    sprite: spritePlan(12),
  });
  assert.deepEqual(args, SNAPSHOT_720P);
});

test("without sound there are no audio maps or codecs", () => {
  const args = buildEncodeArgs({
    input: "in.mov",
    renditions: pickRenditions({ width: 1920, height: 1080 }),
    hasAudio: false,
    sprite: null,
  });
  assert.ok(!args.includes("0:a:0"));
  assert.ok(!args.includes("-c:a"));
  assert.equal(args[args.indexOf("-var_stream_map") + 1], "v:0,name:360p v:1,name:720p v:2,name:1080p");
  assert.equal(args[args.indexOf("-filter_complex") + 1].split(";")[0], "[0:v]split=3[s0][s1][s2]");
  assert.equal(args.at(-1), "%v/index.m3u8");
});

test("no renditions is a bug, not an empty encode", () => {
  assert.throws(() => buildEncodeArgs({ input: "x", renditions: [], hasAudio: true }), /no renditions/);
});

test("thumbnail args (snapshot)", () => {
  assert.deepEqual(buildThumbnailArgs({ input: "/w/source.mp4", atSeconds: 1.2, output: "/w/out/thumb-1.webp" }), [
    "-hide_banner", "-nostdin", "-y", "-loglevel", "error",
    "-ss", "1.200", "-i", "/w/source.mp4", "-frames:v", "1",
    "-vf", "scale='min(1280,iw)':-2,setsar=1",
    "-c:v", "libwebp", "-quality", "80", "/w/out/thumb-1.webp",
  ]);
});

test("the progress parser reads out_time_us across chunk borders", () => {
  const times = [];
  let ended = false;
  const feed = createProgressParser((s) => times.push(s), () => (ended = true));
  feed("frame=10\nout_time_us=1500");
  feed("000\nspeed=2x\nprogress=continue\nout_time_ms=3000000\n");
  feed("out_time_us=N/A\nprogress=end\n");
  assert.deepEqual(times, [1.5, 3]);
  assert.equal(ended, true);
});

test("encode percent stays inside the encode share of the bar", () => {
  assert.equal(encodePercent(0, 100), 5);
  assert.equal(encodePercent(50, 100), 47);
  assert.equal(encodePercent(100, 100), 90);
  assert.equal(encodePercent(500, 100), 90);
  assert.equal(encodePercent(10, 0), 5);
});

test("ffprobe args and parsing", () => {
  assert.deepEqual(buildProbeArgs("s.mp4"), ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", "s.mp4"]);
  const probe = parseProbe({
    format: { duration: "62.500000" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30000/1001",
        side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }] },
      { codec_type: "audio", codec_name: "aac" },
    ],
  });
  assert.equal(probe.durationS, 62.5);
  assert.equal(probe.rotation, -90);
  assert.equal(probe.hasAudio, true);
  assert.equal(Math.round(probe.fps * 100), 2997);
  assert.throws(() => parseProbe({ format: {}, streams: [{ codec_type: "audio" }] }), /no video stream/);
  assert.throws(() => parseProbe({ format: {}, streams: [{ codec_type: "video", width: 2, height: 2 }] }), /no duration/);
  // Cover art in an audio file is not a video.
  assert.throws(
    () => parseProbe({ format: { duration: "3" }, streams: [{ codec_type: "video", disposition: { attached_pic: 1 } }] }),
    /no video stream/,
  );
});
