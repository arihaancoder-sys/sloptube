import { FeedSkeleton } from "@/components/feed/FeedView";

/** Shown at once on the way to the home page, until the feed streams in. */
export default function Loading() {
  return <FeedSkeleton title="Recommended" />;
}
