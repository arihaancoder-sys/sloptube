import { EmptyState } from "@/components/EmptyState";
import { SearchIcon } from "@/components/icons";
import { parseFilters, queryWords, readQuery, showsVideos } from "@/lib/search/query";
import { searchResults } from "@/lib/search/server";
import { ChannelResult } from "./ChannelResult";
import { FilterPanel } from "./FilterPanel";
import { ResultsList } from "./ResultsList";
import { VideoResultSkeleton } from "./VideoResult";

const frame = "mx-auto max-w-[1096px] px-0 py-4 search:px-6";

/** While the first page loads: the FILTER row over skeleton rows. */
export function ResultsSkeleton() {
  return (
    <div className={frame} data-search-state="loading">
      <div className="mb-4 h-9 border-b border-divider" />
      <div className="flex flex-col gap-10 search:gap-4">
        <VideoResultSkeleton />
        <VideoResultSkeleton />
        <VideoResultSkeleton />
      </div>
    </div>
  );
}

function Message({ state, title, hint }: { state: string; title: string; hint: string }) {
  return (
    <div className="px-6 py-20 text-center" data-search-message>
      <SearchIcon className="mx-auto mb-4 h-24 w-24 text-text-3 opacity-60" />
      <h2 className="text-[20px] leading-7 text-text" data-search-message-title={state}>
        {title}
      </h2>
      <p className="mt-2 text-[14px] text-text-2">{hint}</p>
    </div>
  );
}

/**
 * /results?search_query=<q>. With the search flag off (or no database) a
 * placeholder shows. Reads the request, so it is rendered inside <Suspense>.
 */
export async function ResultsView({ searchParams }: { searchParams: PageProps<"/results">["searchParams"] }) {
  const params = await searchParams;
  const q = readQuery(params);
  const filters = parseFilters(params);
  const state = await searchResults(q, filters);

  switch (state.kind) {
    case "off":
    case "no-db":
      return (
        <div data-search-state={state.kind}>
          <EmptyState title="Search isn't on yet." hint="Search arrives once there are videos to find." cards={4} />
        </div>
      );
    case "not-set-up":
      return (
        <div data-search-state="not-set-up">
          <EmptyState title="Search isn't set up yet." hint="Run supabase/migrations/010_search.sql in the Supabase SQL editor." cards={0} />
        </div>
      );
    case "empty-query":
      return (
        <div className={frame} data-search-state="empty-query">
          <Message state="empty-query" title="Search sloptube" hint="Type what you are looking for in the box at the top." />
        </div>
      );
    case "rate-limited":
      return (
        <div className={frame} data-search-state="rate-limited">
          <FilterPanel q={q} filters={filters} />
          <Message state="rate-limited" title="You're searching very fast" hint="Wait a minute, then try again." />
        </div>
      );
    case "failed":
      return (
        <div className={frame} data-search-state="failed">
          <FilterPanel q={q} filters={filters} />
          <Message state="failed" title="Search didn't work this time" hint="Try again in a moment." />
        </div>
      );
    case "ready": {
      const words = queryWords(q);
      const none = state.page.videos.length === 0 && state.channels.length === 0;
      return (
        <div className={frame} data-search-state={none ? "none" : "ready"} data-search-query={q}>
          <h1 className="sr-only">Search results for {q}</h1>
          <div className="px-3 search:px-0">
            <FilterPanel q={q} filters={filters} />
          </div>
          {none ? (
            <Message state="none" title="No results found" hint="Try different keywords or remove search filters" />
          ) : (
            <div className="mt-4">
              {state.channels.length > 0 && (
                <div className={`flex flex-col gap-4 ${showsVideos(filters) ? "mb-4 border-b border-divider pb-4" : ""}`}>
                  {state.channels.map((c) => (
                    <ChannelResult key={c.id} channel={c} words={words} />
                  ))}
                </div>
              )}
              <ResultsList key={`${q}|${JSON.stringify(filters)}`} q={q} filters={filters} words={words} initial={state.page} now={state.now} />
            </div>
          )}
        </div>
      );
    }
  }
}
