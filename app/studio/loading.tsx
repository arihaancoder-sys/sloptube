import { StudioSkeleton } from "@/components/studio/StudioNotices";

/** Shown at once on the way to a studio page, next to the studio nav. */
export default function Loading() {
  return (
    <div className="px-4 py-6 sm:px-8">
      <StudioSkeleton />
    </div>
  );
}
