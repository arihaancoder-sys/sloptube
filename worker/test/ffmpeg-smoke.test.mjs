// Encodes a real 3 second test clip (ffmpeg's lavfi testsrc) with the same
// argument builders the worker uses, and checks what comes out.
// Skips with a message when ffmpeg is not installed (it is in the encoder image).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { buildEncodeArgs, buildThumbnailArgs, createProgressParser, thumbnailName } from "../lib/ffmpeg.mjs";
import { pickRenditions } from "../lib/ladder.mjs";
import { buildProbeArgs, parseProbe } from "../lib/probe.mjs";
import { run } from "../lib/run.mjs";
import { buildVtt, spritePlan } from "../lib/sprite.mjs";

const has = (cmd) => spawnSync(cmd, ["-version"], { stdio: "ignore" }).status === 0;
const skip = has("ffmpeg") && has("ffprobe") ? false : "ffmpeg or ffprobe is not installed, skipping the real encode";
if (skip) console.log(skip);

test("a 3 s generated clip becomes 360p HLS with thumbnails and a sprite", { skip, timeout: 120000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), "sloptube-ffmpeg-smoke-"));
  try {
    const input = join(dir, "source.mp4");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", input,
    ]);

    const probe = parseProbe(await run("ffprobe", buildProbeArgs(input)));
    assert.ok(Math.abs(probe.durationS - 3) < 0.2, `duration ${probe.durationS}`);
    assert.equal(probe.hasAudio, true);

    const renditions = pickRenditions(probe);
    assert.deepEqual(renditions.map((r) => r.name), ["360p"]);
    const sprite = spritePlan(probe.durationS);

    const out = join(dir, "out");
    await mkdir(out);
    const times = [];
    let ended = false;
    await run("ffmpeg", buildEncodeArgs({ input, renditions, hasAudio: true, sprite, preset: "ultrafast" }), {
      cwd: out,
      onStdout: createProgressParser((s) => times.push(s), () => (ended = true)),
    });
    assert.ok(ended, "ffmpeg never wrote progress=end");
    assert.ok(times.length > 0 && Math.max(...times) > 2, `progress times ${times}`);

    for (const i of [0, 1, 2]) {
      await run("ffmpeg", buildThumbnailArgs({ input, atSeconds: probe.durationS * [0.1, 0.5, 0.9][i], output: join(out, thumbnailName(i)) }));
    }
    await writeFile(join(out, "sprite.vtt"), buildVtt(sprite, probe.durationS));

    const master = await readFile(join(out, "master.m3u8"), "utf8");
    assert.match(master, /#EXT-X-STREAM-INF:.*RESOLUTION=640x360/);
    assert.match(master, /360p\/index\.m3u8/);
    const playlist = await readFile(join(out, "360p", "index.m3u8"), "utf8");
    // ffmpeg names the init segment init.mp4 for one variant and init_<n>.mp4 for several.
    const init = /#EXT-X-MAP:URI="(init(?:_\d+)?\.mp4)"/.exec(playlist)?.[1];
    assert.ok(init, `no init segment in\n${playlist}`);
    assert.ok(Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(playlist)?.[1]) <= 4);
    assert.match(playlist, /#EXT-X-ENDLIST/);
    const files = await readdir(join(out, "360p"));
    assert.ok(files.includes(init));
    assert.ok(files.filter((f) => f.endsWith(".m4s")).length >= 1);

    const size = async (file) => {
      const p = parseProbe({ format: { duration: "1" }, streams: JSON.parse(await run("ffprobe", buildProbeArgs(file))).streams });
      return `${p.width}x${p.height}`;
    };
    assert.equal(await size(join(out, "sprite.webp")), "160x90");
    // 1280 wide, but never wider than the 640 wide source.
    assert.equal(await size(join(out, "thumb-1.webp")), "640x360");
    assert.equal(await size(join(out, "thumb-3.webp")), "640x360");
    assert.match(await readFile(join(out, "sprite.vtt"), "utf8"), /^WEBVTT\n\n00:00:00\.000 --> 00:00:03\.0\d\d\nsprite\.webp#xywh=0,0,160,90\n/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
