// Uploads the parts of a file to their presigned URLs: a few at a time, each
// failed part tried again a few times. Works in the browser (XMLHttpRequest,
// for upload progress) and in the tests (a fake putPart).
// Only relative imports, so Node can load this file directly.

import { PARALLEL_PARTS, PART_RETRIES, planParts } from "./rules.ts";

export type SignedPart = { partNumber: number; url: string };
export type DonePart = { partNumber: number; etag: string };

/** Sends one part and resolves with its ETag. onLoaded reports bytes sent so far for this attempt. */
export type PutPart = (url: string, body: Blob, onLoaded: (loaded: number) => void, signal: AbortSignal) => Promise<string>;

export class UploadCancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "UploadCancelled";
  }
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new UploadCancelled());
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new UploadCancelled());
      },
      { once: true },
    );
  });

/**
 * Uploads every part and returns the ETags in part order.
 * onProgress gets the total bytes sent across all parts. A part that fails
 * takes its bytes back off the total before it is tried again.
 */
export async function uploadParts(opts: {
  file: Blob;
  parts: SignedPart[];
  putPart: PutPart;
  signal: AbortSignal;
  onProgress?: (sent: number) => void;
  parallel?: number;
  retries?: number;
  /** Wait before try n (1 based). Defaults to 1 s, 2 s, 4 s. */
  backoffMs?: (attempt: number) => number;
  partSize?: number;
}): Promise<DonePart[]> {
  const { file, parts, putPart, signal } = opts;
  const parallel = opts.parallel ?? PARALLEL_PARTS;
  const retries = opts.retries ?? PART_RETRIES;
  const backoff = opts.backoffMs ?? ((n: number) => 1000 * 2 ** (n - 1));
  const plan = planParts(file.size, opts.partSize);
  if (plan.length !== parts.length) throw new Error("The part list does not match the file.");

  const loaded = new Map<number, number>();
  const report = () => opts.onProgress?.([...loaded.values()].reduce((a, b) => a + b, 0));
  const done: DonePart[] = [];
  let next = 0;

  async function sendPart(index: number) {
    const { partNumber, start, end } = plan[index];
    const blob = file.slice(start, end);
    for (let attempt = 0; ; attempt++) {
      if (signal.aborted) throw new UploadCancelled();
      try {
        const etag = await putPart(
          parts[index].url,
          blob,
          (n) => {
            loaded.set(partNumber, Math.min(n, end - start));
            report();
          },
          signal,
        );
        loaded.set(partNumber, end - start);
        report();
        done.push({ partNumber, etag });
        return;
      } catch (err) {
        loaded.set(partNumber, 0);
        report();
        if (signal.aborted || err instanceof UploadCancelled) throw new UploadCancelled();
        if (attempt >= retries) {
          throw new Error(`Part ${partNumber} failed ${retries + 1} times: ${(err as Error).message}`);
        }
        await wait(backoff(attempt + 1), signal);
      }
    }
  }

  async function worker() {
    while (next < plan.length) {
      const index = next++;
      await sendPart(index);
    }
  }

  // A failing worker stops the others from taking new parts.
  const workers = Array.from({ length: Math.min(parallel, plan.length) }, () =>
    worker().catch((err) => {
      next = plan.length;
      throw err;
    }),
  );
  const results = await Promise.allSettled(workers);
  const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed) throw failed.reason;
  return done.sort((a, b) => a.partNumber - b.partNumber);
}

/** The browser PutPart: a plain PUT of the bytes, reading the ETag R2 sends back. */
export const xhrPutPart: PutPart = (url, body, onLoaded, signal) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.upload.onprogress = (e) => onLoaded(e.loaded);
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`R2 answered ${xhr.status}`));
      const etag = xhr.getResponseHeader("ETag");
      // Without "ExposeHeaders: ETag" in the bucket CORS rule the header is hidden.
      if (!etag) return reject(new Error("no ETag in the answer, check the bucket CORS rule"));
      resolve(etag);
    };
    xhr.onerror = () => reject(new Error("network error"));
    xhr.ontimeout = () => reject(new Error("timed out"));
    xhr.onabort = () => reject(new UploadCancelled());
    signal.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });

/** Bytes per second over the last few seconds, from (time, sent) samples. */
export class SpeedMeter {
  private samples: { t: number; sent: number }[] = [];
  private windowMs: number;

  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
  }

  add(sent: number, t = Date.now()): number {
    this.samples.push({ t, sent });
    while (this.samples.length > 2 && t - this.samples[0].t > this.windowMs) this.samples.shift();
    const first = this.samples[0];
    const dt = (t - first.t) / 1000;
    return dt > 0 ? Math.max(0, (sent - first.sent) / dt) : 0;
  }
}
