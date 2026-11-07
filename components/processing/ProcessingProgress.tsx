import { processingLine, type LiveStatus } from "@/lib/processing/status";

/** The thin 2019 Studio bar and its line ("Processing, 42%", "Waiting to process"). */
export function ProcessingProgress({ video }: { video: Pick<LiveStatus, "status" | "job" | "progress"> }) {
  const line = processingLine(video);
  if (!line) return null;
  const pct = video.job?.status === "running" ? (video.progress ?? 0) : 0;
  return (
    <div data-processing-progress={pct} className="mt-1 w-[120px]">
      <div
        role="progressbar"
        aria-label="Processing"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="h-[3px] w-full overflow-hidden rounded-full bg-[var(--progress-track)]"
      >
        <div className="h-full bg-[var(--progress)] transition-[width] duration-500" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-[12px] leading-4 text-text-2">{line}</p>
    </div>
  );
}
