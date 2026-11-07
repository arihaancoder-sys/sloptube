import { Suspense } from "react";
import { FeedSkeleton, FeedView } from "@/components/feed/FeedView";

export default function Home() {
  return (
    <Suspense fallback={<FeedSkeleton title="Recommended" />}>
      <FeedView kind="newest" title="Recommended" placeholder={{}} />
    </Suspense>
  );
}
