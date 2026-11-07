import { Suspense } from "react";
import { ShortsSkeleton, ShortsView } from "@/components/shorts/ShortsView";

export const metadata = { title: "Snips | sloptube" };

export default function Snips() {
  return (
    <Suspense fallback={<ShortsSkeleton />}>
      <ShortsView />
    </Suspense>
  );
}
