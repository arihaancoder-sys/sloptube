import { Suspense } from "react";
import { HistorySkeleton, HistoryView } from "@/components/history/HistoryView";

export const metadata = { title: "History | sloptube" };

// /feed/history, the 2019 address (/history sends you here).
export default function HistoryPage() {
  return (
    <Suspense fallback={<HistorySkeleton />}>
      <HistoryView />
    </Suspense>
  );
}
