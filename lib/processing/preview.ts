// Sample rows for /studio/videos while running `npm run dev` without the
// Supabase settings, so every processing state can be seen (and filmed)
// without a database. Made up titles, no real data.
import type { StudioVideo } from "@/lib/upload/server";

const base = {
  description: "",
  visibility: "public",
  sourceBytes: 734003200,
  thumbnailUrl: null,
  error: null,
  job: null,
  progress: null,
} as const;

export function previewVideos(): StudioVideo[] {
  return [
    {
      ...base,
      id: "00000000-0000-4000-8000-000000000001",
      title: "Sample: uploading right now",
      status: "uploading",
      createdAt: "2026-11-04T10:05:00Z",
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-000000000002",
      title: "Sample: waiting for the encoder",
      status: "uploaded",
      job: { status: "queued", progress: 0, attempts: 0 },
      progress: 0,
      createdAt: "2026-11-04T10:00:00Z",
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-000000000003",
      title: "Sample: being processed",
      description: "The encoder is turning this into 360p, 720p and 1080p.",
      status: "processing",
      job: { status: "running", progress: 42, attempts: 1 },
      progress: 42,
      createdAt: "2026-11-04T09:40:00Z",
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-000000000004",
      title: "Sample: ready to watch",
      description: "Thumbnails come from the encoder, at 10%, 50% and 90% of the video.",
      status: "ready",
      thumbnailUrl: "/sample-thumbnail.svg",
      progress: 100,
      createdAt: "2026-11-03T18:20:00Z",
    },
    {
      ...base,
      id: "00000000-0000-4000-8000-000000000005",
      title: "Sample: could not be processed",
      visibility: "private",
      status: "failed",
      error: "this file could not be read as a video",
      createdAt: "2026-11-02T08:00:00Z",
    },
  ];
}
