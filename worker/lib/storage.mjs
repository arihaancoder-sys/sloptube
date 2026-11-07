// R2 through its S3 API: read the source, write the HLS files, empty the
// folders of purged videos.
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

/** An S3 client pointed at the account's R2 endpoint (same settings as lib/upload/r2.ts in the app). */
export function createR2Client({ accountId, accessKeyId, secretAccessKey }) {
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

const TYPES = {
  m3u8: "application/vnd.apple.mpegurl",
  m4s: "video/iso.segment",
  mp4: "video/mp4",
  webp: "image/webp",
  vtt: "text/vtt; charset=utf-8",
};

export function contentTypeFor(name) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

/** Everything under hls/<video>/ is written once per encode. Playlists can change on a re-encode, segments cannot. */
export function cacheControlFor(name) {
  return /\.(m4s|mp4)$/.test(name) ? "public, max-age=31536000, immutable" : "public, max-age=300";
}

/** The R2 folder for a video's encoded files. */
export function hlsPrefix(videoId) {
  return `hls/${videoId}`;
}

/** Every file below dir, as paths relative to it with forward slashes, sorted. */
export async function listFiles(dir) {
  const out = [];
  const walk = async (d) => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  await walk(dir);
  return out.sort();
}

function isNotFound(err) {
  return err?.$metadata?.httpStatusCode === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey";
}

/** The storage the job needs, on top of an S3 client and one bucket. */
export function createStorage(client, bucket) {
  return {
    /** The object's size in bytes, or null when it does not exist. */
    async headSize(key, signal) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
        return typeof out.ContentLength === "number" ? out.ContentLength : null;
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async download(key, path, signal) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }), { abortSignal: signal });
      if (!out.Body) throw new Error("R2 sent no body");
      await pipeline(out.Body, createWriteStream(path), { signal });
    },

    async upload(key, path, signal) {
      const { size } = await stat(path);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: createReadStream(path),
          ContentLength: size,
          ContentType: contentTypeFor(key),
          CacheControl: cacheControlFor(key),
        }),
        { abortSignal: signal },
      );
      return size;
    },

    /** Uploads every file in dir under prefix/, a few at a time. Returns the count and bytes. */
    async uploadDir(dir, prefix, { signal, concurrency = 8, onFile = () => {} } = {}) {
      const files = await listFiles(dir);
      let next = 0;
      let bytes = 0;
      let done = 0;
      const one = async () => {
        while (next < files.length) {
          signal?.throwIfAborted();
          const name = files[next++];
          bytes += await this.upload(`${prefix}/${name}`, join(dir, name), signal);
          onFile(++done, files.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, one));
      return { files: files.length, bytes };
    },

    /** Deletes every object under prefix, a page of up to 1000 at a time. Returns how many. */
    async deletePrefix(prefix, signal) {
      let deleted = 0;
      for (let round = 0; round < 1000; round++) {
        signal?.throwIfAborted();
        // Always the first page: what was deleted is gone, so the next page is the rest.
        const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }), { abortSignal: signal });
        const keys = (page.Contents ?? []).map((o) => o.Key).filter((k) => typeof k === "string" && k.startsWith(prefix));
        if (keys.length === 0) return deleted;
        const out = await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true } }),
          { abortSignal: signal },
        );
        if (out.Errors?.length) throw new Error(`R2 kept ${out.Errors.length} objects: ${out.Errors[0].Message ?? out.Errors[0].Code}`);
        deleted += keys.length;
      }
      throw new Error("too many objects under the prefix");
    },
  };
}
