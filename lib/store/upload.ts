"use client";

import { create } from "zustand";
import { probeVideoFile } from "@/lib/shorts/probe";
import { shortProblem } from "@/lib/shorts/rules";
import { useSession } from "@/lib/store/session";
import { SpeedMeter, UploadCancelled, uploadParts, xhrPutPart, type SignedPart } from "@/lib/upload/parts";
import {
  detailsProblem,
  fileProblem,
  titleFromFileName,
  uploadErrorText,
  videoTypeFor,
  type Details,
} from "@/lib/upload/rules";

export type UploadPhase = "idle" | "signing" | "uploading" | "finishing" | "done" | "failed";

/**
 * The "Upload as a Snip" box (feature 11). The file's shape is read in the
 * browser when it is picked; the box can only be ticked when the file is
 * vertical and 60 seconds or less, else `problem` says why. Ticked by itself
 * when the file qualifies. Saved after the upload, with the shorts flag on.
 */
export type ShortBox = { state: "checking" | "ready"; problem: string | null; on: boolean };

type SignResponse = { videoId: string; uploadId: string; parts: SignedPart[] };

type UploadState = {
  phase: UploadPhase;
  fileName: string;
  total: number;
  sent: number;
  speed: number;
  details: Details;
  videoId: string | null;
  watchUrl: string | null;
  error: string | null;
  /** A short line under the drop zone, like "Upload cancelled". */
  notice: string | null;
  short: ShortBox;
  pick: (file: File) => void;
  setDetails: (patch: Partial<Details>) => void;
  setShortOn: (on: boolean) => void;
  cancel: () => Promise<void>;
  reset: () => void;
};

const emptyDetails: Details = { title: "", description: "", visibility: "private" };
const checkingShort: ShortBox = { state: "checking", problem: null, on: false };

// The running upload lives outside the store: it is not something to render.
let running: { controller: AbortController; videoId: string | null; uploadId: string | null } | null = null;
// Counts picks, so a slow file probe never lands on the next file's box.
let picks = 0;

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!res.ok) throw new Error(json.message || uploadErrorText(json.error));
  return json;
}

export const useUpload = create<UploadState>((set, get) => ({
  phase: "idle",
  fileName: "",
  total: 0,
  sent: 0,
  speed: 0,
  details: emptyDetails,
  videoId: null,
  watchUrl: null,
  error: null,
  notice: null,
  short: checkingShort,

  pick(file) {
    if (running) return;
    const problem = fileProblem(file);
    if (problem) {
      set({ notice: problem });
      return;
    }
    const mime = videoTypeFor(file)!;
    const controller = new AbortController();
    running = { controller, videoId: null, uploadId: null };
    const details = { ...emptyDetails, title: titleFromFileName(file.name) };
    set({
      phase: "signing",
      fileName: file.name,
      total: file.size,
      sent: 0,
      speed: 0,
      details,
      videoId: null,
      watchUrl: null,
      error: null,
      notice: null,
      short: checkingShort,
    });

    const seq = ++picks;
    void probeVideoFile(file).then((shape) => {
      if (seq !== picks) return;
      const problem = shortProblem(shape);
      set({ short: { state: "ready", problem, on: problem === null } });
    });

    void (async () => {
      const job = running!;
      try {
        const signed = await postJson<SignResponse>(
          "/api/upload/sign",
          { title: details.title, bytes: file.size, mime },
          controller.signal,
        );
        job.videoId = signed.videoId;
        job.uploadId = signed.uploadId;
        set({ phase: "uploading", videoId: signed.videoId });

        const meter = new SpeedMeter();
        let lastPaint = 0;
        const parts = await uploadParts({
          file,
          parts: signed.parts,
          putPart: xhrPutPart,
          signal: controller.signal,
          onProgress: (sent) => {
            const speed = meter.add(sent);
            const now = Date.now();
            // Paint at most five times a second.
            if (now - lastPaint > 200 || sent === file.size) {
              lastPaint = now;
              set({ sent, speed });
            }
          },
        });

        set({ phase: "finishing", sent: file.size });
        const d = get().details;
        const finalDetails = detailsProblem(d) ? { ...d, title: d.title.trim() || details.title } : d;
        const done = await postJson<{ watchUrl: string }>(
          "/api/upload/complete",
          { videoId: signed.videoId, uploadId: signed.uploadId, parts, ...finalDetails },
          controller.signal,
        );
        running = null;
        set({ phase: "done", watchUrl: done.watchUrl, details: finalDetails });
        // The "Upload as a Snip" box. Only a file that qualifies has a say;
        // the rest is decided by shape after processing either way.
        const box = get().short;
        if (useSession.getState().flags.shorts && box.state === "ready" && box.problem === null) {
          void postJson("/api/shorts/choice", { videoId: signed.videoId, on: box.on }).catch(() => undefined);
        }
      } catch (err) {
        if (err instanceof UploadCancelled || controller.signal.aborted) return;
        running = null;
        // Throw the parts away so they do not sit in the bucket.
        if (job.videoId && job.uploadId) {
          void postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
        }
        set({ phase: "failed", error: (err as Error).message || uploadErrorText(null) });
      }
    })();
  },

  setDetails(patch) {
    set({ details: { ...get().details, ...patch } });
  },

  setShortOn(on) {
    const { short: box, phase, videoId } = get();
    if (box.state !== "ready" || box.problem !== null) return;
    set({ short: { ...box, on } });
    // Changed after the upload finished: save it now.
    if (phase === "done" && videoId && useSession.getState().flags.shorts) {
      void postJson("/api/shorts/choice", { videoId, on }).catch(() => undefined);
    }
  },

  async cancel() {
    const job = running;
    running = null;
    if (!job) return;
    job.controller.abort();
    set({ ...initialView(), notice: "Upload cancelled." });
    if (job.videoId && job.uploadId) {
      await postJson("/api/upload/abort", { videoId: job.videoId, uploadId: job.uploadId }).catch(() => undefined);
    }
  },

  reset() {
    if (running) return;
    set(initialView());
  },
}));

function initialView() {
  return {
    phase: "idle" as const,
    fileName: "",
    total: 0,
    sent: 0,
    speed: 0,
    details: emptyDetails,
    videoId: null,
    watchUrl: null,
    error: null,
    notice: null,
    short: checkingShort,
  };
}
