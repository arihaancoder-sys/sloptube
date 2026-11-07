import type { VideoStatus } from "@/lib/upload/rules";

const STYLES: Record<VideoStatus, { label: string; className: string }> = {
  uploading: { label: "Uploading", className: "bg-[#e8f0fe] text-[#1a73e8] dark:bg-[#1a2a44] dark:text-[#8ab4f8]" },
  uploaded: { label: "Uploaded", className: "bg-[#e6f4ea] text-[#188038] dark:bg-[#183222] dark:text-[#81c995]" },
  processing: { label: "Processing", className: "bg-[#fef7e0] text-[#b06000] dark:bg-[#3a2f12] dark:text-[#fdd663]" },
  ready: { label: "Ready", className: "bg-[#e6f4ea] text-[#137333] dark:bg-[#183222] dark:text-[#81c995]" },
  failed: { label: "Failed", className: "bg-[#fce8e6] text-[#c5221f] dark:bg-[#3c1d1b] dark:text-[#f28b82]" },
};

export function StatusBadge({ status }: { status: VideoStatus }) {
  const s = STYLES[status] ?? STYLES.failed;
  return (
    <span
      data-status={status}
      className={`inline-flex h-6 items-center rounded-[2px] px-2 text-[12px] font-medium uppercase tracking-[0.3px] ${s.className}`}
    >
      {s.label}
    </span>
  );
}
