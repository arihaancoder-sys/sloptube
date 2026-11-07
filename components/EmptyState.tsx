import { VideoCardSkeleton, videoGridClass } from "./VideoCard";

/**
 * Shown on pages that have no videos yet. A short notice above a grid of grey
 * placeholder cards, so the layout already reads like the finished site.
 */
export function EmptyState({
  title = "Nothing here yet. Upload the first video.",
  hint = "Check back soon.",
  cards = 8,
}: {
  title?: string;
  hint?: string;
  cards?: number;
}) {
  return (
    <div className="mx-auto max-w-[2200px] px-4 py-6 sm:px-6">
      <div className="mb-6 border-b border-divider pb-6">
        <h1 className="text-[20px] font-normal leading-7 text-text">{title}</h1>
        <p className="mt-1 text-[14px] text-text-2">{hint}</p>
      </div>
      {cards > 0 && (
        <div className={`${videoGridClass} opacity-70`}>
          {Array.from({ length: cards }, (_, i) => (
            <VideoCardSkeleton key={i} />
          ))}
        </div>
      )}
    </div>
  );
}
