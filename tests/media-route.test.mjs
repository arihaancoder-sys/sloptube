// The media route end to end with the S3 client's send() mocked, and the
// playlist rewriting it does. Presigning is real (it needs no network).
import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMediaPath, playbackUrls, readPublicBase, serveMedia } from "../lib/watch/media.ts";
import { resolveEntry, rewritePlaylist } from "../lib/watch/playlist.ts";
import { createMediaStorage } from "../lib/watch/r2.ts";
import { createR2Client } from "../lib/upload/r2.ts";

const PUBLIC = "aaaaaaaa-0000-4000-8000-000000000001";
const UNLISTED = "aaaaaaaa-0000-4000-8000-000000000002";
const PRIVATE = "aaaaaaaa-0000-4000-8000-000000000003";
const PROCESSING = "aaaaaaaa-0000-4000-8000-000000000004";
const MISSING = "aaaaaaaa-0000-4000-8000-0000000000ff";

const MASTER = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-INDEPENDENT-SEGMENTS",
  '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"',
  "360p/index.m3u8",
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"',
  "720p/index.m3u8",
  "",
].join("\n");

const MEDIA = [
  "#EXTM3U",
  "#EXT-X-VERSION:7",
  "#EXT-X-TARGETDURATION:4",
  "#EXT-X-PLAYLIST-TYPE:VOD",
  '#EXT-X-MAP:URI="init.mp4"',
  "#EXTINF:4.000000,",
  "seg_00000.m4s",
  "#EXTINF:1.000000,",
  "seg_00001.m4s",
  "#EXT-X-ENDLIST",
  "",
].join("\n");

/**
 * The fake database answers like watch_video(): public and unlisted rows for
 * everybody (playback fields only when ready), private rows for the owner.
 */
function setup({ owner = false, db = true, flag = true, storage = true } = {}) {
  const rows = {
    [PUBLIC]: { visibility: "public", status: "ready" },
    [UNLISTED]: { visibility: "unlisted", status: "ready" },
    [PRIVATE]: { visibility: "private", status: "ready" },
    [PROCESSING]: { visibility: "public", status: "processing" },
  };
  const client = createR2Client({ accountId: "example", accessKeyId: "test-key-id", secretAccessKey: "test-secret" });
  const calls = [];
  client.send = async (command) => {
    const name = command.constructor.name;
    calls.push({ name, key: command.input.Key });
    if (name !== "GetObjectCommand") throw new Error("unexpected " + name);
    const key = command.input.Key;
    const body = key.endsWith("/master.m3u8") ? MASTER : key.endsWith("/720p/index.m3u8") ? MEDIA : key.endsWith(".vtt") ? "WEBVTT\n" : null;
    if (body === null) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey", $metadata: { httpStatusCode: 404 } });
    return { ContentLength: body.length, Body: { transformToString: async () => body } };
  };
  const ctx = {
    db: db
      ? {
          async watchVideo(id) {
            const r = rows[id];
            if (!r) return null;
            if (r.visibility === "private" && !owner) return null;
            const playable = r.status === "ready" || owner;
            return { status: r.status, is_owner: owner, hls_key: playable ? `hls/${id}/master.m3u8` : null };
          },
        }
      : null,
    flagOn: async () => flag,
    storage: storage ? createMediaStorage(client, "videos-test") : null,
  };
  return { ctx, calls };
}

const body = (r) => (r.body ? JSON.parse(r.body) : null);

test("media: no database, flag off, bad ids and paths come first", async () => {
  assert.equal((await serveMedia(PUBLIC, ["master.m3u8"], setup({ db: false }).ctx)).status, 503);
  const off = await serveMedia(PUBLIC, ["master.m3u8"], setup({ flag: false }).ctx);
  assert.deepEqual([off.status, body(off)], [403, { error: "watch_off" }]);
  assert.equal((await serveMedia("not-a-uuid", ["master.m3u8"], setup().ctx)).status, 404);
  for (const bad of [[], ["..", "master.m3u8"], ["source.mp4x"], ["a", "b", "c", "d.m4s"], [".hidden.m3u8"], ["x.exe"]]) {
    assert.equal((await serveMedia(PUBLIC, bad, setup().ctx)).status, 404, bad.join("/"));
  }
});

test("media: public video, the master playlist is proxied and rewritten", async () => {
  const { ctx, calls } = setup();
  const r = await serveMedia(PUBLIC.toUpperCase(), ["master.m3u8"], ctx);
  assert.equal(r.status, 200);
  assert.equal(r.headers["content-type"], "application/vnd.apple.mpegurl");
  assert.equal(r.headers["cache-control"], "private, max-age=60");
  assert.deepEqual(calls, [{ name: "GetObjectCommand", key: `hls/${PUBLIC}/master.m3u8` }]);
  assert.match(r.body, new RegExp(`^/api/media/${PUBLIC}/360p/index\\.m3u8$`, "m"));
  assert.match(r.body, new RegExp(`^/api/media/${PUBLIC}/720p/index\\.m3u8$`, "m"));
  assert.match(r.body, /CODECS="avc1\.64001e,mp4a\.40\.2"/);
});

test("media: the rendition playlist points init and segments back at the route", async () => {
  const r = await serveMedia(PUBLIC, ["720p", "index.m3u8"], setup().ctx);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`#EXT-X-MAP:URI="/api/media/${PUBLIC}/720p/init\\.mp4"`));
  assert.match(r.body, new RegExp(`^/api/media/${PUBLIC}/720p/seg_00001\\.m4s$`, "m"));
  assert.match(r.body, /#EXT-X-ENDLIST/);
});

test("media: segments redirect to a presigned R2 link for 10 minutes", async () => {
  const { ctx, calls } = setup();
  const r = await serveMedia(UNLISTED, ["720p", "seg_00001.m4s"], ctx);
  assert.equal(r.status, 302);
  const url = new URL(r.headers.location);
  assert.equal(url.host, "example.r2.cloudflarestorage.com");
  assert.equal(url.pathname, `/videos-test/hls/${UNLISTED}/720p/seg_00001.m4s`);
  assert.equal(url.searchParams.get("X-Amz-Expires"), "600");
  assert.ok(url.searchParams.get("X-Amz-Signature"));
  assert.equal(r.headers["cache-control"], "private, max-age=300");
  assert.equal(calls.length, 0, "presigning makes no request");
});

test("media: private video is a 404 for others and plays for the owner, never cached", async () => {
  assert.equal((await serveMedia(PRIVATE, ["master.m3u8"], setup().ctx)).status, 404);
  const r = await serveMedia(PRIVATE, ["720p", "init.mp4"], setup({ owner: true }).ctx);
  assert.equal(r.status, 302);
  assert.equal(r.headers["cache-control"], "private, no-store");
  const m = await serveMedia(PRIVATE, ["master.m3u8"], setup({ owner: true }).ctx);
  assert.equal(m.status, 200);
  assert.equal(m.headers["cache-control"], "private, no-store");
});

test("media: not ready is a 404 for others; missing videos and files are 404", async () => {
  assert.equal((await serveMedia(PROCESSING, ["master.m3u8"], setup().ctx)).status, 404);
  assert.equal((await serveMedia(MISSING, ["master.m3u8"], setup().ctx)).status, 404);
  const gone = await serveMedia(PUBLIC, ["1080p", "index.m3u8"], setup().ctx);
  assert.deepEqual([gone.status, body(gone)], [404, { error: "not_found" }]);
});

test("media: the sprite vtt is proxied as text, images redirect", async () => {
  const vtt = await serveMedia(PUBLIC, ["sprite.vtt"], setup().ctx);
  assert.equal(vtt.status, 200);
  assert.equal(vtt.headers["content-type"], "text/vtt; charset=utf-8");
  assert.equal((await serveMedia(PUBLIC, ["sprite.webp"], setup().ctx)).status, 302);
  assert.equal((await serveMedia(PUBLIC, ["thumb-1.webp"], setup().ctx)).status, 302);
});

test("media: without R2 settings the route says so", async () => {
  const r = await serveMedia(PUBLIC, ["master.m3u8"], setup({ storage: false }).ctx);
  assert.deepEqual([r.status, body(r)], [503, { error: "media_not_configured" }]);
});

test("media: an R2 error is a 502, not a crash", async () => {
  const { ctx } = setup();
  ctx.storage.getText = async () => {
    throw new Error("boom");
  };
  assert.equal((await serveMedia(PUBLIC, ["master.m3u8"], ctx)).status, 502);
});

test("playlist rewriting: relative entries resolve like a browser, the rest stays", () => {
  assert.equal(resolveEntry("seg_00001.m4s", "720p/index.m3u8"), "720p/seg_00001.m4s");
  assert.equal(resolveEntry("../360p/index.m3u8", "720p/index.m3u8"), "360p/index.m3u8");
  assert.equal(resolveEntry("720p/index.m3u8", "master.m3u8"), "720p/index.m3u8");
  assert.equal(resolveEntry("seg.m4s?x=1", "720p/index.m3u8"), "720p/seg.m4s");
  assert.equal(resolveEntry("../../../etc/passwd", "720p/index.m3u8"), null);
  assert.equal(resolveEntry("https://cdn.example.com/a.m4s", "master.m3u8"), null);
  assert.equal(resolveEntry("/abs/a.m4s", "master.m3u8"), null);
  assert.equal(resolveEntry("", "master.m3u8"), null);

  const out = rewritePlaylist(
    ['#EXTM3U', '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="audio/index.m3u8"', "#EXTINF:4,", "https://cdn.example.com/x.m4s", "", "seg 1.m4s"].join("\r\n"),
    "720p/index.m3u8",
    "/api/media/v1",
  );
  assert.deepEqual(out.split("\n"), [
    "#EXTM3U",
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",URI="/api/media/v1/720p/audio/index.m3u8"',
    "#EXTINF:4,",
    "https://cdn.example.com/x.m4s",
    "",
    "/api/media/v1/720p/seg%201.m4s",
  ]);
});

test("paths the route serves", () => {
  assert.deepEqual(cleanMediaPath(["720p", "seg_00001.m4s"]), { path: "720p/seg_00001.m4s", ext: "m4s" });
  assert.deepEqual(cleanMediaPath(["master.m3u8"]), { path: "master.m3u8", ext: "m3u8" });
  assert.equal(cleanMediaPath(["source.mp4.exe"]), null);
  assert.equal(cleanMediaPath(["a..b.m4s"]), null);
});

test("MEDIA_PUBLIC_URL bypasses the route", () => {
  assert.equal(readPublicBase(" https://media.example.com/ "), "https://media.example.com");
  assert.equal(readPublicBase("ftp://media.example.com"), null);
  assert.equal(readPublicBase("not a url"), null);
  assert.equal(readPublicBase(""), null);

  const direct = playbackUrls(PUBLIC, `hls/${PUBLIC}/master.m3u8`, `hls/${PUBLIC}/sprite.vtt`, "https://media.example.com");
  assert.equal(direct.src, `https://media.example.com/hls/${PUBLIC}/master.m3u8`);
  assert.equal(direct.spriteVtt, `https://media.example.com/hls/${PUBLIC}/sprite.vtt`);
  assert.equal(direct.thumbnail("thumb-1.webp"), `https://media.example.com/hls/${PUBLIC}/thumb-1.webp`);

  const routed = playbackUrls(PUBLIC, `hls/${PUBLIC}/master.m3u8`, `hls/${PUBLIC}/sprite.vtt`, null);
  assert.equal(routed.src, `/api/media/${PUBLIC}/master.m3u8`);
  assert.equal(routed.spriteVtt, `/api/media/${PUBLIC}/sprite.vtt`);
  assert.equal(routed.thumbnail("thumb-1.webp"), `/api/media/${PUBLIC}/thumb-1.webp`);
});
