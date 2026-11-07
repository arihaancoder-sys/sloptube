import { Suspense } from "react";
import { FeedSkeleton, FeedView } from "@/components/feed/FeedView";

export const metadata = { title: "Trending | sloptube" };

export default function Trending() {
  return (
    <Suspense fallback={<FeedSkeleton title="Trending" />}>
      <FeedView
        kind="trending"
        title="Trending"
        placeholder={{ title: "Nothing is trending yet.", hint: "Trending arrives once there are videos to watch." }}
      />
    </Suspense>
  );
}
