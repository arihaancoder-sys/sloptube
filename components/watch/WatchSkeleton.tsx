/** The watch page while it loads: the black player box, a title and Up next in grey. */
export function WatchSkeleton() {
  return (
    <div className="watch-grid" aria-hidden data-watch-skeleton>
      <div className="watch-player">
        <div className="watch-player-box bg-black" />
      </div>
      <div className="watch-info px-3 pt-4 tab:px-0">
        <div className="h-6 w-3/4 bg-skeleton" />
        <div className="mt-3 h-4 w-1/3 bg-skeleton" />
        <div className="mt-6 flex items-center gap-4 border-t border-divider pt-4">
          <div className="h-12 w-12 rounded-full bg-skeleton" />
          <div className="flex-1">
            <div className="h-4 w-40 bg-skeleton" />
            <div className="mt-2 h-3 w-24 bg-skeleton" />
          </div>
        </div>
      </div>
      <div className="watch-side hidden flex-col gap-2 px-3 pt-4 tab:px-0 min-[1016px]:flex min-[1016px]:pt-0">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-2">
            <div className="aspect-video w-[168px] shrink-0 bg-skeleton" />
            <div className="flex-1">
              <div className="h-4 w-full bg-skeleton" />
              <div className="mt-2 h-3 w-2/3 bg-skeleton" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
