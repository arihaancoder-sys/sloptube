import { Suspense } from "react";
import { ResultsSkeleton, ResultsView } from "@/components/search/ResultsView";
import { readQuery } from "@/lib/search/query";

// /results?search_query=<q>, the 2019 address. The query is in the title.
export async function generateMetadata({ searchParams }: PageProps<"/results">) {
  const q = readQuery(await searchParams);
  return { title: q ? `${q} | sloptube` : "Search | sloptube" };
}

export default function ResultsPage({ searchParams }: PageProps<"/results">) {
  return (
    <Suspense fallback={<ResultsSkeleton />}>
      <ResultsView searchParams={searchParams} />
    </Suspense>
  );
}
