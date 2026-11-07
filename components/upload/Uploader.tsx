"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { useFlag } from "@/lib/store/session";
import { useUpload } from "@/lib/store/upload";
import {
  ACCEPT,
  DESCRIPTION_MAX,
  TITLE_MAX,
  UPLOADS_PER_DAY,
  formatBytes,
  formatSpeed,
  percentDone,
  type Visibility,
} from "@/lib/upload/rules";

function UploadArrow({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M9 16h6v-6h4l-7-7-7 7h4v6zm-4 2h14v2H5v-2z" />
    </svg>
  );
}

function CheckCircle({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
    </svg>
  );
}

/** The white dialog style card from the 2019 upload page. */
function Card({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <section className="mx-auto flex w-full max-w-[960px] flex-col bg-surface sm:rounded-[4px] sm:shadow-[0_0_0_1px_var(--divider),0_4px_16px_rgba(0,0,0,0.08)]">
      <header className="flex h-16 shrink-0 items-center border-b border-divider px-4 sm:px-6">
        <h1 className="truncate text-[20px] font-normal leading-7 text-text">{title}</h1>
      </header>
      {children}
      {footer && <footer className="border-t border-divider px-4 py-3 sm:px-6">{footer}</footer>}
    </section>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="mb-4 rounded-[2px] border border-divider bg-surface px-4 py-3 text-[14px] leading-5 text-text">
      {children}
    </div>
  );
}

const VISIBILITY_OPTIONS: { value: Visibility; label: string; hint: string }[] = [
  { value: "private", label: "Private", hint: "Only you can watch your video" },
  { value: "unlisted", label: "Unlisted", hint: "Anyone with the video link can watch your video" },
  { value: "public", label: "Public", hint: "Everyone can watch your video" },
];

function DropZone({ disabled }: { disabled: boolean }) {
  const pick = useUpload((s) => s.pick);
  const notice = useUpload((s) => s.notice);
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);

  function onDrag(e: DragEvent, kind: "enter" | "leave" | "over") {
    e.preventDefault();
    if (disabled) return;
    if (kind === "enter") depth.current++;
    if (kind === "leave") depth.current = Math.max(0, depth.current - 1);
    setDragging(kind === "over" || depth.current > 0);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    depth.current = 0;
    setDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) pick(file);
  }

  return (
    <div
      data-upload-zone={dragging ? "dragging" : "idle"}
      onDragEnter={(e) => onDrag(e, "enter")}
      onDragOver={(e) => onDrag(e, "over")}
      onDragLeave={(e) => onDrag(e, "leave")}
      onDrop={onDrop}
      className={`m-3 flex min-h-[420px] flex-col items-center justify-center rounded-[2px] border-2 border-dashed px-6 py-10 text-center transition-colors sm:m-4 sm:min-h-[480px] ${
        dragging ? "border-[var(--link)] bg-[color-mix(in_srgb,var(--link)_6%,transparent)]" : "border-transparent"
      }`}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        aria-label="Select a video file"
        className={`grid h-[136px] w-[136px] place-items-center rounded-full transition-colors ${
          dragging ? "bg-[var(--link)] text-white" : "bg-[var(--hover)] text-text-3"
        }`}
      >
        <UploadArrow className={`h-[60px] w-[60px] transition-transform ${dragging ? "-translate-y-1" : ""}`} />
      </button>
      <p className="mt-6 text-[15px] leading-6 text-text">
        {dragging ? "Drop to upload" : "Drag and drop video files to upload"}
      </p>
      <p className="mt-1 text-[13px] leading-5 text-text-2">Your videos will be private until you publish them.</p>
      <button type="button" disabled={disabled} onClick={() => input.current?.click()} className="btn-blue mt-7">
        Select files
      </button>
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className="hidden"
        data-testid="file-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) pick(file);
        }}
      />
      {notice && (
        <p role="alert" className="mt-5 text-[13px] leading-5 text-[var(--error)]">
          {notice}
        </p>
      )}
      <p className="mt-auto pt-10 text-[12px] leading-4 text-text-3">
        MP4, MOV, WebM or MKV, up to 2 GB each. Up to {UPLOADS_PER_DAY} uploads a day.
      </p>
    </div>
  );
}

function Counter({ value, max }: { value: number; max: number }) {
  return <span className={`text-[12px] ${value > max ? "text-[var(--error)]" : "text-text-3"}`}>{value}/{max}</span>;
}

/**
 * "Upload as a Snip" (feature 11, with the shorts flag on). Ticked by itself
 * for a vertical file of 60 seconds or less; greyed out with the reason for
 * anything else. Unticking keeps a qualifying video out of Snips.
 */
function ShortChoice() {
  const on = useFlag("shorts");
  const short = useUpload((s) => s.short);
  const setShortOn = useUpload((s) => s.setShortOn);
  if (!on) return null;
  const allowed = short.state === "ready" && short.problem === null;
  return (
    <div className="mt-6" data-short-choice={short.state === "checking" ? "checking" : allowed ? "allowed" : "not-allowed"}>
      <label className={`flex items-start gap-3 rounded-[2px] px-1 py-2 ${allowed ? "cursor-pointer hover:bg-hover" : "cursor-not-allowed"}`}>
        <input
          type="checkbox"
          checked={allowed && short.on}
          disabled={!allowed}
          onChange={(e) => setShortOn(e.target.checked)}
          data-short-choice-box
          className="mt-[3px] h-[18px] w-[18px] accent-[var(--link)]"
        />
        <span>
          <span className={`block text-[14px] font-medium leading-5 ${allowed ? "text-text" : "text-text-3"}`}>Upload as a Snip</span>
          <span className="block text-[13px] leading-[18px] text-text-2" data-short-choice-hint>
            {short.state === "checking"
              ? "Checking the file's size and length..."
              : short.problem ?? "Vertical and 60 seconds or less, so it can show in Snips. Untick to keep it a regular video."}
          </span>
        </span>
      </label>
    </div>
  );
}

function DetailsForm() {
  const details = useUpload((s) => s.details);
  const setDetails = useUpload((s) => s.setDetails);
  const fileName = useUpload((s) => s.fileName);
  const phase = useUpload((s) => s.phase);
  const titleMissing = details.title.trim() === "";

  return (
    <div className="grid gap-6 px-4 py-5 sm:px-6 md:grid-cols-[1fr_284px] md:gap-8">
      <div className="min-w-0">
        <h2 className="text-[20px] font-normal leading-7 text-text">Details</h2>

        <label className="mt-4 block rounded-[4px] border border-[var(--input-border)] px-3 pb-2 pt-2 focus-within:border-[var(--focus)]">
          <span className="flex justify-between text-[12px] leading-4 text-text-2">
            <span>Title (required)</span>
            <Counter value={details.title.length} max={TITLE_MAX} />
          </span>
          <textarea
            value={details.title}
            maxLength={TITLE_MAX}
            rows={2}
            onChange={(e) => setDetails({ title: e.target.value.replace(/\n/g, " ") })}
            placeholder="Add a title that describes your video"
            className="mt-1 block w-full resize-none bg-transparent text-[15px] leading-[22px] text-text outline-none placeholder:text-text-3"
          />
        </label>
        {titleMissing && <p className="mt-1 text-[12px] text-[var(--error)]">Your video needs a title.</p>}

        <label className="mt-5 block rounded-[4px] border border-[var(--input-border)] px-3 pb-2 pt-2 focus-within:border-[var(--focus)]">
          <span className="flex justify-between text-[12px] leading-4 text-text-2">
            <span>Description</span>
            <Counter value={details.description.length} max={DESCRIPTION_MAX} />
          </span>
          <textarea
            value={details.description}
            maxLength={DESCRIPTION_MAX}
            rows={5}
            onChange={(e) => setDetails({ description: e.target.value })}
            placeholder="Tell viewers about your video"
            className="mt-1 block w-full resize-y bg-transparent text-[15px] leading-[22px] text-text outline-none placeholder:text-text-3"
          />
        </label>

        <fieldset className="mt-6">
          <legend className="text-[16px] font-medium leading-[22px] text-text">Visibility</legend>
          <p className="mt-1 text-[13px] leading-[18px] text-text-2">Choose who can watch your video once it is ready.</p>
          <div className="mt-3 space-y-1">
            {VISIBILITY_OPTIONS.map((o) => (
              <label key={o.value} className="flex cursor-pointer items-start gap-3 rounded-[2px] px-1 py-2 hover:bg-hover">
                <input
                  type="radio"
                  name="visibility"
                  value={o.value}
                  checked={details.visibility === o.value}
                  onChange={() => setDetails({ visibility: o.value })}
                  className="mt-[3px] h-[18px] w-[18px] accent-[var(--link)]"
                />
                <span>
                  <span className="block text-[14px] font-medium leading-5 text-text">{o.label}</span>
                  <span className="block text-[13px] leading-[18px] text-text-2">{o.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <ShortChoice />
      </div>

      <aside className="min-w-0">
        <div className="overflow-hidden rounded-[2px] bg-[var(--hover)]">
          <div className="grid aspect-video place-items-center bg-black text-[13px] text-[#aaaaaa]">
            {phase === "finishing" ? "Finishing up" : "Uploading video"}
          </div>
          <div className="px-4 py-3">
            <p className="text-[12px] leading-4 text-text-2">Filename</p>
            <p className="mt-1 break-all text-[14px] leading-5 text-text">{fileName}</p>
          </div>
        </div>
        <p className="mt-3 text-[12px] leading-4 text-text-3">
          Your details are saved when the upload finishes. You can keep typing while it runs.
        </p>
      </aside>
    </div>
  );
}

function ProgressFooter() {
  const { phase, sent, total, speed, cancel } = useUpload();
  const percent = phase === "signing" ? 0 : percentDone(sent, total);
  const line =
    phase === "signing"
      ? "Starting upload"
      : phase === "finishing"
        ? "Upload complete, checking the file"
        : `Uploading ${percent}%`;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 text-[13px] leading-5">
          <span className="font-medium text-text" data-testid="upload-percent">
            {line}
          </span>
          {phase === "uploading" && (
            <span className="text-text-2">
              {formatBytes(sent)} of {formatBytes(total)}, {formatSpeed(speed)}
            </span>
          )}
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          aria-label="Upload progress"
          className="mt-2 h-1 w-full overflow-hidden rounded-full bg-[var(--active)]"
        >
          <div className="h-full bg-[var(--link)] transition-[width] duration-200" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <button type="button" onClick={() => void cancel()} disabled={phase === "finishing"} className="btn-text">
        Cancel
      </button>
    </div>
  );
}

function DoneView() {
  const { watchUrl, details, reset } = useUpload();
  // Only ever rendered in the browser, after an upload: window is there.
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div data-upload-phase="done" className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
      <CheckCircle className="h-16 w-16 text-[#2ba640]" />
      <p className="mt-5 text-[20px] leading-7 text-text">Video uploaded. Processing starts soon.</p>
      <p className="mt-2 max-w-[520px] text-[14px] leading-5 text-text-2">
        <span className="font-medium text-text">{details.title}</span> is{" "}
        {details.visibility === "private" ? "private" : details.visibility}. It can be watched once processing is
        finished.
      </p>
      {watchUrl && (
        <div className="mt-6 w-full max-w-[420px] rounded-[2px] bg-[var(--hover)] px-4 py-3 text-left">
          <p className="text-[12px] leading-4 text-text-2">Video link</p>
          <Link href={watchUrl} className="link mt-1 block break-all text-[14px] leading-5">
            {origin}
            {watchUrl}
          </Link>
        </div>
      )}
      <div className="mt-8 flex flex-wrap justify-center gap-2">
        <button type="button" onClick={reset} className="btn-text">
          Upload another
        </button>
        <Link href="/studio/videos" className="btn-blue">
          Go to your videos
        </Link>
      </div>
    </div>
  );
}

function FailedView() {
  const { error, reset } = useUpload();
  return (
    <div data-upload-phase="failed" className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
      <p className="text-[20px] leading-7 text-text">The upload did not finish</p>
      <p role="alert" className="mt-2 max-w-[520px] text-[14px] leading-5 text-[var(--error)]">
        {error}
      </p>
      <button type="button" onClick={reset} className="btn-blue mt-8">
        Try again
      </button>
    </div>
  );
}

/** The whole /upload experience: drop zone, details while uploading, then done. */
export function Uploader({ configured, preview = false }: { configured: boolean; preview?: boolean }) {
  const phase = useUpload((s) => s.phase);
  const title = useUpload((s) => s.details.title);
  const busy = phase === "signing" || phase === "uploading" || phase === "finishing";

  // Keep a dropped file from opening in the tab, and warn before leaving mid upload.
  useEffect(() => {
    const stop = (e: Event) => e.preventDefault();
    const warn = (e: BeforeUnloadEvent) => {
      if (busy) e.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
      window.removeEventListener("beforeunload", warn);
    };
  }, [busy]);

  return (
    <div data-upload-state={preview ? "preview" : "ready"} data-upload-phase={phase} className="px-0 py-0 sm:px-6 sm:py-6">
      <div className="mx-auto max-w-[960px] px-4 pt-4 sm:px-0 sm:pt-0">
        {preview && (
          <Notice>
            <p className="font-medium">database not connected</p>
            <p className="mt-1 text-text-2">
              This is a preview of the upload page. Add the publishable key to <code>.env.local</code> (see{" "}
              <code>.env.example</code>) and restart to upload for real.
            </p>
          </Notice>
        )}
        {!configured && !preview && (
          <Notice>
            <p className="font-medium">Uploads are not configured on this server yet</p>
            <p className="mt-1 text-text-2">
              The site owner needs to add the four R2 settings (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
              R2_BUCKET). See &quot;Uploads (R2)&quot; in the README.
            </p>
          </Notice>
        )}
      </div>
      <Card
        title={busy || phase === "done" ? title || "Upload videos" : "Upload videos"}
        footer={busy ? <ProgressFooter /> : undefined}
      >
        {phase === "idle" && <DropZone disabled={!configured && !preview} />}
        {busy && <DetailsForm />}
        {phase === "done" && <DoneView />}
        {phase === "failed" && <FailedView />}
      </Card>
    </div>
  );
}
